const { REGISTRY } = require('./registry');
const { shortTime } = require('./format');
const { runAgent } = require('./runner');
const { getWorkforceView, workforceConsole, todayActivity } = require('./views');
const { costSummary } = require('./analytics');
const { agentHealth, healthCheck } = require('./health');
const { runPipelineDemo, dealTimeline } = require('./pipeline');

const events = require('./events');
const scheduler = require('./scheduler');
const dispatcher = require('./dispatcher');
const planner = require('./planner');
const executor = require('./executor');
const reviewer = require('./reviewer');
const approvals = require('./approvals');
const confidence = require('./confidence');
const optimizer = require('./optimizer');
const recovery = require('./recovery');
const telemetry = require('./telemetry');
const runtime = require('./runtime');

module.exports = {
  REGISTRY,
  getWorkforceView,
  runAgent,
  runPipelineDemo,
  todayActivity,
  shortTime,
  workforceConsole,
  dealTimeline,
  costSummary,
  healthCheck,
  agentHealth,
  EVENT_NAMES: events.EVENT_NAMES,
  events,
  scheduler,
  dispatcher,
  planner,
  executor,
  reviewer,
  approvals,
  confidence,
  optimizer,
  recovery,
  telemetry,
  runtime
};
