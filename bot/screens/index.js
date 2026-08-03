const home = require('./home');
const missions = require('./missions');
const learning = require('./learning');
const onboarding = require('./onboarding');
const deals = require('./deals');
const pipeline = require('./pipeline');
const workforce = require('./workforce');
const providers = require('./providers');
const settings = require('./settings');
const admin = require('./admin');
const audit = require('./audit');
const pricing = require('./pricing');
const intelligence = require('./intelligence');
const integrations = require('./integrations');
const ops = require('./ops');

module.exports = {
  onboarding,
  buildPipelineResult: pipeline.buildPipelineResult,
  buildSalesDemo: pipeline.buildSalesDemo,
  buildProviderPicker: providers.buildProviderPicker,
  buildMemoryEdit: settings.buildMemoryEdit,
  buildKnowledgeAdd: intelligence.buildKnowledgeAdd,
  buildKnowledgeAskPrompt: intelligence.buildKnowledgeAskPrompt,
  modeConfirm: admin.modeConfirm,
  applyMode: admin.applyMode,
  buildHome: home.buildHome,
  buildDashboard: home.buildDashboard,
  buildWorkforce: workforce.buildWorkforce,
  buildPipeline: pipeline.buildPipeline,
  buildDeals: deals.buildDeals,
  buildAudit: audit.buildAudit,
  buildPricing: pricing.buildPricing,
  buildAdmin: admin.buildAdmin,
  buildAiGuide: settings.buildAiGuide,
  buildSettings: settings.buildSettings,
  buildMemory: settings.buildMemory,
  buildActivity: workforce.buildActivity,
  buildAgentDetail: workforce.buildAgentDetail,
  buildTimeline: deals.buildTimeline,
  buildCosts: providers.buildCosts,
  buildHealth: ops.buildHealth,
  buildProviders: providers.buildProviders,
  buildQueue: ops.buildQueue,
  buildBriefing: ops.buildBriefing,
  buildIntelligence: intelligence.buildIntelligence,
  buildKnowledgeDocs: intelligence.buildKnowledgeDocs,
  buildAskResult: intelligence.buildAskResult,
  buildIntegrations: integrations.buildIntegrations,
  buildAllConnectors: integrations.buildAllConnectors,
  buildConnectorDetail: integrations.buildConnectorDetail,
  buildSyncResult: integrations.buildSyncResult,
  buildLearn: learning.buildLearn,
  buildMissions: missions.buildMissions,
  buildMissionDetail: missions.buildMissionDetail,
  buildApprovals: missions.buildApprovals,
  buildMissionGoalPrompt: missions.buildMissionGoalPrompt,
  buildMissionRunResult: missions.buildMissionRunResult,
  launchMission1: missions.launchMission1,
  launchMission2: missions.launchMission2,
  launchGoalMission: missions.launchGoalMission,
  launchMarketMission: missions.launchMarketMission
};
