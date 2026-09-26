const design = require('../design');
const i18n = require('../i18n');
const { getStoreAdapter } = require('../store');
const integrations = require('../../services/integrations');
const { getCtx, titleCase } = require('./lib');

// Connector API method names are identifiers the agents call by name, not copy.
// They are passed as an argument to int_body_tools and must not be translated.
// Pure comma-separated identifiers with no connective: a literal "and" here
// would ride the %s substitution straight into the Arabic sentence.
const TOOL_NAMES = 'searchContacts, searchDeals, sendMessage, createMeeting, storeDocument, fetchKnowledge, crawl';

function statusLabel(t, info) {
  if (info.enabled) return design.EMOJI.success + ' ' + t('int_st_enabled');
  if (info.configured) return design.EMOJI.info + ' ' + t('int_st_configured');
  return design.EMOJI.critical + ' ' + t('int_st_off');
}

async function buildIntegrations(userId) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b(t('int_title_hub'))}`,
        design.it(t('int_body_noctx')),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton(t('common_home'), 'cc_home')]
      ])
    };
  }
  const st = await integrations.manager.status(getStoreAdapter(), ctx.workspace.id);
  const lines = [];
  for (const cat of st.categories) {
    lines.push(design.section(titleCase(cat.label)));
    for (const c of cat.connectors) {
      lines.push(design.row(`${c.label}`, statusLabel(t, c)));
    }
  }
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(t('int_title_hub'))}`,
    design.it(t('int_body_sub')),
    design.divider(),
    design.row(t('int_row_enabled'), String(st.enabled_total)),
    ...lines,
    design.it(i18n.sprintf(t('int_body_tools'), TOOL_NAMES)),
    design.divider()
  ]);
  const rows = [];
  for (const cat of st.categories) {
    const ids = cat.connectors.filter(c => c.enabled).map(c => c.id);
    for (let i = 0; i < ids.length; i += 2) {
      const a = ids[i];
      const b = ids[i + 1];
      rows.push([
        design.textButton(integrations.catalog.CONNECTORS[a].label, `cc_int_conn:${a}`),
        b ? design.textButton(integrations.catalog.CONNECTORS[b].label, `cc_int_conn:${b}`) : null
      ].filter(Boolean));
    }
  }
  rows.push([design.textButton(t('int_btn_all'), 'cc_int_all'), design.textButton(t('int_btn_sync'), 'cc_sync_now')]);
  rows.push([design.textButton(t('common_home'), 'cc_home')]);
  return {
    text,
    keyboard: design.keyboard(rows)
  };
}

async function buildAllConnectors(userId) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b(t('int_title_hub'))}`,
        design.it(t('int_body_noctx')),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton(t('common_home'), 'cc_home')]
      ])
    };
  }
  const st = await integrations.manager.status(getStoreAdapter(), ctx.workspace.id);
  const lines = [];
  for (const cat of st.categories) {
    lines.push(design.section(titleCase(cat.label)));
    for (const c of cat.connectors) {
      lines.push(design.row(`${c.label} (${c.auth})`, statusLabel(t, c)));
    }
  }
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(t('int_title_all'))}`,
    design.it(i18n.sprintf(t('int_meta_counts'), st.enabled_total, integrations.catalog.CONNECTORS ? Object.keys(integrations.catalog.CONNECTORS).length : 0)),
    design.divider(),
    ...lines,
    design.divider()
  ]);
  const rows = [];
  for (const cat of st.categories) {
    for (const c of cat.connectors) {
      rows.push([design.textButton(`${c.label}`, `cc_int_conn:${c.id}`)]);
    }
  }
  rows.push([design.textButton(t('int_btn_hub'), 'cc_integrations'), design.textButton(t('common_home'), 'cc_home')]);
  return {
    text,
    keyboard: design.keyboard(rows)
  };
}

async function buildConnectorDetail(userId, connectorId) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  if (!ctx) {
    return { text: design.errorPanel(t('common_no_workspace'), t('common_provision_first')).text, keyboard: null };
  }
  const c = integrations.catalog.CONNECTORS[connectorId];
  if (!c) {
    return { text: design.errorPanel(t('int_err_unknown_connector'), connectorId).text, keyboard: null };
  }
  const st = await integrations.manager.status(getStoreAdapter(), ctx.workspace.id);
  const cat = st.categories.find(g => g.category === c.category);
  const info = cat ? cat.connectors.find(x => x.id === connectorId) : null;
  const capLines = Object.keys(c)
    .filter(k => !['label', 'category', 'auth', 'keyEnv', 'baseUrl', 'defaultModel'].includes(k) && typeof c[k] === 'object' && c[k] && c[k].method)
    .map(k => design.row(k, `${c[k].method} ${c[k].path}`));
  const statusText = info
    ? statusLabel(t, info)
    : design.EMOJI.critical + ' ' + t('int_st_off');
  const setupHint = c.auth === 'oauth'
    ? t('int_setup_oauth')
    : c.keyEnv
      ? i18n.sprintf(t('int_setup_key'), design.code(c.keyEnv))
      : t('int_setup_none');
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(c.label)}`,
    design.it(i18n.sprintf(t('int_connector_suffix'), titleCase(c.category))),
    design.divider(),
    design.row(t('int_row_status'), statusText),
    design.row(t('int_row_auth'), c.auth),
    design.row(t('int_row_configured'), info ? (info.configured ? design.EMOJI.success + ' ' + t('common_yes') : design.EMOJI.info + ' ' + t('common_no')) : design.EMOJI.info + ' ' + t('common_no')),
    design.row(t('int_row_last_sync'), info && info.last_synced_at ? info.last_synced_at.slice(0, 16).replace('T', ' ') : '—'),
    design.section(t('int_sec_capabilities')),
    ...capLines,
    design.section(t('int_sec_setup')),
    design.it(setupHint),
    design.divider()
  ]);
  const rows = [];
  if (info && info.enabled) {
    rows.push([design.textButton(t('int_btn_disable'), `cc_int_disable:${connectorId}`)]);
  } else {
    rows.push([design.textButton(t('int_btn_enable'), `cc_int_enable:${connectorId}`)]);
  }
  if (c.auth === 'oauth') {
    rows.push([design.textButton(t('int_btn_connect_oauth'), `cc_int_auth:${connectorId}`)]);
  } else {
    rows.push([design.textButton(t('int_btn_test'), `cc_int_test:${connectorId}`)]);
  }
  rows.push([design.textButton(t('int_btn_back'), 'cc_integrations')]);
  return {
    text,
    keyboard: design.keyboard(rows)
  };
}

async function buildSyncResult(userId, result) {
  const t = key => i18n.t(userId, key);
  const lines = (result.connectors || []).map(entry => {
    const err = entry.error ? design.EMOJI.critical + ' ' + entry.error : design.EMOJI.success + ' ' + entry.actions.join(' · ');
    return `${design.b(entry.label)} (${entry.category})\n${design.it(err)}`;
  });
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(t('int_title_sync'))}`,
    design.it(i18n.sprintf(result.connectors.length === 1 ? t('int_synced_one') : t('int_synced_many'), result.connectors.length)),
    design.divider(),
    ...(lines.length ? lines : [design.it(t('int_body_none_enabled'))]),
    design.section(t('int_sec_writeout')),
    design.row(t('int_row_docs'), String(result.docs_written)),
    design.row(t('int_row_deals'), String(result.deals_upserted)),
    design.row(t('int_row_audits'), String(result.audits)),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton(t('int_btn_sync_again'), 'cc_sync_now'), design.textButton(t('int_btn_hub'), 'cc_integrations')],
      [design.textButton(t('common_home'), 'cc_home')]
    ])
  };
}

module.exports = {
  buildIntegrations,
  buildAllConnectors,
  buildConnectorDetail,
  buildSyncResult
};
