'use strict';

const { createRepos } = require('../db/repos');
const customer0 = require('./customer0');
const revenueOps = require('./revenueOps');
const audit = require('../utils/auditLogger');

const MISSION_TYPES = {
  SALES_STRATEGY: 'sales_strategy',
  PROSPECT_DISCOVERY: 'prospect_discovery',
  OUTREACH_FOLLOW_UP: 'outreach_follow_up',
  PIPELINE_HEALTH: 'pipeline_health',
  CUSTOMER0_SEED: 'customer0_seed'
};

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 30 * 60 * 1000;

function getConfig() {
  return {
    intervalMs: Math.max(MIN_INTERVAL_MS, Number(process.env.MISSION_SCHEDULER_INTERVAL_MS) || DEFAULT_INTERVAL_MS),
    enabled: process.env.MISSION_SCHEDULER_ENABLED !== 'false',
    maxConcurrent: Number(process.env.MISSION_SCHEDULER_MAX_CONCURRENT) || 3,
    prospectDiscoveryEnabled: process.env.PROSPECT_DISCOVERY_ENABLED !== 'false',
    autoOutreachEnabled: process.env.AUTO_OUTREACH_ENABLED !== 'false',
    followUpEnabled: process.env.FOLLOW_UP_ENABLED !== 'false',
    pipelineHealthEnabled: process.env.PIPELINE_HEALTH_ENABLED !== 'false',
    highScoreThreshold: Number(process.env.AUTO_OUTREACH_SCORE_THRESHOLD) || 70,
    followUpScoreThreshold: Number(process.env.FOLLOW_UP_SCORE_THRESHOLD) || 50
  };
}

let clock = null;
let running = false;
let lastTickAt = null;
let tickCount = 0;

function start(adapter) {
  if (clock) return { ok: false, reason: 'already_running' };
  const cfg = getConfig();
  if (!cfg.enabled) return { ok: false, reason: 'disabled' };

  running = true;
  tick(adapter).catch(err => {
    console.error('[missionScheduler] initial tick failed:', err.message);
  });

  clock = setInterval(() => {
    tick(adapter).catch(err => {
      console.error('[missionScheduler] tick failed:', err.message);
    });
  }, cfg.intervalMs);

  if (clock.unref) clock.unref();

  console.log(`[missionScheduler] started (interval: ${cfg.intervalMs / 1000 / 60}min)`);
  return { ok: true, intervalMs: cfg.intervalMs };
}

function stop() {
  if (clock) {
    clearInterval(clock);
    clock = null;
  }
  running = false;
  return { ok: true };
}

async function tick(adapter) {
  if (!running) return { ok: false, reason: 'not_running' };

  const cfg = getConfig();
  if (!cfg.enabled) return { ok: false, reason: 'disabled' };

  lastTickAt = Date.now();
  tickCount++;

  const results = { tick: tickCount, at: new Date(lastTickAt).toISOString(), missions: [] };

  try {
    if (cfg.prospectDiscoveryEnabled) {
      const discovery = await runProspectDiscovery(adapter, cfg);
      results.missions.push(discovery);
    }

    if (cfg.autoOutreachEnabled) {
      const outreach = await runAutoOutreach(adapter, cfg);
      results.missions.push(outreach);
    }

    if (cfg.followUpEnabled) {
      const followUp = await runFollowUp(adapter, cfg);
      results.missions.push(followUp);
    }

    if (cfg.pipelineHealthEnabled) {
      const health = await runPipelineHealth(adapter, cfg);
      results.missions.push(health);
    }
  } catch (err) {
    results.error = err.message;
    console.error('[missionScheduler] tick error:', err.message);
  }

  audit.writeEntry('MISSION_SCHEDULER_TICK', 'system', 'success', {
    tick: tickCount,
    missions: results.missions.length,
    timestamp: results.at
  });

  return results;
}

async function runProspectDiscovery(adapter, cfg) {
  const type = MISSION_TYPES.PROSPECT_DISCOVERY;
  try {
    const repos = createRepos(adapter);
    const existing = await repos.audit.list(0);
    const recentDiscovery = existing.find(e => e.action_type === 'PROSPECT_DISCOVERY_COMPLETED');
    if (recentDiscovery) {
      const age = Date.now() - new Date(recentDiscovery.created_at).getTime();
      if (age < cfg.intervalMs * 0.8) {
        return { type, status: 'skipped', reason: 'recent_discovery_found' };
      }
    }

    const result = await revenueOps.discover(adapter, { limit: 50 });

    audit.writeEntry('PROSPECT_DISCOVERY_COMPLETED', 'system', 'success', {
      scored: result.scored || 0,
      timestamp: new Date().toISOString()
    });

    return { type, status: 'completed', scored: result.scored || 0 };
  } catch (err) {
    return { type, status: 'error', error: err.message };
  }
}

async function runAutoOutreach(adapter, _cfg) {
  const type = MISSION_TYPES.OUTREACH_FOLLOW_UP;
  try {
    const repos = createRepos(adapter);
    const pending = await repos.outboundEmails.list({ status: 'pending_approval', limit: 10 });

    if (!pending || !pending.length) {
      return { type, status: 'skipped', reason: 'no_pending_outreach' };
    }

    let approved = 0;
    for (const email of pending) {
      try {
        const result = await customer0.decide(adapter, {
          id: email.id,
          decision: 'approve',
          founder: 'mission_scheduler'
        });
        if (result.ok) approved++;
      } catch (err) {
        console.error(`[missionScheduler] auto-approve failed for ${email.id}:`, err.message);
      }
    }

    return { type, status: 'completed', approved, total: pending.length };
  } catch (err) {
    return { type, status: 'error', error: err.message };
  }
}

async function runFollowUp(adapter, _cfg) {
  const type = MISSION_TYPES.OUTREACH_FOLLOW_UP;
  try {
    const repos = createRepos(adapter);
    const prospects = await repos.outboundEmails.list({ status: 'sent', limit: 20 });

    if (!prospects || !prospects.length) {
      return { type, status: 'skipped', reason: 'no_sent_outreach' };
    }

    let followUps = 0;
    for (const email of prospects) {
      const sentAt = new Date(email.sent_at || email.created_at).getTime();
      const daysSinceSent = (Date.now() - sentAt) / (1000 * 60 * 60 * 24);

      if (daysSinceSent >= 3 && daysSinceSent <= 7) {
        followUps++;
      }
    }

    return { type, status: 'completed', followUpsNeeded: followUps, checked: prospects.length };
  } catch (err) {
    return { type, status: 'error', error: err.message };
  }
}

async function runPipelineHealth(adapter, _cfg) {
  const type = MISSION_TYPES.PIPELINE_HEALTH;
  try {
    const repos = createRepos(adapter);
    const deals = await repos.deals.list();
    const openDeals = deals.filter(d => d.status === 'open');
    const stuckDeals = openDeals.filter(d => {
      const updatedAt = new Date(d.updated_at || d.created_at).getTime();
      return (Date.now() - updatedAt) > (7 * 24 * 60 * 60 * 1000);
    });

    return {
      type,
      status: 'completed',
      totalDeals: deals.length,
      openDeals: openDeals.length,
      stuckDeals: stuckDeals.length,
      stuckDealIds: stuckDeals.map(d => d.id)
    };
  } catch (err) {
    return { type, status: 'error', error: err.message };
  }
}

async function triggerNow(adapter) {
  return tick(adapter);
}

function status() {
  const cfg = getConfig();
  return {
    ok: true,
    running,
    enabled: cfg.enabled,
    intervalMs: cfg.intervalMs,
    intervalMinutes: cfg.intervalMs / 1000 / 60,
    tickCount,
    lastTickAt,
    nextTickAt: lastTickAt ? new Date(lastTickAt + cfg.intervalMs).toISOString() : null,
    config: cfg
  };
}

module.exports = {
  MISSION_TYPES,
  getConfig,
  start,
  stop,
  tick,
  triggerNow,
  status,
  runProspectDiscovery,
  runAutoOutreach,
  runFollowUp,
  runPipelineHealth
};
