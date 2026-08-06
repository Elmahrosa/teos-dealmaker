'use strict';

const crypto = require('crypto');
const { createRepos } = require('../../db/repos');

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
  if (!productMap) {
    productMap = {};
    for (const [envKey, plan] of Object.entries(PRODUCT_TO_PLAN_ENV)) {
      const pid = process.env[envKey];
      if (pid) productMap[pid] = plan;
    }
  }
  return productMap[productId] || null;
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

async function handleSubscriptionCreated(adapter, data) {
  const repos = createRepos(adapter);
  const productId = data.product_id || data.plan_id || null;
  const customerId = data.customer_id || data.subscription_id || null;
  const plan = getPlanForProduct(productId) || 'solo';
  const status = 'active';
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
      provider: 'dodo',
      provider_customer_id: customerId
    });
  }

  await repos.workspaces.update(workspaceId, { plan, status: 'active' });

  if (customerId) {
    await repos.dodoCustomers.create({ workspace_id: workspaceId, dodo_customer_id: customerId, email: data.customer_email || null });
  }

  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: 'billing',
    action_type: 'SUBSCRIPTION_CREATED',
    details: { plan, cycle, customerId, productId },
    version: 'v1.0.0'
  });

  await sendTelegramNotification(`✅ <b>New Subscription</b>\nPlan: ${plan}\nCycle: ${cycle}\nWorkspace: ${workspaceId}`);

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

  const sub = await repos.subscriptions.get(workspaceId);
  if (sub) {
    await repos.subscriptions.update(sub.id, { status: 'active', renewal_date: renewalDate });
  }

  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: 'billing',
    action_type: 'SUBSCRIPTION_RENEWED',
    details: { customerId, renewalDate },
    version: 'v1.0.0'
  });

  await sendTelegramNotification(`🔄 <b>Subscription Renewed</b>\nWorkspace: ${workspaceId}\nRenewal: ${renewalDate}`);

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

  const sub = await repos.subscriptions.get(workspaceId);
  if (sub) {
    await repos.subscriptions.update(sub.id, { status: 'cancelled' });
  }

  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: 'billing',
    action_type: 'SUBSCRIPTION_CANCELLED',
    details: { customerId },
    version: 'v1.0.0'
  });

  await sendTelegramNotification(`❌ <b>Subscription Cancelled</b>\nWorkspace: ${workspaceId}\nPlan retained; subscription inactive`);

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
    version: 'v1.0.0'
  });

  await sendTelegramNotification(`💰 <b>Payment Received</b>\nAmount: ${(amount / 100).toFixed(2)} ${currency}\nWorkspace: ${workspaceId}`);

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
    version: 'v1.0.0'
  });

  await sendTelegramNotification(`⚠️ <b>Payment Failed</b>\nWorkspace: ${workspaceId}\nSubscription set to past_due`);

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
    version: 'v1.0.0'
  });

  await sendTelegramNotification(`💸 <b>Refund Issued</b>\nAmount: ${(amount / 100).toFixed(2)} ${currency}\nWorkspace: ${workspaceId}`);

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
    version: 'v1.0.0'
  });

  const arrow = direction === 'upgraded' ? '⬆️' : '⬇️';
  await sendTelegramNotification(`${arrow} <b>Subscription ${direction}</b>\nNew plan: ${newPlan}\nWorkspace: ${workspaceId}`);

  return { ok: true, workspaceId, plan: newPlan };
}

const EVENT_HANDLERS = {
  'subscription.created': (adapter, data) => handleSubscriptionCreated(adapter, data),
  'subscription.renewed': (adapter, data) => handleSubscriptionRenewed(adapter, data),
  'subscription.cancelled': (adapter, data) => handleSubscriptionCancelled(adapter, data),
  'payment.succeeded': (adapter, data) => handlePaymentSucceeded(adapter, data),
  'payment.failed': (adapter, data) => handlePaymentFailed(adapter, data),
  'refund.success': (adapter, data) => handleRefund(adapter, data),
  'subscription.upgraded': (adapter, data) => handlePlanChange(adapter, data, 'upgraded'),
  'subscription.downgraded': (adapter, data) => handlePlanChange(adapter, data, 'downgraded')
};

async function handleEvent(adapter, eventType, data) {
  const handler = EVENT_HANDLERS[eventType];
  if (!handler) {
    console.warn('[billing] unhandled event type:', eventType);
    return { ok: true, skipped: true, reason: 'unhandled_event' };
  }
  return handler(adapter, data);
}

module.exports = {
  verifySignature,
  handleEvent,
  getPlanForProduct,
  sendTelegramNotification,
  EVENT_HANDLERS
};
