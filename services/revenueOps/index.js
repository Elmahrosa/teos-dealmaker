const core = require('./core');
const scheduler = require('./scheduler');
const prospects = require('./prospects');
const report = require('./report');
const control = require('./control');
const discovery = require('./discovery');
const approvals = require('./approvals');

const schedulerInstance = {};

async function getDb(adapter) {
  if (adapter) return { adapter, pg: adapter && adapter.kind === 'pg' ? require('../../db').getPool() : null, repos: require('../../db/repos').createRepos(adapter) };
  const db = require('../../db').getDb();
  return db;
}

function stopSchedulerClock() {
  if (schedulerInstance.timer) {
    schedulerInstance.timer.stop();
    schedulerInstance.timer = null;
  }
}

function startWithDb(db) {
  if (!schedulerInstance.timer) schedulerInstance.timer = scheduler.createScheduler();
  return schedulerInstance.timer.start(db);
}

const controlHandle = control.createControl({
  hooks: {
    onPause: stopSchedulerClock,
    onEmergencyStop: stopSchedulerClock,
    onResume: (db) => startWithDb(db)
  }
});

async function status(adapter) {
  const db = await getDb(adapter);
  const c = core.config();
  const ctrl = await controlHandle.status(db);
  const r = db.repos;
  const [reports, prospectsCount] = await Promise.all([
    r.founderReports.list({ limit: 10 }),
    r.prospects.count()
  ]);
  const lastReport = reports && reports.length ? reports[0] : null;
  return {
    ok: true,
    enabled: c.enabled,
    mode: ctrl.mode,
    guard: ctrl.guard,
    intervalHours: c.intervalHours,
    founderEmail: c.founderEmail,
    sender: c.from,
    resendConfigured: c.resendConfigured,
    lastWindowEnd: ctrl.lastWindowEnd,
    currentWindowEnd: ctrl.lastWindowEnd,
    heartbeat: ctrl.heartbeat,
    lastReportId: ctrl.lastReportId,
    emergency: ctrl.emergency,
    lastReport: lastReport ? { report_id: lastReport.report_id, window_end: lastReport.window_end, delivery_status: lastReport.delivery_status, generated_at: lastReport.generated_at, metrics: lastReport.metrics } : null,
    reportsTotal: (await r.founderReports.list({ limit: 5000 })).length,
    prospectsTotal: prospectsCount
  };
}

async function triggerNow(adapter, by) {
  const db = await getDb(adapter);
  const c = core.config();
  if (!c.enabled) return { ok: false, reason: 'sor_disabled' };
  await prospects.syncFromOutbound(db, 200);
  const discovered = await discovery.discover(db, { onlyUnscored: false, limit: 200 });
  const res = await scheduler.tick(db, { force: true, by: by || 'founder' });
  if (res.ok && res.processed) await prospects.syncFromOutbound(db, 200);
  return Object.assign({}, res, { discovered: discovered.scored });
}

async function discover(adapter, opts) {
  const db = await getDb(adapter);
  return discovery.discover(db, opts || {});
}

async function approvalSummary(adapter) {
  const db = await getDb(adapter);
  return approvals.summary(db);
}

async function notifyFounder(adapter, opts) {
  const db = await getDb(adapter);
  return approvals.notifyFounder(db, opts || {});
}

async function pause(adapter, by, reason) {
  const db = await getDb(adapter);
  return controlHandle.pause(db, by, reason);
}

async function resume(adapter, by, reason, opts) {
  const db = await getDb(adapter);
  return controlHandle.resume(db, by, reason, opts);
}

async function emergencyStop(adapter, by, reason) {
  const db = await getDb(adapter);
  return controlHandle.emergencyStop(db, by, reason);
}

async function start(adapter) {
  const db = await getDb(adapter);
  return startWithDb(db);
}

async function stop() {
  stopSchedulerClock();
  return { ok: true };
}

async function recordProspect(adapter, data) {
  const db = await getDb(adapter);
  return prospects.record(db, data);
}

async function syncProspects(adapter, limit) {
  const db = await getDb(adapter);
  return prospects.syncFromOutbound(db, limit);
}

async function setMode(adapter, mode, by, reason) {
  const db = await getDb(adapter);
  return core.setMode(db, mode, by, reason);
}

module.exports = { status, triggerNow, pause, resume, emergencyStop, setMode, start, stop, recordProspect, syncProspects, discover, approvalSummary, notifyFounder, _core: core, _report: report, _scheduler: scheduler, _control: controlHandle, _discovery: discovery, _approvals: approvals };
