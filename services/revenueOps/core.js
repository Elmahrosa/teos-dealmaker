const KEY_MODE = 'sor_mode';
const KEY_LAST_WINDOW = 'sor_last_window_end';
const KEY_CURRENT_WINDOW = 'sor_current_window_end';
const KEY_HEARTBEAT = 'sor_heartbeat';
const KEY_LAST_REPORT = 'sor_last_report_id';

const MODES = Object.freeze({ RUNNING: 'RUNNING', PAUSED: 'PAUSED', STOPPED: 'STOPPED', EMERGENCY_STOPPED: 'EMERGENCY_STOPPED' });

function config() {
  const num = (name, def) => {
    const raw = process.env[name];
    const n = Number(raw);
    return raw !== undefined && raw !== '' && Number.isFinite(n) && n > 0 ? n : def;
  };
  const hours = num('SOR_REPORT_INTERVAL_HOURS', 3);
  return {
    enabled: require('../../db').isSorEnabled(),
    intervalMs: Math.round(hours * 60 * 60 * 1000),
    intervalHours: hours,
    founderEmail: process.env.FOUNDER_REPORT_EMAIL || process.env.FOUNDER_REPORT_TO || 'teosegy@gmail.com',
    from: process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || 'info@elmahrosa.org',
    resendConfigured: Boolean(process.env.RESEND_API_KEY),
    maxBackfillWindows: num('SOR_MAX_BACKFILL_WINDOWS', 8),
    auditKey: process.env.AUDIT_API_KEY ? 'configured' : 'not_configured'
  };
}

function now() {
  return new Date().toISOString();
}

async function repos(db) {
  return db.repos || require('../../db/repos').createRepos(db.adapter);
}

function modePayload(mode, by, reason) {
  return { mode, by: by || 'system', reason: reason || null, at: now() };
}

async function getState(db) {
  const r = await repos(db);
  const [modeRow, lastRow, curRow, hbRow, lastReport] = await Promise.all([
    r.revenueOps.get(KEY_MODE),
    r.revenueOps.get(KEY_LAST_WINDOW),
    r.revenueOps.get(KEY_CURRENT_WINDOW),
    r.revenueOps.get(KEY_HEARTBEAT),
    r.revenueOps.get(KEY_LAST_REPORT)
  ]);
  return {
    mode: modeRow ? (modeRow.value || MODES.PAUSED) : MODES.PAUSED,
    lastWindowEnd: lastRow ? lastRow.value : null,
    currentWindowEnd: curRow ? curRow.value : null,
    heartbeat: hbRow ? hbRow.heartbeat_at : null,
    lastReportId: lastReport ? lastReport.value : null
  };
}

async function setMode(db, mode, by, reason) {
  if (!Object.values(MODES).includes(mode)) return { ok: false, reason: 'invalid_mode' };
  const r = await repos(db);
  await r.revenueOps.set(KEY_MODE, mode, modePayload(mode, by, reason));
  r.audit.add({
    workspace_id: null,
    agent_name: 'revenue-ops',
    action_type: 'REVENUE_OPS_MODE',
    timestamp: now(),
    details: { mode, by: by || 'founder', reason: reason || null }
  });
  return { ok: true, mode };
}

async function heartbeat(db) {
  const r = await repos(db);
  await r.revenueOps.set(KEY_HEARTBEAT, now());
}

module.exports = { config, now, getState, setMode, heartbeat, MODES, KEY_MODE, KEY_LAST_WINDOW, KEY_CURRENT_WINDOW, KEY_HEARTBEAT, KEY_LAST_REPORT };
