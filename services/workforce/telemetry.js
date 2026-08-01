const { forWorkspace } = require('../../db/repos');
const { emit, EVENT_NAMES } = require('./events');

async function record(adapter, workspaceId, { provider, model, input_tokens = 0, output_tokens = 0, cost_cents = 0, latency_ms = 0, retries = 0, failures = 0, confidence = null }) {
  const repos = forWorkspace(adapter, workspaceId);
  await repos.usage.record({ provider, model, input_tokens, output_tokens, cost_cents });
  emit(EVENT_NAMES.TASK_COMPLETED, { provider, model, cost_cents, latency_ms, retries, confidence });
  return snapshot(adapter, workspaceId);
}

async function snapshot(adapter, workspaceId) {
  const repos = forWorkspace(adapter, workspaceId);
  const sum = await repos.usage.sum();
  const runs = await repos.agentRuns.list();
  const completed = runs.filter(r => r.status === 'completed');
  const avgLatency = completed.length
    ? Math.round(completed.reduce((acc, r) => acc + (r.duration_ms || 0), 0) / completed.length)
    : 0;
  const totalCostCents = sum.cost_cents || 0;
  const byProvider = {};
  for (const r of completed) {
    const key = r.provider || 'unknown';
    byProvider[key] = (byProvider[key] || 0) + 1;
  }
  return {
    runs: runs.length,
    completed: completed.length,
    failed: runs.length - completed.length,
    avgLatencyMs: avgLatency,
    totalCostCents,
    inputTokens: sum.input_tokens || 0,
    outputTokens: sum.output_tokens || 0,
    byProvider,
    generatedAt: new Date().toISOString()
  };
}

module.exports = { record, snapshot };
