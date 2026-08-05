const design = require('./design');
const audit = require('../utils/auditLogger');
const screens = require('./screens');
const missionState = require('./missionState');
const knowledgeState = require('./knowledgeState');
const memoryEdit = require('./memoryEdit');
const { getStoreAdapter } = require('./store');
const { isFounder, isAdmin } = require('./access');
const { setApprovalMode } = require('../config/approval');
const i18n = require('./i18n');
const { setWorkspaceLang } = require('../services/workspace');
const providers = require('../services/providers');
const intelligence = require('../services/intelligence');
const integrations = require('../services/integrations');
const runtime = require('../services/workforce/runtime');
const workforce = require('../services/workforce');
const { getCtx, denied, editPanel } = require('./screens/lib');

async function handleCallback(query, bot) {
  const action = query.data || '';
  const userId = query.from ? query.from.id : null;
  audit.writeEntry('BOT_CALLBACK', action, 'success', { userId });

  try {
    await bot.answerCallbackQuery(query.id, { text: 'OK' });
  } catch (_) { /* ignore */ }

  const send = async screen => editPanel(bot, query, screen);

  switch (action) {
    case 'cc_home':
    case 'btn_back':
      return send(await screens.buildHome(userId));
    case 'cc_dashboard':
      return send(await screens.buildDashboard(userId));
    case 'cc_workforce':
      return send(await screens.buildWorkforce(userId));
    case 'cc_pipeline':
      return send(screens.buildPipeline());
    case 'cc_deals':
      return send(await screens.buildDeals(userId));
    case 'cc_pricing':
      return send(screens.buildPricing(userId));
    case 'cc_ai_guide':
      return send(screens.buildAiGuide());
    case 'cc_settings':
      return send(await screens.buildSettings(userId));
    case 'cc_learn': {
      const lctx = await getCtx(userId);
      if (!lctx) return send(denied('learning'));
      screens.onboarding.begin(userId);
      return send(await screens.onboarding.prompt(userId, getStoreAdapter(), lctx.workspace.id));
    }
    case 'cc_learn_skip': {
      const lctx = await getCtx(userId);
      if (!lctx) return send(denied('learning'));
      return send(await screens.onboarding.skip(userId, getStoreAdapter(), lctx.workspace.id));
    }
    case 'cc_learn_done': {
      const lctx = await getCtx(userId);
      if (!lctx) return send(denied('learning'));
      return send(await screens.onboarding.answer(userId, getStoreAdapter(), lctx.workspace.id));
    }
    case 'cc_learn_more': {
      const lctx = await getCtx(userId);
      if (!lctx) return send(denied('learning'));
      return send(await screens.onboarding.more(userId, getStoreAdapter(), lctx.workspace.id));
    }
    case 'cc_learn_quit':
      screens.onboarding.quit(userId);
      return send(await screens.buildHome(userId));
    case 'cc_missions':
      return send(await screens.buildMissions(userId));
    case 'cc_mission_goal':
      missionState.begin(userId, {});
      return send(await screens.buildMissionGoalPrompt(userId));
    case 'cc_mission1': {
      try { await bot.sendChatAction(query.message.chat.id, 'typing'); } catch (_) { /* ignore */ }
      try {
        return send(await screens.launchMission1(userId));
      } catch (err) {
        audit.writeEntry('BOT_MISSION1_ERROR', String(userId), 'error', { error: err.message });
        return send({ text: design.errorPanel('Mission 1 failed', String(err.message)).text, keyboard: null });
      }
    }
    case 'cc_mission2': {
      try { await bot.sendChatAction(query.message.chat.id, 'typing'); } catch (_) { /* ignore */ }
      try {
        return send(await screens.launchMission2(userId));
      } catch (err) {
        audit.writeEntry('BOT_MISSION2_ERROR', String(userId), 'error', { error: err.message });
        return send({ text: design.errorPanel('Mission 2 failed', String(err.message)).text, keyboard: null });
      }
    }
    case 'cc_mission_market': {
      try { await bot.sendChatAction(query.message.chat.id, 'typing'); } catch (_) { /* ignore */ }
      try {
        return send(await screens.launchMarketMission(userId));
      } catch (err) {
        audit.writeEntry('BOT_MISSION_MARKET_ERROR', String(userId), 'error', { error: err.message });
        return send({ text: design.errorPanel('Market analysis failed', String(err.message)).text, keyboard: null });
      }
    }
    case 'cc_approvals':
      return send(await screens.buildApprovals(userId));
    case 'cc_memory':
      return send(await screens.buildMemory(userId));
    case 'cc_mem_cancel':
      memoryEdit.clear(userId);
      return send(await screens.buildMemory(userId));
    case 'cc_mem_edit:': {
      memoryEdit.clear(userId);
      return send(await screens.buildMemory(userId));
    }
    case 'cc_activity':
      return send(await screens.buildActivity(userId));
    case 'cc_timeline':
      return send(await screens.buildTimeline(userId));
    case 'cc_costs':
      return send(await screens.buildCosts(userId));
    case 'cc_health':
      return send(await screens.buildHealth(userId));
    case 'cc_providers':
      return send(await screens.buildProviders(userId));
    case 'cc_queue':
      return send(await screens.buildQueue(userId));
    case 'cc_briefing':
      return send(await screens.buildBriefing(userId));
    case 'cc_integrations':
      return send(await screens.buildIntegrations(userId));
    case 'cc_int_all':
      return send(await screens.buildAllConnectors(userId));
    case 'cc_sync_now': {
      const ctx = await getCtx(userId);
      if (!ctx) return send(denied('integration sync'));
      try { await bot.sendChatAction(query.message.chat.id, 'typing'); } catch (_) { /* ignore */ }
      try {
        const result = await integrations.createIntegrations(getStoreAdapter(), ctx.workspace.id).sync();
        return send(await screens.buildSyncResult(userId, result));
      } catch (err) {
        audit.writeEntry('BOT_INTEGRATION_SYNC', String(userId), 'error', { error: err.message });
        return send({ text: design.errorPanel('Sync failed', String(err.message)).text, keyboard: null });
      }
    }
    case 'cc_intelligence':
      return send(await screens.buildIntelligence(userId));
    case 'cc_kg_docs':
      return send(await screens.buildKnowledgeDocs(userId));
    case 'cc_kg_cancel':
      knowledgeState.clear(userId);
      return send(await screens.buildIntelligence(userId));
    case 'cc_kg_ask': {
      knowledgeState.begin(userId, 'kg_ask', {});
      return send(screens.buildKnowledgeAskPrompt(userId));
    }
    case 'cc_kg_add': {
      const rows = Object.keys(intelligence.SOURCE_TYPES).map(k => [
        design.textButton(intelligence.SOURCE_TYPES[k].label, `cc_kg_source:${k}`)
      ]);
      rows.push([design.textButton('Cancel', 'cc_intelligence')]);
      return send({
        text: design.compose([
          `${design.EMOJI.ai} ${design.b('Add Knowledge')}`,
          design.it('Choose the type of knowledge you are adding.'),
          design.divider()
        ]),
        keyboard: design.keyboard(rows)
      });
    }
    case 'cc_audit': {
      if (!isAdmin(userId)) return send(denied('audit feed'));
      return send(screens.buildAudit(0));
    }
    case 'cc_fd_mode':
      if (!isFounder(userId)) return send(denied('founder actions'));
      return send(screens.buildFounderSystemMode(userId));
    case 'cc_fd_approval':
      if (!isFounder(userId)) return send(denied('founder actions'));
      return send(screens.buildFounderApproval(userId));
    case 'cc_fd_billing':
      if (!isFounder(userId)) return send(denied('founder actions'));
      return send(screens.buildFounderBilling(userId));
    case 'cc_fd_workspaces':
      if (!isFounder(userId)) return send(denied('founder actions'));
      return send(await screens.buildFounderWorkspaces(userId));
    case 'cc_fd_customers':
      if (!isFounder(userId)) return send(denied('founder actions'));
      return send(await screens.buildFounderCustomers(userId));
    case 'cc_fd_revenue':
      if (!isFounder(userId)) return send(denied('founder actions'));
      return send(await screens.buildFounderRevenue(userId));
    case 'cc_fd_debug':
      if (!isFounder(userId)) return send(denied('founder actions'));
      return send(await screens.buildFounderDebug(userId));
    case 'cc_fd_ops':
      if (!isFounder(userId)) return send(denied('founder actions'));
      return send(await screens.buildFounderOps(userId));
    case 'cc_fd_sentinel':
      if (!isFounder(userId)) return send(denied('founder actions'));
      return send(screens.buildFounderSentinel(userId));
    case 'cc_fd_policy':
      if (!isFounder(userId)) return send(denied('founder actions'));
      return send(screens.buildFounderPolicy(userId));
    case 'cc_fd_analytics':
      if (!isFounder(userId)) return send(denied('founder actions'));
      return send(await screens.buildFounderAnalytics(userId));
    case 'cc_fd_flags':
      if (!isFounder(userId)) return send(denied('founder actions'));
      return send(screens.buildFounderFlags(userId));
    case 'cc_fd_emergency':
      if (!isFounder(userId)) return send(denied('founder actions'));
      return send(screens.buildFounderEmergency(userId));
    case 'cc_fd_emergency_stop':
      if (!isFounder(userId)) return send(denied('founder actions'));
      require('../config/emergency').setEmergencyStop(true);
      audit.writeEntry('BOT_EMERGENCY_STOP', String(userId), 'success', { engaged: true });
      return send(screens.buildFounderEmergency(userId));
    case 'cc_fd_emergency_resume':
      if (!isFounder(userId)) return send(denied('founder actions'));
      require('../config/emergency').setEmergencyStop(false);
      audit.writeEntry('BOT_EMERGENCY_STOP', String(userId), 'success', { engaged: false });
      return send(screens.buildFounderEmergency(userId));
    default: {
      if (action.startsWith('cc_audit:')) {
        if (!isAdmin(userId)) return send(denied('audit feed'));
        return send(screens.buildAudit(Number(action.split(':')[1]) || 0));
      }
      if (action === 'cc_admin') {
        if (!isAdmin(userId)) return send(denied('admin console'));
        return send(screens.buildAdmin(userId));
      }
      if (action === 'cc_sales_run') {
        try { await bot.sendChatAction(query.message.chat.id, 'typing'); } catch (_) { /* ignore */ }
        return send(screens.buildSalesFlow());
      }
      if (action === 'cc_pipeline_run') {
        try { await bot.sendChatAction(query.message.chat.id, 'typing'); } catch (_) { /* ignore */ }
        const ctx = await getCtx(userId);
        if (!ctx) return send({ text: design.errorPanel('No workspace', 'Provision a workspace first.').text, keyboard: null });
        try {
          const result = await workforce.runPipeline(getStoreAdapter(), ctx.workspace.id);
          return send(screens.buildPipelineResult(userId, result));
        } catch (err) {
          audit.writeEntry('BOT_PIPELINE_ERROR', String(userId), 'error', { error: err.message });
          return send({ text: design.errorPanel('Pipeline failed', String(err.message)).text, keyboard: null });
        }
      }
      if (action.startsWith('cc_agent:')) {
        const agentType = action.split(':')[1];
        return send(await screens.buildAgentDetail(userId, agentType));
      }
      if (action.startsWith('cc_mem_edit:')) {
        const key = action.split(':')[1];
        memoryEdit.begin(userId, key);
        return send(screens.buildMemoryEdit(userId, key));
      }
      if (action.startsWith('cc_timeline_deal:')) {
        const dealId = action.split(':')[1];
        return send(await screens.buildTimeline(userId, dealId));
      }
      if (action.startsWith('cc_pol:')) {
        const agentType = action.split(':')[1];
        return send(await screens.buildProviderPicker(userId, agentType));
      }
      if (action.startsWith('cc_pol_set:')) {
        const parts = action.split(':');
        const agentType = parts[1];
        const providerKey = parts[2];
        const ctx = await getCtx(userId);
        if (!ctx) return send(denied('provider policy'));
        const repos = require('../db/repos').createRepos(getStoreAdapter());
        const target = providers.PROVIDERS[providerKey];
        const model = providers.resolveModel(providerKey, target ? target.defaultModel : null);
        await repos.providerPolicies.set(ctx.workspace.id, agentType, providerKey, model);
        audit.writeEntry('BOT_POLICY_SET', String(userId), 'success', {
          agent: agentType, provider: providerKey, model
        });
        return send(await screens.buildProviders(userId));
      }
      if (action.startsWith('cc_kg_source:')) {
        const sourceType = action.split(':')[1];
        knowledgeState.begin(userId, 'kg_add', { source_type: sourceType });
        return send(screens.buildKnowledgeAdd(userId, sourceType));
      }
      if (action.startsWith('cc_kg_del:')) {
        const id = action.split(':')[1];
        const ctx = await getCtx(userId);
        if (!ctx) return send(denied('intelligence'));
        await intelligence.removeDocument(getStoreAdapter(), ctx.workspace.id, id);
        audit.writeEntry('BOT_INTEL_DOC_DEL', String(userId), 'success', { id });
        return send(await screens.buildKnowledgeDocs(userId));
      }
      if (action.startsWith('cc_int_conn:')) {
        const connectorId = action.split(':')[1];
        return send(await screens.buildConnectorDetail(userId, connectorId));
      }
      if (action.startsWith('cc_int_enable:')) {
        const connectorId = action.split(':')[1];
        const ctx = await getCtx(userId);
        if (!ctx) return send(denied('integrations'));
        try {
          await integrations.manager.enable(getStoreAdapter(), ctx.workspace.id, connectorId);
          audit.writeEntry('BOT_INT_ENABLE', String(userId), 'success', { connector: connectorId });
        } catch (err) {
          audit.writeEntry('BOT_INT_ENABLE', String(userId), 'error', { connector: connectorId, error: err.message });
        }
        return send(await screens.buildConnectorDetail(userId, connectorId));
      }
      if (action.startsWith('cc_int_disable:')) {
        const connectorId = action.split(':')[1];
        const ctx = await getCtx(userId);
        if (!ctx) return send(denied('integrations'));
        try {
          await integrations.manager.disable(getStoreAdapter(), ctx.workspace.id, connectorId);
          audit.writeEntry('BOT_INT_DISABLE', String(userId), 'success', { connector: connectorId });
        } catch (err) {
          audit.writeEntry('BOT_INT_DISABLE', String(userId), 'error', { connector: connectorId, error: err.message });
        }
        return send(await screens.buildConnectorDetail(userId, connectorId));
      }
      if (action.startsWith('cc_int_test:')) {
        const connectorId = action.split(':')[1];
        const ctx = await getCtx(userId);
        if (!ctx) return send(denied('integrations'));
        const t = await integrations.manager.test(getStoreAdapter(), ctx.workspace.id, connectorId);
        return bot.answerCallbackQuery(query.id, {
          text: t.ok ? (t.live ? t.label + ': connected (live)' : t.label + ': dry-run OK') : t.detail
        }).catch(() => {});
      }
      if (action.startsWith('cc_int_auth:')) {
        const connectorId = action.split(':')[1];
        const ctx = await getCtx(userId);
        if (!ctx) return send(denied('integrations'));
        const c = integrations.catalog.CONNECTORS[connectorId];
        const auth = integrations.oauth.beginAuth(connectorId, userId);
        if (!auth.url) {
          return bot.answerCallbackQuery(query.id, { text: c.label + ' does not support OAuth' }).catch(() => {});
        }
        return bot.answerCallbackQuery(query.id, { text: 'Authorize here: ' + auth.url }).catch(() => {});
      }
      if (action === 'cc_live') {
        if (!isFounder(userId)) return send(denied('founder actions'));
        return send(screens.modeConfirm('LIVE'));
      }
      if (action === 'cc_live_confirm') {
        if (!isFounder(userId)) return send(denied('founder actions'));
        return screens.applyMode(query, bot, 'LIVE');
      }
      if (action === 'cc_live_cancel') return send(screens.buildAdmin(userId));
      if (action === 'cc_dry') {
        if (!isFounder(userId)) return send(denied('founder actions'));
        return send(screens.modeConfirm('DRY'));
      }
      if (action === 'cc_dry_confirm') {
        if (!isFounder(userId)) return send(denied('founder actions'));
        return screens.applyMode(query, bot, 'DRY');
      }
      if (action === 'cc_dry_cancel') return send(screens.buildAdmin(userId));
      if (action.startsWith('cc_set_lang:')) {
        const lang = action.split(':')[1];
        if (lang !== 'en' && lang !== 'ar') {
          return bot.answerCallbackQuery(query.id, { text: 'Unknown language' }).catch(() => {});
        }
        i18n.setLang(userId, lang);
        const ctx = await getCtx(userId);
        if (ctx) {
          await setWorkspaceLang(getStoreAdapter(), ctx.workspace.id, lang).catch(err =>
            console.error('[menu] setWorkspaceLang failed:', err.message));
        }
        return send(await screens.buildSettings(userId));
      }
      if (action.startsWith('cc_fd_approval_set:')) {
        if (!isFounder(userId)) return send(denied('founder actions'));
        const mode = action.split(':')[1];
        try {
          setApprovalMode(mode);
          audit.writeEntry('BOT_APPROVAL_MODE', String(userId), 'success', { mode });
          return send(screens.buildFounderApproval(userId));
        } catch (err) {
          return send({ text: design.errorPanel('Approval mode', String(err.message)).text, keyboard: null });
        }
      }
      if (action.startsWith('cc_fd_flags_set:')) {
        if (!isFounder(userId)) return send(denied('founder actions'));
        const flagKey = action.split(':')[1];
        const flags = require('../config/flags');
        const current = flags.list();
        try {
          const updated = flags.setFlag(flagKey, current[flagKey] === false);
          audit.writeEntry('BOT_FEATURE_FLAG', String(userId), 'success', { flag: flagKey, enabled: updated[flagKey] !== false });
          return send(screens.buildFounderFlags(userId));
        } catch (err) {
          return send({ text: design.errorPanel('Feature flag', String(err.message)).text, keyboard: null });
        }
      }
      if (action === 'cc_connect_crm') {
        return send(await screens.buildIntegrations(userId));
      }
      if (action === 'cc_upload_catalog') {
        return bot.answerCallbackQuery(query.id, { text: 'Coming soon — Company Knowledge is on the roadmap' }).catch(() => {});
      }
      if (action === 'cc_launch_campaign') {
        return bot.answerCallbackQuery(query.id, { text: 'Coming soon — Campaigns arrive with the revenue pipeline' }).catch(() => {});
      }
      if (action.startsWith('cc_learn_persona:')) {
        const name = action.split(':').slice(1).join(':');
        const lctx = await getCtx(userId);
        if (!lctx) return send(denied('learning'));
        return send(await screens.onboarding.persona(userId, getStoreAdapter(), lctx.workspace.id, name));
      }
      if (action.startsWith('cc_mission:')) {
        const planId = action.split(':')[1];
        return send(await screens.buildMissionDetail(userId, planId));
      }
      if (action.startsWith('cc_mission_pause:')) {
        const ctx = await getCtx(userId);
        if (!ctx) return send(denied('missions'));
        const planId = action.split(':')[1];
        try {
          await bot.sendChatAction(query.message.chat.id, 'typing'); } catch (_) { /* ignore */ }
        await runtime.pause(getStoreAdapter(), ctx.workspace.id, Number(planId));
        audit.writeEntry('BOT_MISSION_PAUSE', String(userId), 'success', { planId });
        return send(await screens.buildMissionDetail(userId, planId));
      }
      if (action.startsWith('cc_mission_resume:')) {
        const ctx = await getCtx(userId);
        if (!ctx) return send(denied('missions'));
        const planId = action.split(':')[1];
        try {
          await bot.sendChatAction(query.message.chat.id, 'typing'); } catch (_) { /* ignore */ }
        const result = await runtime.resume(getStoreAdapter(), ctx.workspace.id, Number(planId));
        audit.writeEntry('BOT_MISSION_RESUME', String(userId), 'success', { planId });
        return send(await screens.buildMissionRunResult(userId, Number(planId), result));
      }
      if (action.startsWith('cc_appr:')) {
        const parts = action.split(':');
        const requestId = parts[1];
        const decision = parts[2];
        const ctx = await getCtx(userId);
        if (!ctx) return send(denied('approvals'));
        try {
          await bot.sendChatAction(query.message.chat.id, 'typing'); } catch (_) { /* ignore */ }
        await runtime.approveAndResume(getStoreAdapter(), ctx.workspace.id, Number(requestId), userId);
        audit.writeEntry('BOT_APPROVAL_DECIDE', String(userId), 'success', { requestId, decision });
        return send(await screens.buildApprovals(userId));
      }
      return bot.answerCallbackQuery(query.id, { text: 'Unknown action' }).catch(() => {});
    }
  }
}

module.exports = {
  ...screens,
  handleCallback
};
