const { forWorkspace } = require('../db/repos');

function dayTime(iso) {
  if (!iso) return '—';
  return String(iso).replace('T', ' ').slice(0, 16) + ' UTC';
}

function durationOf(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms;
}

function stripSimulatedPrefix(text) {
  return String(text)
    .replace(/^\[\s*simulated\s+[^\]]*\]\s*\|?\s*/gi, '');
}

function summarize(output, max) {
  const text = stripSimulatedPrefix(output || '').split('\n').filter(Boolean).join(' ');
  const limit = max || 140;
  return text.length > limit ? text.slice(0, limit) + '…' : text;
}

function extractRevenue(output) {
  const amounts = String(output || '').match(/\$\s?[\d,.]+[kKmM]?/g);
  if (!amounts) return null;
  const raw = amounts[0].replace(/[$,]/g, '').toLowerCase();
  const mult = raw.endsWith('k') ? 1000 : raw.endsWith('m') ? 1000000 : 1;
  const value = parseFloat(raw.replace(/[km]/g, ''));
  return Number.isFinite(value) ? Math.round(value * mult) : null;
}

async function missionReport(adapter, workspaceId, planId) {
  if (!workspaceId) {
    const planRow = await adapter.findOne('plans', { id: Number(planId) });
    if (!planRow) return null;
    workspaceId = planRow.workspace_id;
  }
  const repos = forWorkspace(adapter, workspaceId);
  const plan = await repos.plans.get(planId);
  if (!plan) return null;
  const steps = await repos.planSteps.list(planId);
  const runs = (await repos.agentRuns.list()).filter(r => r.plan_id === Number(planId));
  const approvals = (await repos.approvals.list()).filter(a => a.plan_id === Number(planId));
  const metrics = plan.metrics || {};

  const ordered = [...steps].sort((a, b) => {
    const ta = a.completed_at || a.started_at || a.created_at;
    const tb = b.completed_at || b.started_at || b.created_at;
    return String(ta).localeCompare(String(tb));
  });

  const completed = steps.filter(s => s.status === 'completed');
  const failed = steps.filter(s => s.status === 'failed');
  const skipped = steps.filter(s => s.status === 'skipped');
  const awaiting = steps.filter(s => s.status === 'awaiting_approval');

  const confidenceValues = completed
    .map(s => s.confidence)
    .filter(c => typeof c === 'number');
  const avgConfidence = confidenceValues.length
    ? Math.round((confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length) * 100) / 100
    : null;

  const totalCostCents = runs.reduce((acc, r) => acc + (r.cost_cents || 0), 0);
  const budgetCents = metrics.budget_cents || null;
  const budgetExceeded = budgetCents !== null && totalCostCents > budgetCents;
  const durationMs = metrics.duration_ms || ordered.reduce((acc, s) => acc + (durationOf(s.started_at, s.completed_at) || 0), 0);

  const byAgent = {};
  for (const s of steps) {
    if (!byAgent[s.agent_type]) byAgent[s.agent_type] = { total: 0, completed: 0, failed: 0 };
    byAgent[s.agent_type].total += 1;
    if (s.status === 'completed') byAgent[s.agent_type].completed += 1;
    if (s.status === 'failed') byAgent[s.agent_type].failed += 1;
  }

  const providersUsed = {};
  for (const r of runs) {
    const key = r.provider ? `${r.provider}${r.model ? ' · ' + r.model : ''}` : 'unknown';
    providersUsed[key] = (providersUsed[key] || 0) + 1;
  }

  const revenue = extractRevenue(completed.map(s => s.output).join('\n'));
  const expectedRevenue = (metrics.mission && metrics.mission.expected_revenue)
    ? extractRevenue(metrics.mission.expected_revenue)
    : null;

  const mission = metrics.mission || {
    name: plan.title,
    goal: plan.goal,
    target_customer: null,
    target_market: null,
    priority: plan.priority,
    expected_revenue: expectedRevenue ? '$' + expectedRevenue.toLocaleString() : null,
    deadline: null,
    notes: null
  };

  return {
    plan: {
      id: plan.id,
      title: plan.title,
      goal: plan.goal,
      status: plan.status,
      priority: plan.priority,
      created_at: plan.created_at,
      mission
    },
    timeline: ordered.map(s => ({
      id: s.id,
      step_key: s.step_key,
      agent_type: s.agent_type,
      status: s.status,
      output: summarize(s.output),
      error: s.error || null,
      confidence: typeof s.confidence === 'number' ? s.confidence : null,
      retries: s.retries || 0,
      started_at: s.started_at,
      completed_at: s.completed_at,
      duration_ms: durationOf(s.started_at, s.completed_at),
      requires_approval: Boolean(s.approval)
    })),
    kpis: {
      total_steps: steps.length,
      completed_steps: completed.length,
      failed_steps: failed.length,
      skipped_steps: skipped.length,
      awaiting_approval: awaiting.length,
      completion_rate: steps.length ? Math.round((completed.length / steps.length) * 100) : 0,
      success_rate: (completed.length + failed.length) ? Math.round((completed.length / (completed.length + failed.length)) * 100) : (steps.length ? 100 : 0),
      avg_confidence: avgConfidence,
      total_cost_cents: totalCostCents,
      budget_cents: budgetCents,
      budget_exceeded: budgetExceeded,
      duration_ms: durationMs,
      approvals_requested: approvals.length,
      approvals_pending: approvals.filter(a => a.status === 'pending').length,
      agents_used: Object.keys(byAgent).length,
      revenue_cents: revenue,
      expected_revenue_cents: expectedRevenue
    },
    agents: Object.entries(byAgent).map(([agent, v]) => ({
      agent_type: agent,
      total: v.total,
      completed: v.completed,
      failed: v.failed,
      utilization: v.total ? Math.round((v.completed / v.total) * 100) : 0
    })),
    providers: Object.entries(providersUsed).map(([provider, count]) => ({ provider, count })),
    outbound: await outboundActivity(adapter, workspaceId)
  };
}

// Governed outbound email activity for the report. Never exposes secrets:
// only counts, timestamps and a sanitized last-sent entry. The recipient
// address is stripped from the public report surface; the provider-confirmed
// message id is kept. Any failure to read the queue is swallowed so the
// mission report never breaks.
function sanitizeOutboundActivity(activity) {
  if (!activity || typeof activity !== 'object') return activity;
  if (activity.last_sent && typeof activity.last_sent === 'object') {
    const clean = Object.assign({}, activity.last_sent);
    delete clean.recipient;
    return Object.assign({}, activity, { last_sent: clean });
  }
  return activity;
}

async function outboundActivity(adapter, workspaceId) {
  try {
    const { createWorker } = require('./outboundWorker');
    return sanitizeOutboundActivity(await createWorker().reportActivity(adapter, workspaceId));
  } catch (_err) {
    return {
      total_jobs: 0,
      queued: 0,
      processing: 0,
      sent: 0,
      provider_confirmed: 0,
      send_failed: 0,
      send_unknown: 0,
      blocked: 0,
      suppressed_jobs: 0,
      cancelled: 0,
      sent_today: 0,
      suppression_count: 0,
      last_sent_at: null,
      last_sent: null,
      unavailable: true
    };
  }
}

async function executiveReportText(adapter, workspaceId, planId) {
  const r = await missionReport(adapter, workspaceId, planId);
  if (!r) return null;
  const { plan, timeline, kpis, agents } = r;
  const money = cents => `$${((cents || 0) / 100).toFixed(2)}`;
  const lines = [
    'EXECUTIVE MISSION REPORT',
    `${plan.title} · Mission #${plan.id}`,
    '',
    'Objective',
    plan.goal || plan.mission.goal,
    '',
    'Status',
    `${plan.status} · ${kpis.completed_steps}/${kpis.total_steps} steps · ${kpis.completion_rate}% complete`,
    '',
    'Timeline',
    ...timeline.map(s => {
      const tone = s.status === 'completed' ? '✓' : s.status === 'failed' ? '✗' : s.status === 'awaiting_approval' ? '◐' : '·';
      const t = s.started_at ? dayTime(s.started_at) : '—';
      return `${tone} ${s.agent_type} (${s.step_key}) — ${s.status} @ ${t}${s.output ? ': ' + s.output : ''}`;
    }),
    '',
    'Key Performance Indicators',
    `- Completion: ${kpis.completed_steps}/${kpis.total_steps} (${kpis.completion_rate}%)`,
    `- Success rate: ${kpis.success_rate}%`,
    `- Confidence: ${kpis.avg_confidence === null ? '—' : kpis.avg_confidence + '/1.0'}`,
    `- Cost: ${money(kpis.total_cost_cents)}${kpis.budget_cents === null ? '' : ' of ' + money(kpis.budget_cents) + ' budget'}`,
    `- Duration: ${kpis.duration_ms === null ? '—' : (kpis.duration_ms / 1000).toFixed(1) + 's'}`,
    kpis.revenue_cents !== null ? `- Revenue identified: ${money(kpis.revenue_cents)}` : '',
    kpis.expected_revenue_cents !== null ? `- Expected revenue: ${money(kpis.expected_revenue_cents)}` : '',
    '',
    'Workforce',
    ...agents.map(a => `- ${a.agent_type}: ${a.completed}/${a.total} steps (${a.utilization}% utilization)`)
  ].filter(Boolean);
  return lines.join('\n');
}

module.exports = { missionReport, executiveReportText };
