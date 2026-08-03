const design = require('../design');
const { getStoreAdapter } = require('../store');
const integrations = require('../../services/integrations');
const { getCtx, titleCase } = require('./lib');

async function buildIntegrations(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('Enterprise Integration Hub')}`,
        design.it('Set up a workspace to manage integrations.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const st = await integrations.manager.status(getStoreAdapter(), ctx.workspace.id);
  const lines = [];
  for (const cat of st.categories) {
    lines.push(design.section(titleCase(cat.label)));
    for (const c of cat.connectors) {
      const flag = c.enabled ? design.EMOJI.success : c.configured ? design.EMOJI.info : design.EMOJI.critical;
      lines.push(design.row(`${c.label}`, `${flag} ${c.enabled ? 'Enabled' : c.configured ? 'Configured' : 'Off'}`));
    }
  }
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Enterprise Integration Hub')}`,
    design.it('One interface for every external system your agents use.'),
    design.divider(),
    design.row('Enabled connectors', String(st.enabled_total)),
    ...lines,
    design.it('Agents call searchContacts, searchDeals, sendMessage, createMeeting, storeDocument, fetchKnowledge and crawl — the hub routes them.'),
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
  rows.push([design.textButton('All Connectors', 'cc_int_all'), design.textButton('Sync Now', 'cc_sync_now')]);
  rows.push([design.textButton('Back to Home', 'cc_home')]);
  return {
    text,
    keyboard: design.keyboard(rows)
  };
}

async function buildAllConnectors(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('Enterprise Integration Hub')}`,
        design.it('Set up a workspace to manage integrations.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const st = await integrations.manager.status(getStoreAdapter(), ctx.workspace.id);
  const lines = [];
  for (const cat of st.categories) {
    lines.push(design.section(titleCase(cat.label)));
    for (const c of cat.connectors) {
      const flag = c.enabled ? design.EMOJI.success : c.configured ? design.EMOJI.info : design.EMOJI.critical;
      lines.push(design.row(`${c.label} (${c.auth})`, `${flag} ${c.enabled ? 'Enabled' : c.configured ? 'Configured' : 'Off'}`));
    }
  }
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('All Connectors')}`,
    design.it(`${st.enabled_total} enabled · ${integrations.catalog.CONNECTORS ? Object.keys(integrations.catalog.CONNECTORS).length : 0} available`),
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
  rows.push([design.textButton('Integration Hub', 'cc_integrations'), design.textButton('Back to Home', 'cc_home')]);
  return {
    text,
    keyboard: design.keyboard(rows)
  };
}

async function buildConnectorDetail(userId, connectorId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return { text: design.errorPanel('No workspace', 'Provision a workspace first.').text, keyboard: null };
  }
  const c = integrations.catalog.CONNECTORS[connectorId];
  if (!c) {
    return { text: design.errorPanel('Unknown connector', connectorId).text, keyboard: null };
  }
  const st = await integrations.manager.status(getStoreAdapter(), ctx.workspace.id);
  const cat = st.categories.find(g => g.category === c.category);
  const info = cat ? cat.connectors.find(x => x.id === connectorId) : null;
  const capLines = Object.keys(c)
    .filter(k => !['label', 'category', 'auth', 'keyEnv', 'baseUrl', 'defaultModel'].includes(k) && typeof c[k] === 'object' && c[k] && c[k].method)
    .map(k => design.row(k, `${c[k].method} ${c[k].path}`));
  const statusText = info
    ? (info.enabled ? design.EMOJI.success + ' Enabled' : info.configured ? design.EMOJI.info + ' Configured' : design.EMOJI.critical + ' Off')
    : design.EMOJI.critical + ' Off';
  const setupHint = c.auth === 'oauth'
    ? 'OAuth — use Connect to authorize this connector.'
    : c.keyEnv
      ? `Set the API key env var ${design.code(c.keyEnv)} and restart.`
      : 'No credentials required.';
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(c.label)}`,
    design.it(titleCase(c.category) + ' connector'),
    design.divider(),
    design.row('Status', statusText),
    design.row('Auth', c.auth),
    design.row('Configured', info ? (info.configured ? design.EMOJI.success + ' Yes' : design.EMOJI.info + ' No') : design.EMOJI.info + ' No'),
    design.row('Last sync', info && info.last_synced_at ? info.last_synced_at.slice(0, 16).replace('T', ' ') : '—'),
    design.section('CAPABILITIES'),
    ...capLines,
    design.section('SETUP'),
    design.it(setupHint),
    design.divider()
  ]);
  const rows = [];
  if (info && info.enabled) {
    rows.push([design.textButton('Disable', `cc_int_disable:${connectorId}`)]);
  } else {
    rows.push([design.textButton('Enable', `cc_int_enable:${connectorId}`)]);
  }
  if (c.auth === 'oauth') {
    rows.push([design.textButton('Connect (OAuth)', `cc_int_auth:${connectorId}`)]);
  } else {
    rows.push([design.textButton('Test Connection', `cc_int_test:${connectorId}`)]);
  }
  rows.push([design.textButton('Back to Integrations', 'cc_integrations')]);
  return {
    text,
    keyboard: design.keyboard(rows)
  };
}

async function buildSyncResult(userId, result) {
  const lines = (result.connectors || []).map(entry => {
    const err = entry.error ? design.EMOJI.critical + ' ' + entry.error : design.EMOJI.success + ' ' + entry.actions.join(' · ');
    return `${design.b(entry.label)} (${entry.category})\n${design.it(err)}`;
  });
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Integration Sync')}`,
    design.it(`${result.connectors.length} connector${result.connectors.length === 1 ? '' : 's'} synced`),
    design.divider(),
    ...(lines.length ? lines : [design.it('No connectors enabled — enable one in the hub, then sync.')]),
    design.section('WRITE-OUT'),
    design.row('Knowledge documents', String(result.docs_written)),
    design.row('Deals upserted', String(result.deals_upserted)),
    design.row('Audit entries', String(result.audits)),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Sync Again', 'cc_sync_now'), design.textButton('Integration Hub', 'cc_integrations')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

module.exports = {
  buildIntegrations,
  buildAllConnectors,
  buildConnectorDetail,
  buildSyncResult
};
