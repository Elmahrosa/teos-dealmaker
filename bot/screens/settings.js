const design = require('../design');
const i18n = require('../i18n');
const { getStoreAdapter } = require('../store');
const memory = require('../../services/memory');
const { getCtx, titleCase } = require('./lib');

async function buildSettings(userId) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  const s = (ctx && ctx.settings) || { lang: 'en', timezone: 'UTC', notifications: 'on', theme: 'system' };
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(t('settings_title'))}`,
    design.it(t('settings_workspace_config')),
    design.divider(),
    design.row(t('settings_language'), s.lang),
    design.row(t('settings_timezone'), s.timezone),
    design.row(t('settings_notifications'), s.notifications),
    design.row(t('settings_theme'), s.theme),
    design.section(t('settings_sect_knowledge')),
    design.it(t('settings_knowledge_desc')),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton(t('lang_en'), 'cc_set_lang:en'), design.textButton(t('lang_ar'), 'cc_set_lang:ar')],
      [design.textButton(t('btn_company_intelligence'), 'cc_intelligence')],
      [design.textButton(t('btn_back_home'), 'cc_home')]
    ])
  };
}

function buildAiGuide(userId) {
  const t = key => i18n.t(userId, key);
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(t('guide_title'))}`,
    design.it(t('guide_sub')),
    design.divider(),
    design.section(t('guide_sect_team')),
    design.it(t('guide_team_desc')),
    design.section(t('guide_sect_missions')),
    design.it(t('guide_missions_desc')),
    design.section(t('guide_sect_flow')),
    design.it(t('guide_flow_desc')),
    design.section(t('guide_sect_teamwork')),
    design.it(t('guide_teamwork_desc')),
    design.section(t('guide_sect_knowledge')),
    design.it(t('guide_knowledge_desc')),
    design.section(t('guide_sect_integrations')),
    design.it(t('guide_integrations_desc')),
    design.section(t('guide_sect_control')),
    design.it(t('guide_control_desc')),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton(t('btn_back_home'), 'cc_home')]
    ])
  };
}

async function buildMemory(userId) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  if (!ctx) return { text: design.errorPanel('No workspace', 'Provision a workspace first with /start.').text, keyboard: null };
  const mem = await memory.getMemory(getStoreAdapter(), ctx.workspace.id);
  const rows = memory.describe(mem);
  const lines = [
    `${design.EMOJI.ai} ${design.b(t('memory_title'))}`,
    design.it(t('memory_sub')),
    design.divider(),
    ...(rows.length ? rows.map(r => design.row(r.split(':')[0], r.split(':').slice(1).join(':'))) : [design.it(t('memory_empty'))]),
    design.section(t('memory_sect_how')),
    design.it(t('memory_how_prospector')),
    design.it(t('memory_how_outreach')),
    design.it(t('memory_how_negotiator')),
    design.divider()
  ];
  return {
    text: design.compose(lines),
    keyboard: design.keyboard([
      [design.textButton(t('btn_edit_company'), 'cc_mem_edit:company_name'), design.textButton(t('btn_edit_industry'), 'cc_mem_edit:industry')],
      [design.textButton(t('btn_edit_products'), 'cc_mem_edit:products'), design.textButton(t('btn_edit_services'), 'cc_mem_edit:services')],
      [design.textButton(t('btn_edit_icp'), 'cc_mem_edit:icp'), design.textButton(t('btn_edit_competitors'), 'cc_mem_edit:competitors')],
      [design.textButton(t('btn_edit_brand_voice'), 'cc_mem_edit:brand_voice'), design.textButton(t('btn_edit_playbook'), 'cc_mem_edit:sales_playbook')],
      [design.textButton(t('btn_intelligence_hub'), 'cc_intelligence')],
      [design.textButton(t('btn_back_home'), 'cc_home')]
    ])
  };
}

function buildMemoryEdit(userId, key) {
  const t = k => i18n.t(userId, k);
  const hints = {
    company_name: 'memory_edit_hint_company_name',
    industry: 'memory_edit_hint_industry',
    products: 'memory_edit_hint_products',
    services: 'memory_edit_hint_services',
    icp: 'memory_edit_hint_icp',
    competitors: 'memory_edit_hint_competitors',
    brand_voice: 'memory_edit_hint_brand_voice',
    sales_playbook: 'memory_edit_hint_sales_playbook'
  };
  const label = t(hints[key] || 'memory_edit_hint_company_name');
  return {
    text: design.compose([
      `${design.EMOJI.ai} ${design.b(i18n.sprintf(t('memory_edit_title'), titleCase(key)))}`,
      design.it(label),
      design.divider(),
      design.it(t('memory_edit_type')),
      design.it(t('memory_edit_lists')),
      design.divider()
    ]),
    keyboard: design.keyboard([
      [design.textButton(t('confirm_no'), 'cc_mem_cancel')]
    ])
  };
}

module.exports = { buildSettings, buildAiGuide, buildMemory, buildMemoryEdit };
