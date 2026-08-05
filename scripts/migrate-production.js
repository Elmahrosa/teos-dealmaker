// scripts/migrate-production.js
// v1.0.2 production data migration. Aligns legacy rows with the commercial
// plans model (Solo, Growth, Business, Enterprise only — no Free, Trial or
// Trialing anywhere).
//
// Rules:
//   - workspaces.plan 'free'  -> 'solo'
//   - workspaces.plan 'trial' -> 'solo'
//   - subscriptions.plan 'free'/'trial' -> 'solo'
//   - subscriptions.status 'trial'/'trialing' -> 'pending'
//   - Existing active paid subscriptions are never touched.
//   - The founder workspace is never modified.
//   - Idempotent: safe to run repeatedly (no legacy rows => no changes).
//
// Usage:
//   node scripts/migrate-production.js            # apply against DATABASE_URL
//   node scripts/migrate-production.js --dry-run  # preview only, writes nothing
'use strict';

require('dotenv').config();

const LEGACY_WORKSPACE_PLANS = ['free', 'trial'];
const LEGACY_SUBSCRIPTION_PLANS = ['free', 'trial'];
const LEGACY_SUBSCRIPTION_STATUSES = ['trial', 'trialing'];
const NEW_PLAN = 'solo';
const NEW_STATUS = 'pending';

async function founderWorkspaceIds(db) {
  const founderId = process.env.TEOS_FOUNDER_TELEGRAM_ID;
  const ids = new Set();
  const workspaces = await db.adapter.find('workspaces', {});
  for (const ws of workspaces) {
    if (ws.plan === 'founder') {
      ids.add(Number(ws.id));
      continue;
    }
    if (founderId && ws.owner_user_id) {
      const owner = await db.adapter.findOne('users', { id: ws.owner_user_id });
      if (owner && Number(owner.telegram_id) === Number(founderId)) ids.add(Number(ws.id));
    }
  }
  return ids;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const tag = dryRun ? '[migrate:dry-run]' : '[migrate]';

  if (!process.env.DATABASE_URL) {
    console.error(`${tag} DATABASE_URL is not set — cannot run against production.`);
    process.exit(1);
  }

  const db = require('../db');
  const adapter = db.getAdapter();
  const protectedIds = await founderWorkspaceIds({ adapter });
  console.log(`${tag} protected founder workspaces: ${[...protectedIds].join(', ') || 'none'}`);

  const changes = [];
  let mutated = 0;

  async function migrateWorkspaces() {
    const workspaces = await adapter.find('workspaces', {});
    for (const ws of workspaces) {
      if (protectedIds.has(Number(ws.id))) continue;
      if (LEGACY_WORKSPACE_PLANS.includes(ws.plan)) {
        changes.push({ table: 'workspaces', id: ws.id, field: 'plan', from: ws.plan, to: NEW_PLAN });
        if (!dryRun) await adapter.update('workspaces', { id: ws.id }, { plan: NEW_PLAN });
        mutated += 1;
      }
    }
  }

  async function migrateSubscriptions() {
    const subs = await adapter.find('subscriptions', {});
    for (const sub of subs) {
      if (protectedIds.has(Number(sub.workspace_id))) continue;
      const patch = {};
      if (LEGACY_SUBSCRIPTION_PLANS.includes(sub.plan)) {
        changes.push({ table: 'subscriptions', id: sub.id, field: 'plan', from: sub.plan, to: NEW_PLAN });
        patch.plan = NEW_PLAN;
      }
      if (LEGACY_SUBSCRIPTION_STATUSES.includes(sub.status)) {
        changes.push({ table: 'subscriptions', id: sub.id, field: 'status', from: sub.status, to: NEW_STATUS });
        patch.status = NEW_STATUS;
      }
      if (Object.keys(patch).length) {
        if (!dryRun) await adapter.update('subscriptions', { id: sub.id }, patch);
        mutated += 1;
      }
    }
  }

  await migrateWorkspaces();
  await migrateSubscriptions();

  for (const c of changes) {
    console.log(`${tag} ${c.table}.${c.id} ${c.field}: ${c.from} -> ${c.to}`);
  }

  if (dryRun) {
    console.log(`${tag} dry-run complete — ${changes.length} records would be migrated.`);
  } else {
    const audit = require('../utils/auditLogger');
    for (const c of changes) {
      audit.writeEntry('PRODUCTION_MIGRATION', 'system', 'success', c);
    }
    console.log(`${tag} complete — ${changes.length} records migrated (${mutated} rows updated).`);
  }

  console.log(`${tag} ${dryRun ? 'dry-run' : 'apply'} finished. Rerun is safe: this script is idempotent.`);
}

main().catch(err => {
  console.error('[migrate] failed:', err.message);
  process.exit(1);
});
