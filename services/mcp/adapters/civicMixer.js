const DEFAULT_TIMEOUT_MS = 15000;

function config() {
  return {
    endpoint: process.env.MCP_ENDPOINT || '',
    apiKey: process.env.MCP_API_KEY || '',
    timeoutMs: parseInt(process.env.MCP_TIMEOUT || String(DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS
  };
}

function defaultTransport() {
  return async (url, options) => {
    if (typeof fetch !== 'function') {
      throw new Error('No fetch transport available for MCP');
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

function createCivicMixerAdapter(opts) {
  const o = opts || {};
  const cfg = {
    endpoint: o.endpoint || process.env.MCP_ENDPOINT || '',
    apiKey: o.apiKey !== undefined ? o.apiKey : process.env.MCP_API_KEY || '',
    timeoutMs: o.timeoutMs || parseInt(process.env.MCP_TIMEOUT || String(DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS
  };
  const transport = createTransport(o);

  async function send(method, params) {
    const startedAt = Date.now();
    const body = {
      jsonrpc: '2.0',
      id: nextId(),
      method,
      params: params || {}
    };
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), cfg.timeoutMs)
      : null;

    try {
      const res = await transport(cfg.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined
      });
      const latencyMs = Date.now() - startedAt;
      if (!res || res.ok === false) {
        const message = (res && res.data && res.data.error && res.data.error.message) ||
          (res && res.status ? `HTTP ${res.status}` : 'no response');
        return { ok: false, error: 'http', message, status: res ? res.status : null, raw: res ? res.data : null, latency_ms: latencyMs };
      }
      const data = res.data;
      if (data && data.error) {
        return { ok: false, error: 'rpc', message: data.error.message || 'rpc_error', code: data.error.code, raw: data, latency_ms: latencyMs };
      }
      return { ok: true, result: data && data.result, raw: data, latency_ms: latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const aborted = controller && controller.signal && controller.signal.aborted;
      return { ok: false, error: aborted ? 'timeout' : 'transport', message: err.message || 'transport_error', latency_ms: latencyMs };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function call(request) {
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
    const res = await send('ping', {});
    if (!res.ok) {
      return { ok: false, status: 'down', error: res.error, message: res.message, latency_ms: res.latency_ms };
    }
    return { ok: true, status: 'ok', latency_ms: res.latency_ms };
  }

  async function discover() {
    const res = await send('tools/list', {});
    if (!res.ok) return { ok: false, error: res.error, message: res.message };
    const tools = res.result && Array.isArray(res.result.tools)
      ? res.result.tools.map(t => (t && t.name) || null).filter(Boolean)
      : [];
    return { ok: true, tools, simulated: false };
  }

  return { call, health, discover, config: () => cfg };
}

module.exports = { createCivicMixerAdapter, config, extractResult };
