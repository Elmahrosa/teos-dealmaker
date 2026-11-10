'use strict';

const { createRepos } = require('../../db/repos');
// Deliberate cross-layer import (services/ -> bot/). design.js is pure -- no
// requires, no env, no reverse dependency -- and esc() must remain the single
// source of truth for escaping text that reaches Telegram's HTML-parsed message
// body; a second escaper defined here would drift from it. Do not "fix" this
// layering by inlining a local escaper.
const { esc } = require('../../bot/design');

// Mission limits per plan
const MISSION_LIMITS = {
  solo: 5,
  growth: 20,
  corporate: 100,
  trial: 1,
  founder: Infinity,
  manual_pilot: Infinity // Manual pilot mode has no mission limits for validation
};

function getMissionLimitForPlan(plan) {
  return MISSION_LIMITS[plan] || null;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addMonths(isoDate, months) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

async function sendTelegramNotification(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const founderId = process.env.TEOS_FOUNDER_TELEGRAM_ID;
  if (!token || !founderId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: Number(founderId), text: message, parse_mode: 'HTML' })
    });
  } catch (err) {
    console.error('[billing] Telegram notification failed:', err.message);
  }
}

// The founder workspace is never modified by billing webhooks. Identity is
// determined by TEOS_FOUNDER_TELEGRAM_ID (or the internal 'founder' plan) —
// never by subscription state.
async function founderProtected(repos, workspaceId) {
  if (!workspaceId) return true;
  const workspace = await repos.workspaces.get(workspaceId);
  if (!workspace) return true;
  if (workspace.plan === 'founder') return true;
  const founderId = process.env.TEOS_FOUNDER_TELEGRAM_ID;
  if (founderId && workspace.owner_user_id) {
    const owner = await repos.users.getById(workspace.owner_user_id);
    if (owner && Number(owner.telegram_id) === Number(founderId)) return true;
  }
  return false;
}

async function isEntitled(adapter, workspaceId) {
  const repos = createRepos(adapter);
  const workspace = await repos.workspaces.get(workspaceId);
  if (!workspace) return false;

  // Founder plan is always entitled
  if (workspace.plan === 'founder') return true;

  // Manual pilot mode entitlement - check for manual pilot activation
  if (workspace.plan === 'manual_pilot') {
    // Check if there's an active manual pilot activation
    const activation = await repos.manualPilotActivations.getActiveByWorkspace(workspaceId);
    return activation !== null && activation.status === 'active';
  }

  // Regular subscription-based entitlement
  const subscription = await repos.subscriptions.get(workspaceId);
  if (!subscription) return false;
  if (subscription.status !== 'active') return false;
  const limit = getMissionLimitForPlan(subscription.plan);
  if (limit === null) return true; // unlimited
  return subscription.missions_used < limit;
}

async function incrementMissionsUsed(adapter, workspaceId, increment = 1) {
  const repos = createRepos(adapter);
  const subscription = await repos.subscriptions.get(workspaceId);
  if (!subscription) return null;
  await repos.subscriptions.update(subscription.id, {
    missions_used: subscription.missions_used + increment
  });
  return await repos.subscriptions.get(workspaceId);
}

async function handleManualPilotActivated(adapter, data) {
  const repos = createRepos(adapter);
  const workspaceId = data.workspace_id || null;
  const activatedBy = data.activated_by || null;
  const plan = data.plan || 'manual_pilot';
  const notes = data.notes || null;

  if (!workspaceId) {
    console.warn('[billing] manual_pilot.activated: missing workspace_id');
    return { ok: false, reason: 'missing_workspace_id' };
  }

  // Verify workspace exists
  const workspace = await repos.workspaces.get(workspaceId);
  if (!workspace) {
    console.warn('[billing] manual_pilot.activated: workspace not found', workspaceId);
    return { ok: false, reason: 'workspace_not_found' };
  }

  // Check if founder protection applies
  if (await founderProtected(repos, workspaceId)) {
    console.warn('[billing] manual_pilot.activated: founder workspace protected');
    return { ok: true, workspaceId, founderProtected: true };
  }

  // Deactivate any existing manual pilot activation for this workspace
  const existingActivation = await repos.manualPilotActivations.getActiveByWorkspace(workspaceId);
  if (existingActivation) {
    await repos.manualPilotActivations.deactivate(workspaceId);
  }

  // Create new manual pilot activation
  await repos.manualPilotActivations.create({
    workspace_id: workspaceId,
    activated_by: activatedBy,
    plan: plan,
    notes: notes
  });

  // Update workspace plan to manual_pilot
  await repos.workspaces.update(workspaceId, { plan: 'manual_pilot' });

  // Record audit event
  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: 'billing',
    action_type: 'MANUAL_PILOT_ACTIVATED',
    details: { workspaceId, activatedBy, plan, notes, activationTimestamp: new Date().toISOString() },
    version: 'v1.1.0'
  });

  // Send telegram notification
  await sendTelegramNotification(`���🎯 <b>Manual Pilot Activated</b>\nWorkspace: ${esc(workspaceId)}\nPlan: ${esc(plan)}\nActivated by: ${esc(activatedBy || 'system')}`);

  return { ok: true, workspaceId, plan };
}

const EVENT_HANDLERS = {
  'manual_pilot.activated': (adapter, data) => handleManualPilotActivated(adapter, data)
};

// Persistence-backed webhook idempotency (replay guard). `processedIds` is an
// in-process fast path that also closes the check-then-act race when two
// replays arrive while the first is still being handled. The
// billing_webhook_events row is the durable record that survives restarts and,
// in Postgres, the UNIQUE(event_id) constraint makes the dedupe cross-process.
// Signature verification happens earlier in the HTTP route, before this layer.
const processedIds = new Set();
const PROCESSED_ID_CAP = 10000;

async function isWebhookProcessed(adapter, eventId) {
  if (processedIds.has(eventId)) return true;
  const repos = createRepos(adapter);
  const row = await repos.billingWebhookEvents.getByEventId(eventId);
  if (row) {
    if (processedIds.size > PROCESSED_ID_CAP) processedIds.clear();
    processedIds.add(eventId);
    return true;
  }
  return false;
}

async function markWebhookProcessed(adapter, entry) {
  if (processedIds.size > PROCESSED_ID_CAP) processedIds.clear();
  processedIds.add(entry.event_id);
  const repos = createRepos(adapter);
  try {
    return await repos.billingWebhookEvents.add(entry);
  } catch (_err) {
    // Postgres UNIQUE(event_id) violation → another process already recorded
    // this event; treat the mark as a no-op.
    return null;
  }
}

async function handleEvent(adapter, eventType, data, opts) {
  const o = opts || {};
  const eventId = o.eventId || (data && (data.event_id || data.id));
  if (eventId) {
    const previouslyHandled = await isWebhookProcessed(adapter, eventId);
    if (previouslyHandled) {
      return { ok: true, duplicate: true, eventType, eventId };
    }
  }
  const handler = EVENT_HANDLERS[eventType];
  if (!handler) {
    console.warn('[billing] unhandled event type:', eventType);
    return { ok: true, skipped: true, reason: 'unhandled_event' };
  }
  const result = await handler(adapter, data);
  // Only a successful handling is recorded as processed, so a handler failure
  // (HTTP 500 path) still allows the provider to retry and re-apply.
  if (eventId && result && result.ok === true) {
    await markWebhookProcessed(adapter, {
      event_id: eventId,
      event_type: eventType,
      workspace_id: result.workspaceId || null,
      status: 'processed',
      processed_at: new Date().toISOString()
    });
  }
  return result;
}

module.exports = {
  handleEvent,
  isWebhookProcessed,
  markWebhookProcessed,
  getMissionLimitForPlan,
  isEntitled,
  incrementMissionsUsed,
  sendTelegramNotification,
  EVENT_HANDLERS
};
