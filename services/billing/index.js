'use strict';

const crypto = require('crypto');
const { createRepos } = require('../../db/repos');
// Deliberate cross-layer import (services/ -> bot/). design.js is pure -- no
// requires, no env, no reverse dependency -- and esc() must remain the single
// source of truth for escaping text that reaches Telegram's HTML-parsed message
// body; a second escaper defined here would drift from it. Do not "fix" this
// layering by inlining a local escaper.
const { esc } = require('../../bot/design');

const PRODUCT_TO_PLAN_ENV = {
  DODO_STARTER_MONTHLY_PID: 'solo',
  DODO_STARTER_ANNUAL_PID: 'solo',
  DODO_GROWTH_MONTHLY_PID: 'growth',
  DODO_GROWTH_ANNUAL_PID: 'growth',
  DODO_BUSINESS_MONTHLY_PID: 'corporate',
  DODO_BUSINESS_ANNUAL_PID: 'corporate'
};

let productMap = null;

function getPlanForProduct(productId) {
  if (!productId) return null;

  // Build reverse mapping from product ID to plan if not cached
  if (!productMap) {
    productMap = {};
    for (const [envKey, plan] of Object.entries(PRODUCT_TO_PLAN_ENV)) {
      const pid = process.env[envKey];
      if (pid) productMap[pid] = plan;
    }
  }

  const plan = productMap[productId] || null;

  // Additional security: validate that the product ID matches expected format for the plan
  if (plan) {
    // Determine if this is likely a monthly or annual product based on ID patterns
    // This is a basic check - in production, you might want more robust validation
    const isLikelyMonthly = productId.toLowerCase().includes('monthly') ||
                           productId.toLowerCase().includes('_m') ||
                           productId.length > 15; // Heuristic: monthly IDs tend to be longer

    const cycle = isLikelyMonthly ? 'monthly' : 'annual';

    // Verify this product ID is actually valid for the purported plan
    if (!isValidProductForTier(productId, plan, cycle)) {
      console.warn(`[billing] Security: Product ID ${productId} does not match expected mapping for ${plan} ${cycle}`);
      return null; // Treat as invalid product
    }
  }

  return plan;
}

// Mission limits per plan
const MISSION_LIMITS = {
  solo: 5,
  growth: 20,
  corporate: 100,
  trial: 1,
  founder: Infinity,
  manual_pilot: Infinity // Manual pilot mode has no mission limits for validation
};

// Strict product-to-tier mapping for security
// Founder/free tiers map to null (no Dodo required)
// Paid tiers must have valid Dodo product IDs configured
let VALID_PRODUCT_MAPPING = null;

function getValidProductMapping() {
  if (!VALID_PRODUCT_MAPPING) {
    VALID_PRODUCT_MAPPING = {
      // Paid tiers - must have corresponding Dodo product IDs
      solo: {
        monthly: process.env.DODO_STARTER_MONTHLY_PID,
        annual: process.env.DODO_STARTER_ANNUAL_PID
      },
      growth: {
        monthly: process.env.DODO_GROWTH_MONTHLY_PID,
        annual: process.env.DODO_GROWTH_ANNUAL_PID
      },
      corporate: {
        monthly: process.env.DODO_BUSINESS_MONTHLY_PID,
        annual: process.env.DODO_BUSINESS_ANNUAL_PID
      }
      // Founder and trial tiers intentionally omitted - no Dodo required
    };
  }
  return VALID_PRODUCT_MAPPING;
}

// Validate that a product ID is valid for the given tier and cycle
function isValidProductForTier(productId, tier, cycle) {
  const mapping = getValidProductMapping();
  const validProduct = mapping[tier]?.[cycle];
  return validProduct && productId === validProduct;
}

function getMissionLimitForPlan(plan) {
  return MISSION_LIMITS[plan] || null;
}

function verifySignature(rawBody, signature) {
  const secret = process.env.DODO_WEBHOOK_SECRET;
  // Fail closed: without a configured secret no webhook is accepted. A
  // signatureless request must never be treated as valid.
  if (!secret) return { ok: false, reason: 'webhook_secret_not_configured' };
  if (!signature) return { ok: false, reason: 'missing_signature' };
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (signature.length !== expected.length) return { ok: false, expected };
  const ok = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  return { ok, expected };
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

async function handleSubscriptionCreated(adapter, data) {
  const repos = createRepos(adapter);
  const productId = data.product_id || data.plan_id || null;
  const customerId = data.customer_id || data.subscription_id || null;

  // Validate product ID is present and not empty
  if (!productId) {
    console.warn('[billing] subscription.created: missing product_id');
    return { ok: false, reason: 'missing_product_id' };
  }

  // Get plan from product ID with strict validation
  const plan = getPlanForProduct(productId);
  if (!plan) {
    console.warn(`[billing] subscription.created: invalid product ID ${productId}`);
    return { ok: false, reason: 'invalid_product_id' };
  }

  // Determine subscription status from webhook data
  const rawStatus = data.status;
const ALLOWED_STATUSES = ['active', 'trialing', 'past_due', 'canceled', 'incomplete', 'pending', 'unpaid'];
let status = rawStatus;
if (!rawStatus || !ALLOWED_STATUSES.includes(rawStatus)) {
  console.warn(`[billing] subscription.created: invalid or missing status '${rawStatus}', defaulting to 'pending'`);
  status = 'pending';
}
  const cycle = data.billing_cycle || 'monthly';
  const startDate = today();
  const renewalDate = addMonths(startDate, cycle === 'annual' ? 12 : 1);

  let workspaceId = null;

  if (customerId) {
    const allSubs = await repos.subscriptions.list();
    const match = allSubs.find(s => s.provider_customer_id === customerId);
    if (match) workspaceId = match.workspace_id;
  }

  if (!workspaceId && data.metadata && data.metadata.workspace_id) {
    workspaceId = Number(data.metadata.workspace_id);
  }

  if (!workspaceId) {
    console.warn('[billing] subscription.created: no workspace found for customer', customerId);
    return { ok: false, reason: 'workspace_not_found' };
  }

  if (await founderProtected(repos, workspaceId)) {
    console.warn('[billing] subscription.created: founder workspace protected');
    return { ok: true, workspaceId, founderProtected: true };
  }

  const existing = await repos.subscriptions.get(workspaceId);
  if (existing) {
    await repos.subscriptions.update(existing.id, {
      plan,
      status,
      cycle,
      renewal_date: renewalDate,
      missions_used: 0, // Reset missions used on new subscription
      provider_customer_id: customerId || existing.provider_customer_id
    });
  } else {
    await repos.subscriptions.create({
      workspace_id: workspaceId,
      plan,
      status,
      cycle,
      start_date: startDate,
      renewal_date: renewalDate,
      missions_used: 0,
      provider: 'dodo',
      provider_customer_id: customerId
    });
  }

  await repos.workspaces.update(workspaceId, { plan, status });

  if (customerId) {
    await repos.dodoCustomers.create({ workspace_id: workspaceId, dodo_customer_id: customerId, email: data.customer_email || null });
  }

  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: 'billing',
    action_type: 'SUBSCRIPTION_CREATED',
    details: { plan, cycle, customerId, productId },
    version: 'v1.1.0'
  });

  await sendTelegramNotification(`��✅ <b>New Subscription</b>\nPlan: ${esc(plan)}\nCycle: ${esc(cycle)}\nWorkspace: ${esc(workspaceId)}`);

  return { ok: true, workspaceId, plan, status };
}

async function handleSubscriptionRenewed(adapter, data) {
  const repos = createRepos(adapter);
  const customerId = data.customer_id || null;
  const cycle = data.billing_cycle || 'monthly';
  const renewalDate = addMonths(today(), cycle === 'annual' ? 12 : 1);

  let workspaceId = null;
  if (customerId) {
    const allSubs = await repos.subscriptions.list();
    const match = allSubs.find(s => s.provider_customer_id === customerId);
    if (match) workspaceId = match.workspace_id;
  }

  if (!workspaceId) {
    console.warn('[billing] subscription.renewed: no workspace for customer', customerId);
    return { ok: false, reason: 'workspace_not_found' };
  }

  if (await founderProtected(repos, workspaceId)) {
    console.warn('[billing] subscription.renewed: founder workspace protected');
    return { ok: true, workspaceId, founderProtected: true };
  }

  // Fetch the stored subscription FIRST. The status fallback below must never
  // read a variable declared later (the previous code had a temporal dead
  // zone: it referenced `sub` before this fetch and crashed on any invalid
  // status from the webhook).
  const sub = await repos.subscriptions.get(workspaceId);

  // Determine subscription status from webhook data; on a missing or invalid
  // value, keep the stored status rather than fabricating one.
  const ALLOWED_STATUSES = ['active', 'trialing', 'past_due', 'canceled', 'incomplete', 'pending', 'unpaid'];
  let status = data.status;
  if (!status || !ALLOWED_STATUSES.includes(status)) {
    console.warn(`[billing] subscription.renewed: invalid or missing status '${status}', keeping previous status`);
    status = sub ? sub.status : 'pending';
  }

  if (sub) {
    await repos.subscriptions.update(sub.id, {
      status,
      renewal_date: renewalDate,
      missions_used: 0 // Reset missions used on renewal
    });
  }

  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: 'billing',
    action_type: 'SUBSCRIPTION_RENEWED',
    details: { customerId, renewalDate },
    version: 'v1.1.0'
  });

  await sendTelegramNotification(`���🔄 <b>Subscription Renewed</b>\nWorkspace: ${esc(workspaceId)}\nRenewal: ${esc(renewalDate)}`);

  return { ok: true, workspaceId };
}

async function handleSubscriptionCancelled(adapter, data) {
  const repos = createRepos(adapter);
  const customerId = data.customer_id || null;

  let workspaceId = null;
  if (customerId) {
    const allSubs = await repos.subscriptions.list();
    const match = allSubs.find(s => s.provider_customer_id === customerId);
    if (match) workspaceId = match.workspace_id;
  }

  if (!workspaceId) {
    console.warn('[billing] subscription.cancelled: no workspace for customer', customerId);
    return { ok: false, reason: 'workspace_not_found' };
  }

  if (await founderProtected(repos, workspaceId)) {
    console.warn('[billing] subscription.cancelled: founder workspace protected');
    return { ok: true, workspaceId, founderProtected: true };
  }

  // Use status from webhook data, default to 'cancelled' for cancellation events
  const status = data.status || 'cancelled';

  const sub = await repos.subscriptions.get(workspaceId);
  if (sub) {
    await repos.subscriptions.update(sub.id, { status });
  }

  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: 'billing',
    action_type: 'SUBSCRIPTION_CANCELLED',
    details: { customerId },
    version: 'v1.1.0'
  });

  await sendTelegramNotification(`��❌ <b>Subscription Cancelled</b>\nWorkspace: ${esc(workspaceId)}\nPlan retained; subscription inactive`);

  return { ok: true, workspaceId };
}

async function handlePaymentSucceeded(adapter, data) {
  const repos = createRepos(adapter);
  const customerId = data.customer_id || null;
  const amount = data.amount || 0;
  const currency = data.currency || 'USD';

  let workspaceId = null;
  if (customerId) {
    const allSubs = await repos.subscriptions.list();
    const match = allSubs.find(s => s.provider_customer_id === customerId);
    if (match) workspaceId = match.workspace_id;
  }

  if (!workspaceId && data.metadata && data.metadata.workspace_id) {
    workspaceId = Number(data.metadata.workspace_id);
  }

  if (!workspaceId) {
    console.warn('[billing] payment.succeeded: no workspace for customer', customerId);
    return { ok: false, reason: 'workspace_not_found' };
  }

  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: 'billing',
    action_type: 'PAYMENT_SUCCEEDED',
    details: { amount, currency, customerId },
    version: 'v1.1.0'
  });

  await sendTelegramNotification(`���💰 <b>Payment Received</b>\nAmount: ${(amount / 100).toFixed(2)} ${esc(currency)}\nWorkspace: ${esc(workspaceId)}`);

  return { ok: true, workspaceId };
}

async function handlePaymentFailed(adapter, data) {
  const repos = createRepos(adapter);
  const customerId = data.customer_id || null;

  let workspaceId = null;
  if (customerId) {
    const allSubs = await repos.subscriptions.list();
    const match = allSubs.find(s => s.provider_customer_id === customerId);
    if (match) workspaceId = match.workspace_id;
  }

  if (!workspaceId) {
    console.warn('[billing] payment.failed: no workspace for customer', customerId);
    return { ok: false, reason: 'workspace_not_found' };
  }

  if (await founderProtected(repos, workspaceId)) {
    console.warn('[billing] payment.failed: founder workspace protected');
    return { ok: true, workspaceId, founderProtected: true };
  }

  const sub = await repos.subscriptions.get(workspaceId);
  if (sub) {
    await repos.subscriptions.update(sub.id, { status: 'past_due' });
  }

  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: 'billing',
    action_type: 'PAYMENT_FAILED',
    details: { customerId },
    version: 'v1.1.0'
  });

  await sendTelegramNotification(`��⚠��️ <b>Payment Failed</b>\nWorkspace: ${esc(workspaceId)}\nSubscription set to past_due`);

  return { ok: true, workspaceId };
}

async function handleRefund(adapter, data) {
  const repos = createRepos(adapter);
  const customerId = data.customer_id || null;
  const amount = data.amount || 0;
  const currency = data.currency || 'USD';

  let workspaceId = null;
  if (customerId) {
    const allSubs = await repos.subscriptions.list();
    const match = allSubs.find(s => s.provider_customer_id === customerId);
    if (match) workspaceId = match.workspace_id;
  }

  if (!workspaceId) {
    console.warn('[billing] refund: no workspace for customer', customerId);
    return { ok: false, reason: 'workspace_not_found' };
  }

  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: 'billing',
    action_type: 'REFUND_ISSUED',
    details: { amount, currency, customerId },
    version: 'v1.1.0'
  });

  await sendTelegramNotification(`���💸 <b>Refund Issued</b>\nAmount: ${(amount / 100).toFixed(2)} ${esc(currency)}\nWorkspace: ${esc(workspaceId)}`);

  return { ok: true, workspaceId };
}

async function handlePlanChange(adapter, data, direction) {
  const repos = createRepos(adapter);
  const customerId = data.customer_id || null;
  const productId = data.product_id || data.plan_id || null;
  const newPlan = getPlanForProduct(productId);

  let workspaceId = null;
  if (customerId) {
    const allSubs = await repos.subscriptions.list();
    const match = allSubs.find(s => s.provider_customer_id === customerId);
    if (match) workspaceId = match.workspace_id;
  }

  if (!workspaceId) {
    console.warn(`[billing] subscription.${direction}: no workspace for customer`, customerId);
    return { ok: false, reason: 'workspace_not_found' };
  }

  if (await founderProtected(repos, workspaceId)) {
    console.warn(`[billing] subscription.${direction}: founder workspace protected`);
    return { ok: true, workspaceId, founderProtected: true };
  }

  if (newPlan) {
    await repos.workspaces.update(workspaceId, { plan: newPlan });
    const sub = await repos.subscriptions.get(workspaceId);
    if (sub) {
      await repos.subscriptions.update(sub.id, { plan: newPlan });
    }
  }

  const actionType = direction === 'upgraded' ? 'SUBSCRIPTION_UPGRADED' : 'SUBSCRIPTION_DOWNGRADED';
  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: 'billing',
    action_type: actionType,
    details: { customerId, newPlan, direction },
    version: 'v1.1.0'
  });

  const arrow = direction === 'upgraded' ? '��⬆��️' : '��⬇��️';
  await sendTelegramNotification(`${arrow} <b>Subscription ${esc(direction)}</b>\nNew plan: ${esc(newPlan)}\nWorkspace: ${esc(workspaceId)}`);

  return { ok: true, workspaceId, plan: newPlan };
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
  'subscription.created': (adapter, data) => handleSubscriptionCreated(adapter, data),
  'subscription.renewed': (adapter, data) => handleSubscriptionRenewed(adapter, data),
  'subscription.cancelled': (adapter, data) => handleSubscriptionCancelled(adapter, data),
  'payment.succeeded': (adapter, data) => handlePaymentSucceeded(adapter, data),
  'payment.failed': (adapter, data) => handlePaymentFailed(adapter, data),
  'refund.success': (adapter, data) => handleRefund(adapter, data),
  'subscription.upgraded': (adapter, data) => handlePlanChange(adapter, data, 'upgraded'),
  'subscription.downgraded': (adapter, data) => handlePlanChange(adapter, data, 'downgraded'),
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
  verifySignature,
  handleEvent,
  isWebhookProcessed,
  markWebhookProcessed,
  getPlanForProduct,
  getMissionLimitForPlan,
  isEntitled,
  incrementMissionsUsed,
  sendTelegramNotification,
  EVENT_HANDLERS
};
