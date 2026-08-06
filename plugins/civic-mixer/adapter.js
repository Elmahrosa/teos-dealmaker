// plugins/civic-mixer/adapter.js
// Transport adapter for the TEOS Civic Mixer plugin. Environment-driven: every
// value comes from CIVIC_MIXER_* (falling back to the legacy MCP_* names so an
// existing gateway configuration keeps working). No hardcoded URLs or secrets.
//
// Exported as a factory: the plugin loader instantiates it with no arguments;
// tests may inject endpoint/apiKey/timeoutMs/transport for offline verification.
// With no endpoint configured the adapter serves simulated responses so the
// plugin is fully exercisable in dry mode.
'use strict';

const audit = require('./audit');

const DEFAULT_TIMEOUT_MS = 15000;

const TOOL_IDS = ['civic.lookup', 'civic.identity.verify', 'civic.vote.create', 'civic.issue.create', 'civic.issue.list'];

const WRITE_ACTIONS = {
  'civic.vote.create': 'CIVIC_BALLOT_CREATE',
  'civic.issue.create': 'CIVIC_ISSUE_CREATE'
};

function resolveConfig(overrides) {
  const o = overrides || {};
  const apiKey = o.apiKey !== undefined ? o.apiKey : (process.env.CIVIC_MIXER_API_KEY || process.env.MCP_API_KEY || '');
  return {
    endpoint: o.endpoint || process.env.CIVIC_MIXER_ENDPOINT || process.env.MCP_ENDPOINT || '',
    apiKey,
    timeoutMs: o.timeoutMs || parseInt(process.env.CIVIC_MIXER_TIMEOUT || process.env.MCP_TIMEOUT || String(DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS
  };
}

function redactedConfig(cfg) {
  return {
    endpoint: cfg.endpoint,
    apiKey: cfg.apiKey ? '***redacted***' : '',
    timeoutMs: cfg.timeoutMs,
    hasApiKey: Boolean(cfg.apiKey)
  };
}

function defaultTransport() {
  return async (url, options) => {
    if (typeof fetch !== 'function') {
      throw new Error('No fetch transport available for the civic-mixer plugin');
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

function simulated(toolId, payload) {
  const body = payload || {};
  switch (toolId) {
    case 'civic.lookup':
      return { ok: true, data: { entity: { civicId: body.civicId || 'CIVIC-0001', name: 'Test Entity' }, status: 'found' }, simulated: true };
    case 'civic.identity.verify':
      return { ok: true, data: { identityId: body.identityId || 'IDENT-0001', verified: true, confidence: 0.98 }, simulated: true };
    case 'civic.vote.create':
      return { ok: true, data: { ballotId: 'BALLOT-0001', status: 'draft' }, simulated: true };
    case 'civic.issue.create':
      return { ok: true, data: { issueId: 'ISSUE-0001', status: 'open' }, simulated: true };
    case 'civic.issue.list':
      return { ok: true, data: { issues: [], total: 0 }, simulated: true };
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
      return { ok: false, error: 'not_configured', message: 'no civic mixer endpoint configured' };
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
    const payload = request.payload || {};
    const writeAction = WRITE_ACTIONS[request.toolId];
    const actor = String(request.requester || 'system');
    const auditMeta = { toolId: request.toolId };
    if (writeAction) {
      audit.write('CIVIC_WRITE_ATTEMPT', actor, 'attempt', Object.assign({ actionType: writeAction }, auditMeta));
    }
    const cfg = resolveConfig(opts);
    if (!cfg.endpoint) {
      const result = simulated(request.toolId, payload);
      if (writeAction) audit.write('CIVIC_WRITE_SIMULATED', actor, 'success', auditMeta);
      return result;
    }
    const res = await send('tools/call', {
      name: request.toolId,
      arguments: payload
    });
    if (!res.ok) {
      if (writeAction) audit.write('CIVIC_WRITE_REJECTED', actor, 'failed', Object.assign({ error: res.error }, auditMeta));
      return res;
    }
    const extracted = extractResult(res.result);
    if (extracted.isError) {
      if (writeAction) audit.write('CIVIC_WRITE_REJECTED', actor, 'failed', Object.assign({ error: 'tool' }, auditMeta));
      return { ok: false, error: 'tool', message: extracted.text || 'tool_error', raw: res.raw, latency_ms: res.latency_ms };
    }
    if (writeAction) audit.write('CIVIC_WRITE_APPROVED', actor, 'success', auditMeta);
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

  return { config: () => redactedConfig(resolveConfig(opts)), call, health, discover, initialize, shutdown };
}

module.exports = createAdapter;
