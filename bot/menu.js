const design = require('./design');
const audit = require('../utils/auditLogger');
const { getMode, setMode } = require('../config/mode');
const { BOT_CONFIG } = require('./config');
const { isFounder, isAdmin } = require('./access');
const i18n = require('./i18n');
const { formatPricingText, pricingButtons } = require('../config/pricing.config');
const { getWorkspaceContext, setWorkspaceLang } = require('../services/workspace');
const { getStoreAdapter } = require('./store');
const workforce = require('../services/workforce');
const memory = require('../services/memory');
const memoryEdit = require('./memoryEdit');

const PIPELINE_STAGES = ['Strategist', 'Marketer', 'Negotiator', 'Treasurer', 'Closing'];

function lastEntry() {
  const entries = audit.readVault();
  if (entries.length === 0) return null;
  return entries[entries.length - 1];
}

async function getCtx(userId) {
  try {
    return await getWorkspaceContext(getStoreAdapter(), userId);
  } catch (err) {
    console.error('[menu] context failed:', err.message);
    return null;
  }
}

function titleCase(str) {
  return String(str || '').replace(/\b\w/g, c => c.toUpperCase());
}

function greetingFor(timezone) {
  const now = new Date();
  let hour = now.getHours();
  try {
    hour = Number(new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timezone || 'UTC'
    }).format(now));
  } catch (_) { /* keep local hour */ }
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function outreachToday() {
  const today = new Date().toISOString().slice(0, 10);
  return audit.readVault().filter(e =>
    e.action.startsWith('OUTREACH') && (e.timestamp || '').startsWith(today)
  ).length;
}

function recentErrors() {
  const entries = audit.readVault();
  return entries.slice(-50).filter(e => e.status === 'error').length;
}

function nextRecommendation(ctx) {
  if (ctx.deals.total === 0) return 'Import your first leads to start the pipeline.';
  if (ctx.deals.open === 0) return 'Your pipeline is closed — import new leads to keep revenue flowing.';
  if (outreachToday() === 0) return 'Run an outreach cycle on your active deals.';
  return 'Follow up on your active deals to move them forward.';
}

async function buildHome(userId) {
  const ctx = await getCtx(userId);
  if (ctx) {
    const name = (ctx.user && ctx.user.display_name) || 'there';
    const timezone = (ctx.settings && ctx.settings.timezone) || 'UTC';
    const healthy = ctx.agents.active === ctx.agents.total && recentErrors() === 0;
    const outreach = outreachToday();
    const activityLines = [
      `${healthy ? design.EMOJI.success : design.EMOJI.warning} ${ctx.agents.active} Agents Ready`,
      ctx.deals.open > 0
        ? `${design.EMOJI.info} ${ctx.deals.open} Active Deal${ctx.deals.open === 1 ? '' : 's'}`
        : `${design.EMOJI.info} 0 Active Deals`,
      outreach > 0
        ? `${design.EMOJI.success} ${outreach} outreach dispatch${outreach === 1 ? '' : 'es'} today`
        : `${design.EMOJI.info} No scheduled outreach`,
      `${healthy ? design.EMOJI.success : design.EMOJI.warning} ${healthy ? 'Workspace Healthy' : 'Attention needed'}`
    ];
    const checklist = [
      `✓ Import Leads`,
      `✓ Connect CRM`,
      `✓ Upload Product Catalog`,
      `✓ Launch First Campaign`
    ];
    const text = design.compose([
      `${design.EMOJI.info} ${design.b(`${greetingFor(timezone)}, ${name}.`)}`,
      design.it('Your AI workforce is ready.'),
      design.divider(),
      design.section('TODAY\'S AI ACTIVITY'),
      ...activityLines,
      design.section('NEXT RECOMMENDATION'),
      design.it(nextRecommendation(ctx)),
      design.section('TODAY YOU CAN'),
      ...checklist.map(c => design.it(c)),
      design.it('Estimated setup time: 4 minutes'),
      design.divider()
    ]);
    return {
      text,
      keyboard: design.keyboard([
        [design.textButton('Import Leads', 'cc_deals'), design.textButton('Connect CRM', 'cc_connect_crm')],
        [design.textButton('Upload Catalog', 'cc_upload_catalog'), design.textButton('Launch Campaign', 'cc_launch_campaign')],
        [design.textButton('Today\'s Activity', 'cc_activity'), design.textButton('AI Guide', 'cc_ai_guide')],
        [design.textButton('Dashboard', 'cc_dashboard'), design.textButton('Pipeline', 'cc_pipeline')],
        [design.textButton('Timeline', 'cc_timeline'), design.textButton('Costs', 'cc_costs'), design.textButton('Health', 'cc_health')],
        [design.textButton('Settings', 'cc_settings'), design.textButton('Audit Log', 'cc_audit'), design.textButton('Pricing', 'cc_pricing')],
        [design.textButton('Admin', 'cc_admin')]
      ])
    };
  }
  const entries = audit.readVault();
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('TEOS DEALMAKER')}`,
    design.it('AI Revenue Workforce — Control Center'),
    design.divider(),
    `${design.row('Status', design.modeBadge(getMode()))}`,
    `${design.row('Workforce', '12 agents available')}`,
    `${design.row('Audit', `${entries.length} entries`)}\n${design.divider()}`,
    `${design.it('Select a module to manage the workforce.')}`
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Dashboard', 'cc_dashboard'), design.textButton('Workforce', 'cc_workforce')],
      [design.textButton('Pipeline', 'cc_pipeline'), design.textButton('Deals', 'cc_deals')],
      [design.textButton('Timeline', 'cc_timeline'), design.textButton('Costs', 'cc_costs'), design.textButton('Health', 'cc_health')],
      [design.textButton('Audit Log', 'cc_audit'), design.textButton('Pricing', 'cc_pricing')],
      [design.textButton('Admin', 'cc_admin')]
    ])
  };
}

async function buildDashboard(userId) {
  const ctx = await getCtx(userId);
  const entries = audit.readVault();
  const last = lastEntry();
  const closed = ctx
    ? ctx.deals.closed
    : entries.filter(e => e.action === 'CLOSING_AGENT_DEAL_CLOSED').length;
  const recent = entries.slice(-3).reverse().map(e =>
    `${design.code((e.timestamp || '').slice(11, 19))} ${e.action} → ${e.target}`
  );
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Dashboard')}`,
    design.it('Operational overview'),
    design.divider(),
    ctx ? design.row('Workspace', ctx.workspace.name) : null,
    design.row('Mode', design.modeBadge(getMode())),
    design.row('Bot', `@${BOT_CONFIG.botName}`),
    ctx ? design.row('Plan', titleCase(ctx.workspace.plan)) : null,
    ctx ? design.row('Members', String(ctx.membersCount)) : null,
    ctx ? design.row('Agents', `${ctx.agents.active} active`) : null,
    ctx ? design.row('Subscription', ctx.subscriptionLabel) : null,
    design.row('Audit', `${entries.length} entries`),
    design.row('Closed deals', `${closed}`),
    design.row('Last activity', last ? `${last.action} · ${(last.timestamp || '').slice(11, 19)}` : '—'),
    design.section('RECENT ACTIVITY'),
    recent.length ? design.list(recent) : design.it('No activity yet.'),
    design.section('QUICK ACTIONS')
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Run Sales Demo', 'cc_sales_run'), design.textButton('Run Pipeline', 'cc_pipeline_run')],
      [design.textButton('Audit Log', 'cc_audit'), design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

function workforceStatus(agent) {
  const status = agent.status;
  if (status === 'running') return `${design.EMOJI.warning} Working`;
  if (status === 'waiting') return `${design.EMOJI.warning} Waiting`;
  if (status === 'paused') return `${design.EMOJI.critical} Paused`;
  return `${design.EMOJI.success} Ready`;
}

async function buildWorkforce(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('AI Workforce')}`,
        design.it('Set up a workspace to see your workforce.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const view = await workforce.workforceConsole(getStoreAdapter(), ctx.workspace.id);
  const statusLine = (a) => `${design.EMOJI[a.tone]} ${a.label} · ${a.display}`;
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('AI Workforce')}`,
    design.it(`${view.workers_total} Workers · ${view.busy} Busy · ${view.ready} Ready`),
    design.divider(),
    design.row('⚡ Today\'s Cost', `$${(view.today_cost_cents / 100).toFixed(2)}`),
    design.row('✓ Completed Tasks', String(view.completed_tasks)),
    design.row('💰 Estimated Pipeline', `$${(view.estimated_pipeline_cents / 100).toFixed(2)}`),
    design.section('WORKFORCE'),
    ...view.agents.map(a => statusLine(a)),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Today\'s Activity', 'cc_activity'), design.textButton('Timeline', 'cc_timeline')],
      [design.textButton('Costs', 'cc_costs'), design.textButton('Health', 'cc_health')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

async function buildTimeline(userId, dealId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('Deal Timeline')}`,
        design.it('Set up a workspace to see the timeline.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const repos = require('../db/repos').createRepos(getStoreAdapter());
  if (dealId) {
    const tl = await workforce.dealTimeline(getStoreAdapter(), ctx.workspace.id, Number(dealId));
    if (!tl) {
      return {
        text: design.compose([
          `${design.EMOJI.ai} ${design.b('Deal Timeline')}`,
          design.it('Deal not found.'),
          design.divider()
        ]),
        keyboard: design.keyboard([
          [design.textButton('All Deals', 'cc_timeline')],
          [design.textButton('Back to Home', 'cc_home')]
        ])
      };
    }
    const rows = [
      ...tl.notes.map(n => `${design.code(n.time ? workforce.shortTime(n.time) : '—')} ${design.b(titleCase(n.agent_name))} ${n.text}`),
      ...tl.events.map(e => `${design.code(e.time ? workforce.shortTime(e.time) : '—')} ${design.it('Stage')} ${e.text}`)
    ];
    const text = design.compose([
      `${design.EMOJI.ai} ${design.b('Deal Timeline')}`,
      design.it(`#${tl.deal.id} · ${tl.deal.company_name} · ${tl.deal.stage}`),
      design.divider(),
      ...rows,
      design.divider()
    ]);
    return {
      text,
      keyboard: design.keyboard([
        [design.textButton('All Deals', 'cc_timeline')],
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const deals = await repos.deals.list(ctx.workspace.id, {});
  const recent = deals.slice(0, 3);
  const blocks = recent.length ? (await Promise.all(recent.map(async d => {
    const notes = await repos.dealNotes.list(ctx.workspace.id, d.id);
    return [
      `${design.b(`#${d.id} · ${d.company_name} · ${d.stage}`)}`,
      ...(notes.length ? notes.map(n => `${design.code('  ·')} ${design.b(titleCase(n.agent_name))} ${n.note}`) : [design.it('  no notes yet')])
    ];
  }))).flat() : [design.it('No deals yet — run the pipeline demo.')];
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Deal Timeline')}`,
    design.it('How the team collaborated on each deal.'),
    design.divider(),
    ...blocks,
    design.divider()
  ]);
  const keyboardRows = recent.map(d => [design.textButton(`Deal #${d.id}`, `cc_timeline_deal:${d.id}`)]);
  keyboardRows.push([design.textButton('AI Workforce', 'cc_workforce'), design.textButton('Back to Home', 'cc_home')]);
  return {
    text,
    keyboard: design.keyboard(keyboardRows)
  };
}

async function buildCosts(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('AI Cost Dashboard')}`,
        design.it('Set up a workspace to see costs.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const c = await workforce.costSummary(getStoreAdapter(), ctx.workspace.id);
  const providerRows = c.by_provider.length
    ? c.by_provider.map(p => design.row(titleCase(p.provider), `$${(p.cost_cents / 100).toFixed(2)} · ${p.tasks} tasks`))
    : [design.it('No provider usage today yet.')];
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('AI Cost Dashboard')}`,
    design.it('Today'),
    design.divider(),
    ...providerRows,
    design.section('TOTALS'),
    design.row('Total', `$${(c.today_cost_cents / 100).toFixed(2)}`),
    design.row('Tasks', String(c.tasks)),
    design.row('Avg per task', `$${(c.avg_per_task_cents / 100).toFixed(4)}`),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('AI Workforce', 'cc_workforce')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

async function buildHealth(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('Platform Health')}`,
        design.it('Set up a workspace to see health.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const checks = await workforce.healthCheck(getStoreAdapter(), ctx.workspace.id, audit.readVault().length);
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Platform Health')}`,
    design.it('System status'),
    design.divider(),
    ...checks.map(ch => design.row(ch.label, `${ch.ok ? design.EMOJI.success : design.EMOJI.warning} ${ch.detail}`)),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('AI Workforce', 'cc_workforce')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

async function buildActivity(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('Today\'s Activity')}`,
        design.it('Set up a workspace to see activity.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const today = await workforce.todayActivity(getStoreAdapter(), ctx.workspace.id);
  const lines = today.flatMap(a => {
    const line = a.runs > 0
      ? `${design.EMOJI.success} ${a.label} · ${a.runs} run${a.runs === 1 ? '' : 's'}`
      : `${design.EMOJI.info} ${a.label} · waiting`;
    const detail = a.last_output ? `\n${design.it(String(a.last_output))}` : '';
    return [`${line}${detail}`];
  });
  const total = today.reduce((acc, a) => acc + a.runs, 0);
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Today\'s Activity')}`,
    design.it(`${total} agent run${total === 1 ? '' : 's'} so far`),
    design.divider(),
    ...lines,
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('AI Workforce', 'cc_workforce')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

async function buildAgentDetail(userId, agentType) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return { text: design.errorPanel('No workspace', 'Provision a workspace first.').text, keyboard: null };
  }
  const view = await workforce.getWorkforceView(getStoreAdapter(), ctx.workspace.id);
  const agent = view.agents.find(a => a.agent_type === agentType);
  if (!agent) {
    return { text: design.errorPanel('Agent not found', agentType).text, keyboard: null };
  }
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(agent.label)}`,
    design.it(agent.role),
    design.divider(),
    design.row('Status', workforceStatus(agent)),
    design.row('Runs today', String(agent.today_runs)),
    design.row('Total runs', String(agent.total_runs)),
    design.row('Last run', workforce.shortTime(agent.last_run_at)),
    design.row('Next run', workforce.shortTime(agent.next_run_at)),
    design.row('Provider', agent.provider || 'not configured'),
    design.row('Model', agent.model || '—'),
    design.row('Cost', `$${(agent.total_cost_cents / 100).toFixed(2)}`),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Back to Workforce', 'cc_workforce')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

function buildPipeline() {
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Pipeline')}`,
    design.it('Final deal flow — 5 stages'),
    design.divider(),
    design.progressBar(PIPELINE_STAGES, -1).join('\n'),
    design.divider(),
    design.it('Run the demo to execute all five agents and record the result to the audit vault.')
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Run Pipeline Demo', 'cc_pipeline_run')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

async function buildDeals(userId) {
  const ctx = await getCtx(userId);
  const entries = audit.readVault();
  const closed = ctx
    ? ctx.deals.closed
    : entries.filter(e => e.action === 'CLOSING_AGENT_DEAL_CLOSED').length;
  const dbConfigured = Boolean(process.env.DATABASE_URL);
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Deals')}`,
    design.it('Deal ledger'),
    design.divider(),
    design.row('Open', ctx ? String(ctx.deals.open) : '—'),
    design.row('Closed', `${closed}`),
    design.row('Persistence', dbConfigured ? design.badge('success') : design.badge('warning') + ' ' + design.it('Postgres not configured')),
    design.section('NOTES'),
    design.it('Run the pipeline demo to record a deal through Strategist → Closing.'),
    design.it(dbConfigured
      ? 'Postgres persistence active via DATABASE_URL.'
      : 'Set DATABASE_URL and run `npm run db:migrate` to persist deals.')
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Run Pipeline Demo', 'cc_pipeline_run')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

function buildAiGuide() {
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('AI Guide')}`,
    design.it('How your AI workforce works'),
    design.divider(),
    design.section('WORKFORCE'),
    design.it('12 specialized agents run your revenue motion: Prospecting → Qualification → Outreach → Sales → Negotiation → Treasurer → Closing.'),
    design.section('FLOW'),
    design.it('A deal moves Lead → Qualified → Meeting → Proposal → Negotiation → Won → Customer. Agents advance it automatically.'),
    design.section('TEAM'),
    design.it('Agents hand off work — each leaves notes for the next, like a real team. Run the pipeline demo to watch the chain.'),
    design.section('MEMORY'),
    design.it('Open Settings → Workspace Memory so every agent knows your company, products, ICP and competitors before acting.'),
    design.section('CONTROL'),
    design.it('Run /sales <objection> to test the orchestrator. Open Workforce for per-agent activity.'),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

async function buildSettings(userId) {
  const ctx = await getCtx(userId);
  const s = (ctx && ctx.settings) || { lang: 'en', timezone: 'UTC', notifications: 'on', theme: 'system' };
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Settings')}`,
    design.it('Workspace configuration'),
    design.divider(),
    design.row('Language', s.lang),
    design.row('Timezone', s.timezone),
    design.row('Notifications', s.notifications),
    design.row('Theme', s.theme),
    design.section('KNOWLEDGE'),
    design.it('Store what your company knows so every agent works from the same truth.'),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('English', 'cc_set_lang:en'), design.textButton('العربية', 'cc_set_lang:ar')],
      [design.textButton('Workspace Memory', 'cc_memory')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

async function buildMemory(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) return { text: design.errorPanel('No workspace', 'Provision a workspace first.').text, keyboard: null };
  const mem = await memory.getMemory(getStoreAdapter(), ctx.workspace.id);
  const rows = memory.describe(mem);
  const lines = [
    `${design.EMOJI.ai} ${design.b('Workspace Memory')}`,
    design.it('Every agent reads the context it needs before working.'),
    design.divider(),
    ...(rows.length ? rows.map(r => design.row(r.split(':')[0], r.split(':').slice(1).join(':'))) : [design.it('Nothing saved yet — add your company details below.')]),
    design.section('HOW AGENTS USE IT'),
    design.it('Prospector: industry · ICP · competitors'),
    design.it('Outreach: brand voice · playbook · languages'),
    design.it('Negotiator: products · preferred providers'),
    design.divider()
  ];
  return {
    text: design.compose(lines),
    keyboard: design.keyboard([
      [design.textButton('Edit Company', 'cc_mem_edit:company_name'), design.textButton('Edit Industry', 'cc_mem_edit:industry')],
      [design.textButton('Edit Products', 'cc_mem_edit:products'), design.textButton('Edit Services', 'cc_mem_edit:services')],
      [design.textButton('Edit ICP', 'cc_mem_edit:icp'), design.textButton('Edit Competitors', 'cc_mem_edit:competitors')],
      [design.textButton('Edit Brand Voice', 'cc_mem_edit:brand_voice'), design.textButton('Edit Playbook', 'cc_mem_edit:sales_playbook')],
      [design.textButton('Back to Settings', 'cc_settings')]
    ])
  };
}

function buildMemoryEdit(userId, key) {
  const hints = {
    company_name: 'Company name',
    industry: 'Industry (e.g. SaaS, Fintech, Logistics)',
    products: 'Products (comma-separated)',
    services: 'Services (comma-separated)',
    icp: 'Ideal Customer Profile, e.g. industries: SaaS; size: 50-500; geos: US, EU',
    competitors: 'Competitors (comma-separated)',
    brand_voice: 'Brand voice (e.g. direct, consultative, friendly)',
    sales_playbook: 'Sales playbook (e.g. value-led, MEDDIC, consultative)'
  };
  const label = hints[key] || key;
  return {
    text: design.compose([
      `${design.EMOJI.ai} ${design.b('Edit ' + titleCase(key))}`,
      design.it(label),
      design.divider(),
      design.it('Type the new value below.'),
      design.it('For lists, separate items with commas.'),
      design.divider()
    ]),
    keyboard: design.keyboard([
      [design.textButton('Cancel', 'cc_mem_cancel')]
    ])
  };
}

function statusEmoji(status) {
  if (['success', 'won', 'closed', 'SENT', 'APPROVE', 'dry_run'].includes(status)) return 'success';
  if (['dry_run', 'info', 'VAULTED_DRY'].includes(status)) return 'info';
  if (['in_progress', 'warning'].includes(status)) return 'warning';
  if (['error', 'denied', 'blocked', 'CRITICAL'].includes(status)) return 'critical';
  return 'info';
}

function buildAudit(offset) {
  const size = 8;
  const entries = audit.readVault();
  const start = Math.max(0, entries.length - size - (offset || 0));
  const page = entries.slice(start, start + size).reverse();
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Audit Log')}`,
    design.it('Immutable activity feed'),
    design.divider(),
    ...(page.length ? page.map(e =>
      `${design.code((e.timestamp || '').slice(11, 19))} ${e.action} → ${e.target}\n${design.badge(statusEmoji(e.status))}`
    ) : [design.it('No entries.')]),
    design.divider()
  ]);
  const rows = [];
  if (start > 0) rows.push([design.textButton('Earlier', `cc_audit:${(offset || 0) + size}`)]);
  rows.push([design.textButton('Back to Home', 'cc_home')]);
  return { text, keyboard: design.keyboard(rows) };
}

function buildPricing() {
  return {
    text: formatPricingText(),
    keyboard: design.keyboard([
      ...pricingButtons().inline_keyboard,
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

function buildAdmin(userId) {
  const mode = getMode();
  const rows = [];
  const body = [
    `${design.EMOJI.ai} ${design.b('Admin')}`,
    design.it('Operational control'),
    design.divider(),
    design.row('Mode', design.modeBadge(mode)),
    design.row('Role', isFounder(userId) ? design.badge('success') + ' Founder' : isAdmin(userId) ? design.badge('info') + ' Admin' : design.badge('warning') + ' Operator'),
    design.divider()
  ];
  if (isFounder(userId)) rows.push([design.textButton('Switch to LIVE', 'cc_live')]);
  if (isAdmin(userId)) rows.push([design.textButton('Switch to DRY', 'cc_dry')]);
  if (isAdmin(userId)) rows.push([design.textButton('Audit Log', 'cc_audit')]);
  rows.push([design.textButton('Back to Home', 'cc_home')]);
  return { text: design.compose(body), keyboard: design.keyboard(rows) };
}

function buildSalesDemo() {
  const { runSalesFlow } = require('../agents/orchestrator');
  const result = runSalesFlow('The price is too high for our budget.', 'bot_demo');
  const lines = [
    `${design.EMOJI.ai} ${design.b('Sales Demo')}`,
    design.it('Orchestrator → Sales → Gatekeeper'),
    design.divider(),
    design.row('Objection', result.draft.objectionType),
    design.row('Gatekeeper', design.badge(result.review.decision === 'APPROVE' ? 'success' : 'warning')),
    design.row('Draft', design.code(result.draft.draft.slice(0, 80))),
    design.row('Route', result.routed ? result.routed.status : 'blocked'),
    design.divider()
  ];
  return {
    text: design.compose(lines),
    keyboard: design.keyboard([
      [design.textButton('Run Again', 'cc_sales_run')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

function buildPipelineResult(userId, result) {
  const notes = (result.notes || []).map(n =>
    `${design.code(n.agent_name)} ${n.note}`
  );
  const lines = [
    `${design.EMOJI.ai} ${design.b('Pipeline Demo')}`,
    design.it('Strategist → Marketer → Negotiator → Treasurer → Closing'),
    design.divider(),
    design.row('Strategy', result.strategy.style),
    design.row('Positioning', result.marketing.headline),
    design.row('Landing price', `$${result.negotiation.landingPrice}`),
    design.row('Terms', result.negotiation.suggestedTerms),
    design.row('Contract', result.treasurer.contract.contractId),
    design.row('Checkout', result.treasurer.checkout ? result.treasurer.checkout.url : 'blocked'),
    design.row('Outcome', design.badge(result.closing.status === 'won' ? 'success' : 'critical')),
    design.row('Deal saved', design.badge('success')),
    design.row('Cost', `$${(result.runs.reduce((acc, r) => acc + r.cost_cents, 0) / 100).toFixed(2)}`),
    design.section('TEAM NOTES'),
    ...notes,
    design.divider()
  ];
  return {
    text: design.compose(lines),
    keyboard: design.keyboard([
      [design.textButton('Run Again', 'cc_pipeline_run')],
      [design.textButton('Today\'s Activity', 'cc_activity')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

function modeConfirm(mode) {
  const live = mode === 'LIVE';
  const target = live ? 'LIVE' : 'DRY';
  return design.confirmPanel(
    `Switch to ${target} mode?`,
    `${design.it(live
      ? 'Messages will be dispatched to customers without vault-only protection.'
      : 'All agent output will be vaulted and nothing is sent to customers.')}\n\n${design.row('Current mode', design.modeBadge(getMode()))}`,
    live ? 'cc_live_confirm' : 'cc_dry_confirm',
    live ? 'cc_live_cancel' : 'cc_dry_cancel',
    `Switch to ${target}`,
    'Cancel'
  );
}

async function applyMode(query, bot, mode) {
  setMode(mode);
  audit.writeEntry('BOT_MODE', 'system', 'success', { mode, by: query.from ? query.from.id : null });
  await editPanel(bot, query, buildAdmin(query.from ? query.from.id : null));
}

async function editPanel(bot, query, screen) {
  await bot.editMessageText(screen.text, {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: screen.keyboard
  });
}

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
      return send(await buildHome(userId));
    case 'cc_dashboard':
      return send(await buildDashboard(userId));
    case 'cc_workforce':
      return send(await buildWorkforce(userId));
    case 'cc_pipeline':
      return send(buildPipeline());
    case 'cc_deals':
      return send(await buildDeals(userId));
    case 'cc_pricing':
      return send(buildPricing());
    case 'cc_ai_guide':
      return send(buildAiGuide());
    case 'cc_settings':
      return send(await buildSettings(userId));
    case 'cc_memory':
      return send(await buildMemory(userId));
    case 'cc_mem_cancel':
      memoryEdit.clear(userId);
      return send(await buildMemory(userId));
    case 'cc_mem_edit:': {
      memoryEdit.clear(userId);
      return send(await buildMemory(userId));
    }
    case 'cc_activity':
      return send(await buildActivity(userId));
    case 'cc_timeline':
      return send(await buildTimeline(userId));
    case 'cc_costs':
      return send(await buildCosts(userId));
    case 'cc_health':
      return send(await buildHealth(userId));
    case 'cc_audit': {
      if (!isAdmin(userId)) return send(denied('audit feed'));
      return send(buildAudit(0));
    }
    default: {
      if (action.startsWith('cc_audit:')) {
        if (!isAdmin(userId)) return send(denied('audit feed'));
        return send(buildAudit(Number(action.split(':')[1]) || 0));
      }
      if (action === 'cc_admin') return send(buildAdmin(userId));
      if (action === 'cc_sales_run') {
        try { await bot.sendChatAction(query.message.chat.id, 'typing'); } catch (_) { /* ignore */ }
        return send(buildSalesDemo());
      }
      if (action === 'cc_pipeline_run') {
        try { await bot.sendChatAction(query.message.chat.id, 'typing'); } catch (_) { /* ignore */ }
        const ctx = await getCtx(userId);
        if (!ctx) return send({ text: design.errorPanel('No workspace', 'Provision a workspace first.').text, keyboard: null });
        try {
          const result = await workforce.runPipelineDemo(getStoreAdapter(), ctx.workspace.id);
          return send(buildPipelineResult(userId, result));
        } catch (err) {
          audit.writeEntry('BOT_PIPELINE_ERROR', String(userId), 'error', { error: err.message });
          return send({ text: design.errorPanel('Pipeline failed', String(err.message)).text, keyboard: null });
        }
      }
      if (action.startsWith('cc_agent:')) {
        const agentType = action.split(':')[1];
        return send(await buildAgentDetail(userId, agentType));
      }
      if (action.startsWith('cc_mem_edit:')) {
        const key = action.split(':')[1];
        memoryEdit.begin(userId, key);
        return send(buildMemoryEdit(userId, key));
      }
      if (action.startsWith('cc_timeline_deal:')) {
        const dealId = action.split(':')[1];
        return send(await buildTimeline(userId, dealId));
      }
      if (action === 'cc_live') {
        if (!isFounder(userId)) return send(denied('founder actions'));
        return send(modeConfirm('LIVE'));
      }
      if (action === 'cc_live_confirm') {
        if (!isFounder(userId)) return send(denied('founder actions'));
        return applyMode(query, bot, 'LIVE');
      }
      if (action === 'cc_live_cancel') return send(buildAdmin(userId));
      if (action === 'cc_dry') {
        if (!isAdmin(userId)) return send(denied('admin actions'));
        return send(modeConfirm('DRY'));
      }
      if (action === 'cc_dry_confirm') {
        if (!isAdmin(userId)) return send(denied('admin actions'));
        return applyMode(query, bot, 'DRY');
      }
      if (action === 'cc_dry_cancel') return send(buildAdmin(userId));
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
        return send(await buildSettings(userId));
      }
      if (action === 'cc_connect_crm') {
        return bot.answerCallbackQuery(query.id, { text: 'Coming soon — CRM integration is on the roadmap' }).catch(() => {});
      }
      if (action === 'cc_upload_catalog') {
        return bot.answerCallbackQuery(query.id, { text: 'Coming soon — Company Knowledge is on the roadmap' }).catch(() => {});
      }
      if (action === 'cc_launch_campaign') {
        return bot.answerCallbackQuery(query.id, { text: 'Coming soon — Campaigns arrive with the revenue pipeline' }).catch(() => {});
      }
      return bot.answerCallbackQuery(query.id, { text: 'Unknown action' }).catch(() => {});
    }
  }
}

function denied(resource) {
  const panel = design.errorPanel(
    'Access denied',
    `You do not have permission to open ${resource}.`
  );
  return {
    text: panel.text,
    keyboard: design.keyboard([
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

module.exports = {
  buildHome,
  buildDashboard,
  buildWorkforce,
  buildPipeline,
  buildDeals,
  buildAudit,
  buildPricing,
  buildAdmin,
  buildAiGuide,
  buildSettings,
  buildMemory,
  buildActivity,
  buildAgentDetail,
  buildTimeline,
  buildCosts,
  buildHealth,
  handleCallback
};
