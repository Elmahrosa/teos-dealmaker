// services/notify.js
// Deal/report notifier. Subscribes to the workforce event bus and pushes
// milestones (mission completed, approval requested, failure) to Slack and/or
// email. Config is env-driven; when nothing is configured it stays inert and
// only logs, so it is safe to ship. Never throws from a listener.
'use strict';

const { on, EVENT_NAMES } = require('./workforce/events');

function createNotifier(opts) {
  const o = opts || {};
  const fetchImpl = o.fetch || (typeof fetch === 'function' ? fetch : null);
  const log = o.log || ((...args) => console.log('[notify]', ...args));
  const sent = [];
  let installed = false;

  function slackWebhook() {
    return process.env.SLACK_WEBHOOK_URL || o.slackWebhookUrl || null;
  }
  function emailConfig() {
    return {
      webhook: process.env.EMAIL_WEBHOOK_URL || o.emailWebhookUrl || null,
      from: process.env.EMAIL_FROM || o.emailFrom || 'DealMaker <no-reply@elmahrosa.org>',
      to: process.env.EMAIL_TO || o.emailTo || null
    };
  }
  function mode() {
    return process.env.APP_MODE || o.mode || 'live';
  }

  async function postSlack(text) {
    const url = slackWebhook();
    if (!url) return { skipped: true, channel: 'slack' };
    if (!fetchImpl) return { skipped: true, reason: 'no_fetch', channel: 'slack' };
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const payload = { channel: 'slack', text, ok: res.ok, status: res.status, skipped: false };
    sent.push(payload);
    return payload;
  }

  async function postEmail(subject, text) {
    const cfg = emailConfig();
    if (!cfg.webhook || !cfg.to) return { skipped: true, channel: 'email' };
    if (!fetchImpl) return { skipped: true, reason: 'no_fetch', channel: 'email' };
    const res = await fetchImpl(cfg.webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: cfg.from, to: cfg.to, subject, text })
    });
    const payload = { channel: 'email', subject, ok: res.ok, status: res.status, skipped: false };
    sent.push(payload);
    return payload;
  }

  async function notify(title, body) {
    const results = [];
    if (mode() === 'live' || mode() === 'demo') {
      results.push(await postSlack(`${title}\n${body}`));
      results.push(await postEmail(title, body));
      for (const r of results) {
        if (r.skipped) log(`skipped ${r.channel}: not configured`);
        else log(`delivered to ${r.channel} -> ${r.ok ? 'ok' : 'status ' + r.status}`);
      }
    } else {
      log(`inert in mode=${mode()}; title="${title}"`);
    }
    return results;
  }

  function install() {
    if (installed) return { ok: false, reason: 'already_installed' };
    installed = true;

    on(EVENT_NAMES.PLAN_COMPLETED, (evt) => {
      const m = evt.metrics || {};
      notify('✅ Mission completed', `Mission "${evt.title || evt.planId}" completed. ${m.completed_steps || 0}/${m.total_steps || 0} steps, avg confidence ${m.avg_confidence ?? '—'}, elapsed ${m.duration_ms ?? 0}ms.`);
    });
    on(EVENT_NAMES.PLAN_FAILED, (evt) => {
      notify('❌ Mission failed', `Mission "${evt.title || evt.planId}" failed. ${evt.error || evt.reason || 'unknown reason'}`);
    });
    on(EVENT_NAMES.TASK_FAILED, (evt) => {
      notify('⚠️ Step failed', `Step ${evt.stepId || evt.stepKey || '?'} (${evt.agentType || '?'}) failed: ${evt.error || evt.reason || 'unknown'}`);
    });
    on(EVENT_NAMES.APPROVAL_REQUESTED, (evt) => {
      notify('🛑 Founder approval requested', `Step ${evt.stepId || '?'} (${evt.agentType || '?'}): ${evt.reason || 'approval needed'} (request ${evt.approvalId || '?'}).`);
    });
    on(EVENT_NAMES.APPROVAL_DECIDED, (evt) => {
      notify(`Founder approval ${evt.status}`, `Request ${evt.approvalId || '?'} for step ${evt.stepId || '?'} was ${evt.status}.`);
    });
    return { ok: true };
  }

  return { install, notify, postSlack, postEmail, sent, isInstalled: () => installed };
}

const defaultNotifier = createNotifier();

module.exports = Object.assign(defaultNotifier, { createNotifier, EVENT_NAMES });
