'use strict';

const { createRepos } = require('../db/repos');

const DECISIONS = {
  AUTO_APPROVE: 'auto_approve',
  FOUNDER_REVIEW: 'founder_review',
  AUTO_REJECT: 'auto_reject',
  HOLD: 'hold'
};

const DEFAULT_THRESHOLDS = {
  autoApproveScore: Number(process.env.AUTO_APPROVE_SCORE) || 80,
  founderReviewScore: Number(process.env.FOUNDER_REVIEW_SCORE) || 60,
  autoRejectBelow: Number(process.env.AUTO_REJECT_BELOW) || 30,
  maxAutoApprovesPerDay: Number(process.env.MAX_AUTO_APPROVES_PER_DAY) || 5,
  cooldownHours: Number(process.env.AUTO_APPROVAL_COOLDOWN_HOURS) || 24,
  requireFounderForHighValue: process.env.REQUIRE_FOUNDER_HIGH_VALUE !== 'false',
  highValueThreshold: Number(process.env.HIGH_VALUE_THRESHOLD) || 10000
};

function getConfig() {
  return {
    ...DEFAULT_THRESHOLDS,
    enabled: process.env.AUTO_APPROVAL_ENABLED !== 'false'
  };
}

function evaluate(prospect, cfg) {
  const config = cfg || getConfig();
  if (!config.enabled) return { decision: DECISIONS.FOUNDER_REVIEW, reason: 'auto_approval_disabled' };

  const score = prospect.score || 0;
  const dealValue = prospect.deal_value || prospect.estimated_value || 0;

  if (score >= config.autoApproveScore) {
    if (config.requireFounderForHighValue && dealValue >= config.highValueThreshold) {
      return { decision: DECISIONS.FOUNDER_REVIEW, reason: 'high_value_requires_founder', score, dealValue };
    }
    return { decision: DECISIONS.AUTO_APPROVE, reason: 'high_score', score };
  }

  if (score >= config.founderReviewScore) {
    return { decision: DECISIONS.FOUNDER_REVIEW, reason: 'medium_score', score };
  }

  if (score < config.autoRejectBelow) {
    return { decision: DECISIONS.AUTO_REJECT, reason: 'low_score', score };
  }

  return { decision: DECISIONS.HOLD, reason: 'score_in_between', score };
}

async function processPendingApproval(adapter, approval, cfg) {
  const config = cfg || getConfig();
  if (!config.enabled) return { decision: DECISIONS.FOUNDER_REVIEW, reason: 'auto_approval_disabled' };

  const repos = createRepos(adapter);

  const prospect = approval.prospect || {};
  const evaluation = evaluate(prospect, config);

  if (evaluation.decision === DECISIONS.AUTO_APPROVE) {
    const todayApprovals = await getTodayAutoApprovals(adapter);
    if (todayApprovals >= config.maxAutoApprovesPerDay) {
      return { decision: DECISIONS.FOUNDER_REVIEW, reason: 'daily_limit_reached', todayApprovals };
    }

    const recentApproval = await checkCooldown(adapter, approval.recipient, config.cooldownHours);
    if (recentApproval) {
      return { decision: DECISIONS.FOUNDER_REVIEW, reason: 'cooldown_active', recentApproval };
    }

    await repos.audit.add({
      workspace_id: approval.workspace_id || 0,
      agent_name: 'auto_approval',
      action_type: 'AUTO_APPROVAL_DECISION',
      details: {
        approvalId: approval.id,
        decision: DECISIONS.AUTO_APPROVE,
        score: evaluation.score,
        reason: evaluation.reason
      },
      version: 'v1.2.0'
    });

    return { decision: DECISIONS.AUTO_APPROVE, ...evaluation };
  }

  if (evaluation.decision === DECISIONS.AUTO_REJECT) {
    await repos.audit.add({
      workspace_id: approval.workspace_id || 0,
      agent_name: 'auto_approval',
      action_type: 'AUTO_REJECTION_DECISION',
      details: {
        approvalId: approval.id,
        decision: DECISIONS.AUTO_REJECT,
        score: evaluation.score,
        reason: evaluation.reason
      },
      version: 'v1.2.0'
    });

    return { decision: DECISIONS.AUTO_REJECT, ...evaluation };
  }

  return evaluation;
}

async function getTodayAutoApprovals(adapter) {
  const repos = createRepos(adapter);
  const today = new Date().toISOString().slice(0, 10);
  const all = await repos.audit.list(0);
  return all.filter(e =>
    e.action_type === 'AUTO_APPROVAL_DECISION' &&
    e.details &&
    e.details.decision === DECISIONS.AUTO_APPROVE &&
    e.created_at &&
    e.created_at.toISOString &&
    e.created_at.toISOString().slice(0, 10) === today
  ).length;
}

async function checkCooldown(adapter, recipient, cooldownHours) {
  const repos = createRepos(adapter);
  const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);
  const recent = await repos.outboundEmails.list({ status: 'sent', limit: 100 });
  const match = recent.find(e =>
    e.recipient === recipient &&
    e.sent_at &&
    new Date(e.sent_at) > cutoff
  );
  return match || null;
}

async function batchEvaluate(adapter, approvals, cfg) {
  const results = [];
  for (const approval of approvals) {
    const result = await processPendingApproval(adapter, approval, cfg);
    results.push({ ...result, approvalId: approval.id, recipient: approval.recipient });
  }

  const summary = {
    total: results.length,
    autoApproved: results.filter(r => r.decision === DECISIONS.AUTO_APPROVE).length,
    founderReview: results.filter(r => r.decision === DECISIONS.FOUNDER_REVIEW).length,
    autoRejected: results.filter(r => r.decision === DECISIONS.AUTO_REJECT).length,
    held: results.filter(r => r.decision === DECISIONS.HOLD).length
  };

  return { summary, results };
}

function status() {
  const cfg = getConfig();
  return {
    ok: true,
    enabled: cfg.enabled,
    thresholds: {
      autoApprove: cfg.autoApproveScore,
      founderReview: cfg.founderReviewScore,
      autoReject: cfg.autoRejectBelow
    },
    limits: {
      maxPerDay: cfg.maxAutoApprovesPerDay,
      cooldownHours: cfg.cooldownHours,
      highValueThreshold: cfg.highValueThreshold,
      requireFounderForHighValue: cfg.requireFounderForHighValue
    }
  };
}

module.exports = {
  DECISIONS,
  getConfig,
  evaluate,
  processPendingApproval,
  getTodayAutoApprovals,
  checkCooldown,
  batchEvaluate,
  status
};
