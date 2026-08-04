// plugins/sentinel/adapter.js
// Transport adapter for the TEOS Sentinel Shield plugin. Environment-driven:
// every value comes from SENTINEL_*. No hardcoded URLs or secrets. Exported as
// a factory (the loader instantiates it with no arguments; tests may inject
// endpoint/apiKey/timeoutMs/transport). With no endpoint configured the adapter
// serves simulated responses so the shield is fully exercisable in dry mode.
'use strict';

const DEFAULT_TIMEOUT_MS = 15000;

const TOOL_IDS = ['sentinel.scan', 'sentinel.audit', 'sentinel.policy.check', 'sentinel.rules.list', 'sentinel.health'];

function resolveConfig(overrides) {
  const o = overrides || {};
  return {
    endpoint: o.endpoint || process.env.SENTINEL_ENDPOINT || '',
    apiKey: o.apiKey !== undefined ? o.apiKey : (process.env.SENTINEL_API_KEY || ''),
    timeoutMs: o.timeoutMs || parseInt(process.env.SENTINEL_TIMEOUT || String(DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS
  };
}

function defaultTransport() {
  return async (url, options) => {
    if (typeof fetch !== 'function') {
      throw new Error('No fetch transport available for the sentinel plugin');
    }
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  };
}

function createTransport(opts) {
  if (opts && typeof opts.transport === 'function') return opts.transport;
  if (opts && typeof opts.httpClient === 'function') return opts.httpClient;
  return defaultTransport();
}

function extractResult(result) {
  if (result && Array.isArray(result.content)) {
    const text = result.content
      .filter(part => part && part.type === 'text')
      .map(part => part.text)
      .join('\n');
    return { text, isError: Boolean(result.isError), structured: result.structured || null };
  }
  return { text: typeof result === 'string' ? result : JSON.stringify(result), isError: false, structured: null };
}

let idSeq = 0;
function nextId() {
  idSeq += 1;
  return (Date.now() % 100000) + idSeq;
}

function simulated(toolId, payload, request) {
  const body = payload || {};
  const workspaceId = request ? request.workspaceId : body.workspaceId || null;
  switch (toolId) {
    case 'sentinel.scan':
      return { ok: true, data: { status: 'clear', findings: [], scanned_at: new Date().toISOString(), workspace_id: workspaceId }, simulated: true };
    case 'sentinel.audit':
      return { ok: true, data: { workspace_id: workspaceId, entries: [], total: 0 }, simulated: true };
    case 'sentinel.policy.check':
      return { ok: true, data: { policy: 'default-deny', decision: 'no_rule', toolId: body.toolId || null }, simulated: true };
    case 'sentinel.rules.list':
      return {
        ok: true,
        data: {
          rules: [
            { id: 'SENT-001', effect: 'deny', match: 'secrets:*' },
            { id: 'SENT-002', effect: 'deny', match: 'shell:*' },
            { id: 'SENT-003', effect: 'allow', match: 'workspace:*' }
          ],
          total: 3
        },
        simulated: true
      };
    case 'sentinel.health':
      return { ok: true, data: { status: 'healthy', latency_ms: 0 }, simulated: true };
    default:
      return { ok: true, data: { status: 'ok', toolId }, simulated: true };
  }
}

function createAdapter(opts) {
  const transport = createTransport(opts);

  async function send(method, params) {
    const cfg = resolveConfig(opts);
    const startedAt = Date.now();
    if (!cfg.endpoint) {
      return { ok: false, error: 'not_configured', message: 'no sentinel endpoint configured' };
    }
    const body = {
      jsonrpc: '2.0',
      id: nextId(),
      method,
      params: params || {}
    };
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), cfg.timeoutMs) : null;

    try {
      const res = await transport(cfg.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined
      });
      const latency_ms = Date.now() - startedAt;
      if (!res || res.ok === false) {
        const message = (res && res.data && res.data.error && res.data.error.message) ||
          (res && res.status ? `HTTP ${res.status}` : 'no response');
        return { ok: false, error: 'http', message, status: res ? res.status : null, raw: res ? res.data : null, latency_ms };
      }
      const data = res.data;
      if (data && data.error) {
        return { ok: false, error: 'rpc', message: data.error.message || 'rpc_error', code: data.error.code, raw: data, latency_ms };
      }
      return { ok: true, result: data && data.result, raw: data, latency_ms };
    } catch (err) {
      const latency_ms = Date.now() - startedAt;
      const aborted = controller && controller.signal && controller.signal.aborted;
      return { ok: false, error: aborted ? 'timeout' : 'transport', message: err.message || 'transport_error', latency_ms };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function call(request) {
    const cfg = resolveConfig(opts);
    if (!cfg.endpoint) return simulated(request.toolId, request.payload, request);
    const res = await send('tools/call', {
      name: request.toolId,
      arguments: request.payload || {}
    });
    if (!res.ok) return res;
    const extracted = extractResult(res.result);
    if (extracted.isError) {
      return { ok: false, error: 'tool', message: extracted.text || 'tool_error', raw: res.raw, latency_ms: res.latency_ms };
    }
    return {
      ok: true,
      data: extracted.structured !== null && extracted.structured !== undefined ? extracted.structured : extracted.text,
      text: extracted.text,
      raw: res.raw,
      simulated: false,
      latency_ms: res.latency_ms
    };
  }

  async function health() {
    const cfg = resolveConfig(opts);
    if (!cfg.endpoint) return { ok: true, status: 'not_configured', simulated: true };
    const res = await send('ping', {});
    if (!res.ok) {
      return { ok: false, status: 'down', error: res.error, message: res.message, latency_ms: res.latency_ms };
    }
    return { ok: true, status: 'ok', latency_ms: res.latency_ms };
  }

  async function discover() {
    const cfg = resolveConfig(opts);
    if (!cfg.endpoint) return { ok: true, tools: TOOL_IDS.slice(), simulated: true };
    const res = await send('tools/list', {});
    if (!res.ok) return { ok: false, error: res.error, message: res.message };
    const tools = res.result && Array.isArray(res.result.tools)
      ? res.result.tools.map(t => (t && t.name) || null).filter(Boolean)
      : [];
    return { ok: true, tools, simulated: false };
  }

  function initialize() {
    return { ok: true };
  }

  function shutdown() {
    return { ok: true };
  }

  return { config: () => resolveConfig(opts), call, health, discover, initialize, shutdown };
}

module.exports = createAdapter;
