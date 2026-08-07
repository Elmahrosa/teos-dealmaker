// RC1 production validation — live checks against the deployed DATABASE_URL.
// Run via: npx -y @railway/cli run -s web -- node scripts/rc1-prod-check.js

'use strict';

const { getPool } = require('../db');

const checks = [];

function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}

async function main() {
  const pool = getPool();

  record('database reachable', true, 'pool created');

  const workspaces = await pool.query('SELECT id, name, slug, plan, status FROM workspaces ORDER BY id');
  record('workspaces query', workspaces.rows.length >= 1, `${workspaces.rows.length} workspace(s)`);

  const founderWs = workspaces.rows.find(w => /founder/i.test(w.name + ' ' + (w.slug || '')));
  record('founder workspace bootstrap', !!founderWs, founderWs ? `${founderWs.name} (#${founderWs.id})` : 'NOT FOUND');

  const founderDeal = await pool.query('SELECT * FROM deals WHERE company_name ILIKE \'%Elmahrosa%\' ORDER BY id LIMIT 1');
  record('Customer #0 (Elmahrosa International) deal', founderDeal.rows.length === 1,
    founderDeal.rows[0] ? `#${founderDeal.rows[0].id} stage=${founderDeal.rows[0].stage} status=${founderDeal.rows[0].status}` : 'NOT FOUND');

  const mission = await pool.query('SELECT * FROM plans WHERE title ILIKE \'%Sell TEOS DealMaker%\' ORDER BY id LIMIT 1');
  record('Customer #0 mission "Sell TEOS DealMaker"', mission.rows.length === 1,
    mission.rows[0] ? `#${mission.rows[0].id} status=${mission.rows[0].status}` : 'NOT FOUND');

  if (mission.rows[0]) {
    const steps = await pool.query('SELECT COUNT(*)::int AS c, COALESCE(SUM(CASE WHEN status = \'completed\' THEN 1 ELSE 0 END),0)::int AS done FROM plan_steps WHERE plan_id = $1', [mission.rows[0].id]);
    record('mission steps', steps.rows[0].c >= 1, `${steps.rows[0].done}/${steps.rows[0].c} completed`);
    const approvals = await pool.query('SELECT COUNT(*)::int AS c, COALESCE(SUM(CASE WHEN status = \'pending\' THEN 1 ELSE 0 END),0)::int AS pending FROM approval_requests WHERE plan_id = $1', [mission.rows[0].id]);
    record('mission approval gate', true, `${approvals.rows[0].c} total, ${approvals.rows[0].pending} pending`);
  }

  const kd = await pool.query('SELECT source_type, COUNT(*)::int AS c FROM knowledge_documents GROUP BY source_type ORDER BY c DESC');
  record('knowledge base populated', kd.rows.length >= 1, kd.rows.map(r => `${r.source_type}=${r.c}`).join(', ') || 'EMPTY');

  const audit = await pool.query('SELECT COUNT(*)::int AS c FROM audit_trail');
  record('audit trail present', audit.rows[0].c >= 1, `${audit.rows[0].c} entries`);

  const auditDetail = await pool.query('SELECT action_type, COUNT(*)::int AS c FROM audit_trail GROUP BY action_type ORDER BY c DESC LIMIT 10');
  record('audit coverage', auditDetail.rows.length >= 5, auditDetail.rows.map(r => `${r.action_type}=${r.c}`).join(', '));

  const agents = await pool.query('SELECT agent_type, status, COUNT(*)::int AS c FROM agents GROUP BY agent_type, status ORDER BY agent_type');
  record('agent registry provisioned', agents.rows.length >= 10, `${agents.rows.length} agent row types: ${agents.rows.slice(0, 13).map(r => `${r.agent_type}:${r.status}`).join(' ')}`);

  const runs = await pool.query('SELECT COUNT(*)::int AS c FROM agent_runs');
  record('agent runs tracked', true, `${runs.rows[0].c} runs`);

  const subs = await pool.query('SELECT plan, status, provider FROM subscriptions');
  record('billing/subscription', subs.rows.length >= 1, subs.rows.map(r => `${r.plan}/${r.status}/${r.provider || '-'}`).join(', ') || 'NO SUBSCRIPTION');

  const settings = await pool.query('SELECT workspace_id, lang FROM workspace_settings ORDER BY workspace_id');
  record('workspace settings/lang', settings.rows.length >= 1, settings.rows.map(r => `#${r.workspace_id}:${r.lang}`).join(', '));

  const convo = await pool.query('SELECT COUNT(*)::int AS c FROM conversations');
  const msgs = await pool.query('SELECT COUNT(*)::int AS c FROM messages');
  record('conversations + messages', true, `${convo.rows[0].c} conversations, ${msgs.rows[0].c} messages`);

  const users = await pool.query('SELECT id, display_name, telegram_id FROM users WHERE telegram_id IS NOT NULL ORDER BY id');
  record('telegram-linked users', users.rows.length >= 1, users.rows.map(u => `#${u.id} tg=${u.telegram_id}`).join(', '));

  const failed = checks.filter(c => !c.ok);
  console.log('\n==========================================');
  console.log(`RC1 PROD CHECK: ${checks.length - failed.length}/${checks.length} PASS`);
  console.log('==========================================');
  await pool.end();
  process.exit(failed.length ? 1 : 0);
}

main().catch(err => {
  console.error('RC1 PROD CHECK CRASHED:', err && err.stack ? err.stack : err);
  process.exit(2);
});
