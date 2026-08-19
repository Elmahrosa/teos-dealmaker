'use strict';

const express = require('express');
const { getAdapter, createMemoryAdapter } = require('../db');
const { createRepos } = require('../db/repos');
const missionScheduler = require('../services/missionScheduler');
const autoApproval = require('../services/autoApproval');
const followUpLoop = require('../services/followUpLoop');
const workspaceService = require('../services/workspaces');
const revenueOps = require('../services/revenueOps');
const audit = require('../utils/auditLogger');

const router = express.Router();

function requireFounder(req, res, next) {
  if (!req.authUser || !req.isFounder) {
    return res.status(403).json({ ok: false, error: 'founder_access_required' });
  }
  next();
}

function getAdapterSafe() {
  try { return getAdapter(); } catch (_e) { return createMemoryAdapter(); }
}

// ─── MISSION SCHEDULER ──────────────────────────────────────────────
router.get('/status', requireFounder, async (_req, res) => {
  try {
    const adapter = getAdapterSafe();
    const scheduler = missionScheduler.status();
    const approvalStatus = autoApproval.status();
    const followUpStatus = followUpLoop.status();
    const revenueOpsStatus = await revenueOps.status(adapter);

    res.json({
      ok: true,
      salesLoop: {
        scheduler,
        autoApproval: approvalStatus,
        followUp: followUpStatus,
        revenueOps: {
          enabled: revenueOpsStatus.enabled,
          state: revenueOpsStatus.state,
          intervalMs: revenueOpsStatus.intervalMs
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[founder-sales-loop] status error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.post('/start', requireFounder, express.json(), async (req, res) => {
  try {
    const adapter = getAdapterSafe();
    const by = req.body && req.body.by ? req.body.by : (req.authUser && req.authUser.id ? 'user_' + req.authUser.id : 'founder');

    const result = missionScheduler.start(adapter);
    if (!result.ok) return res.status(409).json(result);

    audit.writeEntry('SALES_LOOP_STARTED', by, 'success', {
      intervalMs: result.intervalMs,
      timestamp: new Date().toISOString()
    });

    res.json({ ok: true, message: 'Mission scheduler started', ...result });
  } catch (err) {
    console.error('[founder-sales-loop] start error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.post('/stop', requireFounder, express.json(), async (req, res) => {
  try {
    const by = req.body && req.body.by ? req.body.by : (req.authUser && req.authUser.id ? 'user_' + req.authUser.id : 'founder');

    const result = missionScheduler.stop();

    audit.writeEntry('SALES_LOOP_STOPPED', by, 'success', {
      timestamp: new Date().toISOString()
    });

    res.json({ ok: true, message: 'Mission scheduler stopped', ...result });
  } catch (err) {
    console.error('[founder-sales-loop] stop error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.post('/trigger', requireFounder, express.json(), async (req, res) => {
  try {
    const adapter = getAdapterSafe();
    const by = req.body && req.body.by ? req.body.by : (req.authUser && req.authUser.id ? 'user_' + req.authUser.id : 'founder');

    const result = await missionScheduler.triggerNow(adapter);

    audit.writeEntry('SALES_LOOP_TRIGGERED', by, 'success', {
      tick: result.tick,
      missions: result.missions ? result.missions.length : 0,
      timestamp: new Date().toISOString()
    });

    res.json({ ok: true, message: 'Tick executed', ...result });
  } catch (err) {
    console.error('[founder-sales-loop] trigger error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ─── PROSPECT MANAGEMENT ────────────────────────────────────────────
router.post('/discover', requireFounder, express.json(), async (req, res) => {
  try {
    const adapter = getAdapterSafe();
    const limit = req.body && req.body.limit ? req.body.limit : 50;
    const result = await revenueOps.discover(adapter, { limit });

    if (!result.ok) return res.status(400).json(result);

    audit.writeEntry('PROSPECT_DISCOVERY_TRIGGERED', 'founder', 'success', {
      scored: result.scored || 0,
      timestamp: new Date().toISOString()
    });

    res.json(result);
  } catch (err) {
    console.error('[founder-sales-loop] discover error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.get('/approvals', requireFounder, async (_req, res) => {
  try {
    const adapter = getAdapterSafe();
    const result = await revenueOps.approvalSummary(adapter);
    res.json(result);
  } catch (err) {
    console.error('[founder-sales-loop] approvals error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.post('/approvals/:id/decide', requireFounder, express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const adapter = getAdapterSafe();
    const id = req.params.id;
    const decision = req.body && req.body.decision ? req.body.decision : 'approve';
    const reason = req.body && req.body.reason ? req.body.reason : null;

    const customer0 = require('../services/customer0');
    const result = await customer0.decide({ adapter }, {
      id,
      decision,
      founder: req.authUser,
      reason
    });

    if (!result.ok) {
      const code = result.error === 'not_found' ? 404 : result.error === 'already_decided' ? 409 : 400;
      return res.status(code).json(result);
    }

    audit.writeEntry('PROSPECT_DECISION', 'founder', 'success', {
      approvalId: id,
      decision,
      reason,
      timestamp: new Date().toISOString()
    });

    res.json(result);
  } catch (err) {
    console.error('[founder-sales-loop] approve error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.post('/approvals/batch', requireFounder, express.json({ limit: '256kb' }), async (req, res) => {
  try {
    const adapter = getAdapterSafe();
    const body = req.body || {};
    if (!Array.isArray(body.ids) || !body.ids.length) {
      return res.status(400).json({ ok: false, error: 'ids_required' });
    }

    const customer0 = require('../services/customer0');
    const result = await customer0.batchDecide({ adapter }, {
      ids: body.ids,
      decision: body.decision || 'approve',
      founder: req.authUser,
      reason: body.reason || null
    });

    audit.writeEntry('PROSPECT_BATCH_DECISION', 'founder', 'success', {
      count: body.ids.length,
      decision: body.decision || 'approve',
      timestamp: new Date().toISOString()
    });

    res.json(result);
  } catch (err) {
    console.error('[founder-sales-loop] batch error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ─── AUTO-APPROVAL EVALUATION ──────────────────────────────────────
router.post('/auto-approval/evaluate', requireFounder, express.json({ limit: '64kb' }), async (req, res) => {
  try {
    const adapter = getAdapterSafe();
    const prospects = req.body && req.body.prospects ? req.body.prospects : [];
    if (!prospects.length) {
      return res.status(400).json({ ok: false, error: 'prospects_required' });
    }

    const result = await autoApproval.batchEvaluate(adapter, prospects);

    audit.writeEntry('AUTO_APPROVAL_EVALUATION', 'founder', 'success', {
      total: result.summary.total,
      autoApproved: result.summary.autoApproved,
      founderReview: result.summary.founderReview,
      timestamp: new Date().toISOString()
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[founder-sales-loop] auto-approval error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.get('/auto-approval/status', requireFounder, async (_req, res) => {
  try {
    res.json({ ok: true, ...autoApproval.status() });
  } catch (err) {
    console.error('[founder-sales-loop] auto-approval status error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ─── FOLLOW-UP LOOP ─────────────────────────────────────────────────
router.post('/follow-up/evaluate', requireFounder, express.json({ limit: '64kb' }), async (req, res) => {
  try {
    const adapter = getAdapterSafe();
    const prospects = req.body && req.body.prospects ? req.body.prospects : [];
    if (!prospects.length) {
      return res.status(400).json({ ok: false, error: 'prospects_required' });
    }

    const result = await followUpLoop.evaluateBatch(adapter, prospects);

    audit.writeEntry('FOLLOW_UP_EVALUATION', 'founder', 'success', {
      total: result.summary.total,
      meetings: result.summary.meetings,
      followUps: result.summary.followUps,
      escalations: result.summary.escalations,
      timestamp: new Date().toISOString()
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[founder-sales-loop] follow-up evaluate error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.get('/follow-up/status', requireFounder, async (_req, res) => {
  try {
    res.json({ ok: true, ...followUpLoop.status() });
  } catch (err) {
    console.error('[founder-sales-loop] follow-up status error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ─── PIPELINE HEALTH ────────────────────────────────────────────────
router.get('/pipeline', requireFounder, async (_req, res) => {
  try {
    const adapter = getAdapterSafe();
    const repos = createRepos(adapter);

    const deals = await repos.deals.list();
    const openDeals = deals.filter(d => d.status === 'open');
    const closedDeals = deals.filter(d => d.status === 'closed');
    const wonDeals = deals.filter(d => d.status === 'closed' && d.outcome === 'won');
    const lostDeals = deals.filter(d => d.status === 'closed' && d.outcome === 'lost');

    const stuckDeals = openDeals.filter(d => {
      const updatedAt = new Date(d.updated_at || d.created_at).getTime();
      return (Date.now() - updatedAt) > (7 * 24 * 60 * 60 * 1000);
    });

    const totalValue = deals.reduce((sum, d) => sum + (d.deal_value || d.value || 0), 0);
    const openValue = openDeals.reduce((sum, d) => sum + (d.deal_value || d.value || 0), 0);

    const pipeline = await repos.pipeline.list();
    const recentEvents = pipeline.slice(-20).reverse();

    res.json({
      ok: true,
      pipeline: {
        totalDeals: deals.length,
        openDeals: openDeals.length,
        closedDeals: closedDeals.length,
        wonDeals: wonDeals.length,
        lostDeals: lostDeals.length,
        stuckDeals: stuckDeals.length,
        stuckDealIds: stuckDeals.map(d => d.id),
        totalValue,
        openValue,
        winRate: closedDeals.length > 0 ? Math.round((wonDeals.length / closedDeals.length) * 100) : 0,
        recentEvents
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[founder-sales-loop] pipeline error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ─── WORKSPACE MODE ─────────────────────────────────────────────────
router.get('/workspaces', requireFounder, async (_req, res) => {
  try {
    const adapter = getAdapterSafe();
    const workspaces = await workspaceService.listWorkspaces(adapter);
    res.json({ ok: true, workspaces });
  } catch (err) {
    console.error('[founder-sales-loop] workspaces error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.post('/mode', requireFounder, express.json(), async (req, res) => {
  try {
    const adapter = getAdapterSafe();
    const workspaceId = req.body && req.body.workspaceId ? req.body.workspaceId : null;
    const mode = req.body && req.body.mode ? req.body.mode : null;

    if (!workspaceId || !mode) {
      return res.status(400).json({ ok: false, error: 'workspaceId_and_mode_required' });
    }

    const result = await workspaceService.setWorkspaceMode(adapter, workspaceId, mode);
    res.json(result);
  } catch (err) {
    console.error('[founder-sales-loop] mode error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ─── HEALTH DASHBOARD ───────────────────────────────────────────────
router.get('/health', requireFounder, async (_req, res) => {
  try {
    const adapter = getAdapterSafe();
    const repos = createRepos(adapter);

    const scheduler = missionScheduler.status();
    const approval = autoApproval.status();
    const followUp = followUpLoop.status();
    const workspaces = await workspaceService.listWorkspaces(adapter);

    const deals = await repos.deals.list();
    const openDeals = deals.filter(d => d.status === 'open');
    const stuckDeals = openDeals.filter(d => {
      const updatedAt = new Date(d.updated_at || d.created_at).getTime();
      return (Date.now() - updatedAt) > (7 * 24 * 60 * 60 * 1000);
    });

    const outbound = await repos.outboundEmails.list({ limit: 100 });
    const sentEmails = outbound.filter(e => e.status === 'sent');
    const pendingEmails = outbound.filter(e => e.status === 'pending_approval');

    const auditEntries = audit.readTail(50);
    const recentSalesEvents = auditEntries.filter(e =>
      e.action_type && (
        e.action_type.includes('SALES_LOOP') ||
        e.action_type.includes('PROSPECT') ||
        e.action_type.includes('AUTO_APPROVAL') ||
        e.action_type.includes('FOLLOW_UP')
      )
    );

    res.json({
      ok: true,
      health: {
        scheduler: {
          running: scheduler.running,
          enabled: scheduler.enabled,
          tickCount: scheduler.tickCount,
          lastTickAt: scheduler.lastTickAt,
          nextTickAt: scheduler.nextTickAt,
          intervalMinutes: scheduler.intervalMinutes
        },
        autoApproval: {
          enabled: approval.enabled,
          thresholds: approval.thresholds
        },
        followUp: {
          enabled: followUp.enabled
        },
        pipeline: {
          totalDeals: deals.length,
          openDeals: openDeals.length,
          stuckDeals: stuckDeals.length,
          stuckRate: openDeals.length > 0 ? Math.round((stuckDeals.length / openDeals.length) * 100) : 0
        },
        outbound: {
          sent: sentEmails.length,
          pending: pendingEmails.length
        },
        workspaces: {
          total: workspaces.length,
          modes: workspaces.reduce((acc, w) => {
            acc[w.mode] = (acc[w.mode] || 0) + 1;
            return acc;
          }, {})
        },
        recentActivity: recentSalesEvents.slice(0, 10).map(e => ({
          action: e.action_type,
          agent: e.agent_name,
          timestamp: e.created_at
        }))
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[founder-sales-loop] health error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

module.exports = router;
