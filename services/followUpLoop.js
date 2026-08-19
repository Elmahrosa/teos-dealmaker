'use strict';

const { createRepos } = require('../db/repos');

const ENGAGEMENT_LEVELS = {
  COLD: 'cold',
  WARM: 'warm',
  HOT: 'hot',
  ENGAGED: 'engaged',
  REPLIED: 'replied',
  MEETING_READY: 'meeting_ready'
};

const ACTIONS = {
  SEND_FOLLOW_UP: 'send_follow_up',
  ESCALATE_TO_FOUNDER: 'escalate_to_founder',
  BOOK_MEETING: 'book_meeting',
  MARK_COLD: 'mark_cold',
  NO_ACTION: 'no_action'
};

const DEFAULT_CONFIG = {
  followUpDelayDays: Number(process.env.FOLLOW_UP_DELAY_DAYS) || 3,
  maxFollowUps: Number(process.env.MAX_FOLLOW_UPS) || 3,
  hotScoreThreshold: Number(process.env.HOT_SCORE_THRESHOLD) || 75,
  meetingReadyScore: Number(process.env.MEETING_READY_SCORE) || 85,
  coldAfterDays: Number(process.env.COLD_AFTER_DAYS) || 14,
  founderEscalateScore: Number(process.env.FOUNDER_ESCALATE_SCORE) || 80,
  founderEscalateMinValue: Number(process.env.FOUNDER_ESCALATE_MIN_VALUE) || 5000
};

function getConfig() {
  return {
    ...DEFAULT_CONFIG,
    enabled: process.env.FOLLOW_UP_ENABLED !== 'false'
  };
}

function classifyEngagement(prospect, cfg) {
  const config = cfg || DEFAULT_CONFIG;
  const score = prospect.score || 0;
  const emailsSent = prospect.emails_sent || 0;
  const lastEngagementAt = prospect.last_engagement_at;
  const replied = prospect.replied || false;
  const meetingsBooked = prospect.meetings_booked || 0;

  if (replied || meetingsBooked > 0) {
    return ENGAGEMENT_LEVELS.MEETING_READY;
  }

  if (lastEngagementAt) {
    const daysSinceEngagement = (Date.now() - new Date(lastEngagementAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceEngagement < 1) return ENGAGEMENT_LEVELS.ENGAGED;
  }

  if (score >= config.meetingReadyScore) return ENGAGEMENT_LEVELS.MEETING_READY;
  if (score >= config.hotScoreThreshold) return ENGAGEMENT_LEVELS.HOT;
  if (score >= 50) return ENGAGEMENT_LEVELS.WARM;
  if (emailsSent > 0 && score < 30) return ENGAGEMENT_LEVELS.COLD;

  return ENGAGEMENT_LEVELS.COLD;
}

function decideAction(engagement, prospect, cfg) {
  const config = cfg || DEFAULT_CONFIG;

  switch (engagement) {
    case ENGAGEMENT_LEVELS.MEETING_READY:
      return { action: ACTIONS.BOOK_MEETING, reason: 'prospect_ready', engagement };

    case ENGAGEMENT_LEVELS.ENGAGED:
      if (prospect.score >= config.founderEscalateScore && (prospect.deal_value || 0) >= config.founderEscalateMinValue) {
        return { action: ACTIONS.ESCALATE_TO_FOUNDER, reason: 'high_value_engaged', engagement };
      }
      return { action: ACTIONS.BOOK_MEETING, reason: 'engaged_prospect', engagement };

    case ENGAGEMENT_LEVELS.HOT:
      return { action: ACTIONS.SEND_FOLLOW_UP, reason: 'hot_prospect', engagement };

    case ENGAGEMENT_LEVELS.WARM:
      return { action: ACTIONS.SEND_FOLLOW_UP, reason: 'warm_prospect', engagement };

    case ENGAGEMENT_LEVELS.COLD: {
      const emailsSent = prospect.emails_sent || 0;
      if (emailsSent >= config.maxFollowUps) {
        return { action: ACTIONS.MARK_COLD, reason: 'max_follow_ups_reached', engagement };
      }
      const daysSinceLastEmail = prospect.last_email_at
        ? (Date.now() - new Date(prospect.last_email_at).getTime()) / (1000 * 60 * 60 * 24)
        : Infinity;
      if (daysSinceLastEmail >= config.followUpDelayDays) {
        return { action: ACTIONS.SEND_FOLLOW_UP, reason: 'follow_up_scheduled', engagement };
      }
      return { action: ACTIONS.NO_ACTION, reason: 'too_soon', engagement };
    }

    default:
      return { action: ACTIONS.NO_ACTION, reason: 'unknown_engagement', engagement };
  }
}

async function evaluateProspect(adapter, prospect, cfg) {
  const config = cfg || getConfig();
  if (!config.enabled) return { action: ACTIONS.NO_ACTION, reason: 'follow_up_disabled' };

  const engagement = classifyEngagement(prospect, config);
  const decision = decideAction(engagement, prospect, config);

  const repos = createRepos(adapter);
  await repos.audit.add({
    workspace_id: prospect.workspace_id || 0,
    agent_name: 'follow_up_loop',
    action_type: 'FOLLOW_UP_EVALUATION',
    details: {
      prospectId: prospect.id,
      prospectName: prospect.name || prospect.company_name,
      score: prospect.score,
      engagement,
      action: decision.action,
      reason: decision.reason
    },
    version: 'v1.2.0'
  });

  return { ...decision, engagement, prospectId: prospect.id };
}

async function evaluateBatch(adapter, prospects, cfg) {
  const results = [];
  for (const prospect of prospects) {
    const result = await evaluateProspect(adapter, prospect, cfg);
    results.push(result);
  }

  const summary = {
    total: results.length,
    byAction: {},
    byEngagement: {},
    escalations: results.filter(r => r.action === ACTIONS.ESCALATE_TO_FOUNDER).length,
    meetings: results.filter(r => r.action === ACTIONS.BOOK_MEETING).length,
    followUps: results.filter(r => r.action === ACTIONS.SEND_FOLLOW_UP).length,
    cold: results.filter(r => r.action === ACTIONS.MARK_COLD).length
  };

  for (const r of results) {
    summary.byAction[r.action] = (summary.byAction[r.action] || 0) + 1;
    summary.byEngagement[r.engagement] = (summary.byEngagement[r.engagement] || 0) + 1;
  }

  return { summary, results };
}

function getEngagementLevel(score, cfg) {
  const config = cfg || DEFAULT_CONFIG;
  if (score >= config.meetingReadyScore) return ENGAGEMENT_LEVELS.MEETING_READY;
  if (score >= config.hotScoreThreshold) return ENGAGEMENT_LEVELS.HOT;
  if (score >= 50) return ENGAGEMENT_LEVELS.WARM;
  return ENGAGEMENT_LEVELS.COLD;
}

function status() {
  const cfg = getConfig();
  return {
    ok: true,
    enabled: cfg.enabled,
    config: cfg
  };
}

module.exports = {
  ENGAGEMENT_LEVELS,
  ACTIONS,
  getConfig,
  classifyEngagement,
  decideAction,
  evaluateProspect,
  evaluateBatch,
  getEngagementLevel,
  status
};
