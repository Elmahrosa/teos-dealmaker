const assert = require('assert');

(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.RESEND_TIMEOUT_MS;

  let passed = 0;
  const ok = (cond, label) => { assert.ok(cond, label); passed += 1; };
  const eq = (a, b, label) => { assert.strictEqual(a, b, label); passed += 1; };

  console.log('\n=== Governed Resend Email Channel ===');

  const { createMemoryAdapter, createRepos } = require('../db');
  const { createEmailChannel, STATES } = require('../services/emailChannel');

  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);
  const ws = repos.workspaces.create({ name: 'Acme', slug: 'acme-email', plan: 'solo', status: 'active' });

  function jsonRes(status, body) {
    const text = JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
      json: async () => JSON.parse(text)
    };
  }

  function makeFakeFetch() {
    const calls = [];
    const queue = [];
    return {
      calls,
      push(status, body) { queue.push(jsonRes(status, body)); },
      pushAbort() {
        queue.push({ error: Object.assign(new Error('aborted'), { name: 'AbortError' }) });
      },
      pushNetworkError() { queue.push({ error: new TypeError('fetch failed') }); },
      impl: async (url, opts) => {
        calls.push({ url, opts });
        const next = queue.shift();
        if (next && next.error) throw next.error;
        if (!next) throw new TypeError('fetch failed');
        return next;
      }
    };
  }

  const key = 're_test_123';
  const fake = makeFakeFetch();
  const channel = createEmailChannel({ resendApiKey: key, fetch: fake.impl });

  const base = {
    workspace_id: ws.id,
    to: 'prospect@acme.com',
    from: 'TEOS DealMaker <no-reply@elmahrosa.org>',
    subject: 'TEOS Sentinel Shield partnership',
    body: 'Hello — would you like to evaluate TEOS DealMaker?'
  };

  // ------------------------------------------ 1. drafting is never approval
  const draftRes = await channel.createDraft(repos, { ...base, campaign: 'outreach-test' });
  ok(draftRes.ok, 'createDraft returns ok');
  const draft = draftRes.email;
  eq(draft.status, STATES.DRAFT, 'draft starts in DRAFT');
  ok(!draft.approved_at, 'draft has no approval timestamp (drafting is not approval)');
  ok(!draft.approved_by, 'draft has no approver');

  // ------------------------------------------ 2. send without approval fails closed
  const early = await channel.send(repos, ws.id, draft.id);
  eq(early.error, 'approval_required', 'send refuses a DRAFT (never approved)');
  eq(early.state, STATES.DRAFT, 'send reports the current DRAFT state');
  eq(fake.calls.length, 0, 'no external call without approval');

  // ------------------------------------------ 3. request approval
  const reqRes = await channel.requestApproval(repos, ws.id, draft.id, { reason: 'founder review' });
  ok(reqRes.ok, 'requestApproval returns ok');
  eq(reqRes.email.status, STATES.PENDING_APPROVAL, 'email moves to PENDING_APPROVAL');
  ok(reqRes.email.requested_at, 'requested_at persisted');

  // ------------------------------------------ 4. pending approval alone is not approval
  const pending = await channel.send(repos, ws.id, draft.id);
  eq(pending.error, 'approval_required', 'send refuses PENDING_APPROVAL without explicit approval');
  eq(fake.calls.length, 0, 'no external call while merely pending approval');

  // ------------------------------------------ 5. explicit founder approval
  const apprRes = await channel.approve(repos, ws.id, draft.id, { approved_by: 'founder@teosegypt.com' });
  ok(apprRes.ok, 'approve returns ok');
  ok(apprRes.email.approved_at, 'approval timestamp persisted');
  eq(apprRes.email.approved_by, 'founder@teosegypt.com', 'approver persisted');

  // ------------------------------------------ 6. missing API key fails closed
  const noKey = createEmailChannel({ fetch: fake.impl });
  const noKeySend = await noKey.send(repos, ws.id, draft.id);
  eq(noKeySend.error, 'resend_not_configured', 'send fails closed without RESEND_API_KEY');
  const noKeyEmail = await repos.outboundEmails.get(ws.id, draft.id);
  eq(noKeyEmail.status, STATES.SEND_FAILED, 'email marked SEND_FAILED');
  eq(fake.calls.length, 0, 'no external call without an API key');

  // Re-create a fresh approved email for the success path
  const okDraft = await channel.createDraft(repos, base);
  await channel.requestApproval(repos, ws.id, okDraft.email.id);
  await channel.approve(repos, ws.id, okDraft.email.id, { approved_by: 'founder@teosegypt.com' });

  // ------------------------------------------ 7. provider success => SENT with message id
  fake.push(200, { id: 're_9b2f3e1a7c' });
  const sent = await channel.send(repos, ws.id, okDraft.email.id);
  ok(sent.ok, 'send returns ok on provider success');
  eq(sent.email.status, STATES.SENT, 'email moves to SENT');
  eq(sent.email.provider, 'resend', 'provider recorded');
  eq(sent.email.provider_message_id, 're_9b2f3e1a7c', 'provider message id persisted');
  eq(sent.email.send_status, 'accepted', 'send_status recorded as accepted');
  ok(sent.email.sent_at, 'sent_at timestamp persisted');
  eq(sent.email.failure_reason, null, 'no failure reason on success');

  eq(fake.calls.length, 1, 'exactly one external call on success');
  const call = fake.calls[0];
  eq(call.url, 'https://api.resend.com/emails', 'payload sent to the Resend emails endpoint');
  eq(call.opts.method, 'POST', 'Resend call is a POST');
  eq(call.opts.headers.authorization, 'Bearer re_test_123', 'API key sent as bearer token');
  const body = JSON.parse(call.opts.body);
  eq(body.to[0], 'prospect@acme.com', 'recipient in payload');
  eq(body.subject, 'TEOS Sentinel Shield partnership', 'subject in payload');

  // ------------------------------------------ 8. provider failure => SEND_FAILED
  const badDraft = await channel.createDraft(repos, base);
  await channel.requestApproval(repos, ws.id, badDraft.email.id);
  await channel.approve(repos, ws.id, badDraft.email.id, { approved_by: 'founder@teosegypt.com' });
  fake.push(422, { message: 'email rejected' });
  const bad = await channel.send(repos, ws.id, badDraft.email.id);
  eq(bad.error, 'provider_error', 'provider error surfaces as provider_error');
  const badRow = await repos.outboundEmails.get(ws.id, badDraft.email.id);
  eq(badRow.status, STATES.SEND_FAILED, 'provider failure => SEND_FAILED');
  ok(badRow.failure_reason.includes('422'), 'failure reason records the provider HTTP status');

  // ------------------------------------------ 9. network failure => SEND_FAILED
  const netDraft = await channel.createDraft(repos, base);
  await channel.requestApproval(repos, ws.id, netDraft.email.id);
  await channel.approve(repos, ws.id, netDraft.email.id, { approved_by: 'founder@teosegypt.com' });
  fake.pushNetworkError();
  const net = await channel.send(repos, ws.id, netDraft.email.id);
  eq(net.error, 'network_error', 'network error surfaces as network_error');
  const netRow = await repos.outboundEmails.get(ws.id, netDraft.email.id);
  eq(netRow.status, STATES.SEND_FAILED, 'network failure => SEND_FAILED');
  ok(netRow.failure_reason.includes('network_error'), 'network failure reason recorded');

  // ------------------------------------------ 10. timeout => SEND_FAILED, never SENT
  const timeDraft = await channel.createDraft(repos, base);
  await channel.requestApproval(repos, ws.id, timeDraft.email.id);
  await channel.approve(repos, ws.id, timeDraft.email.id, { approved_by: 'founder@teosegypt.com' });
  fake.pushAbort();
  const timeout = await channel.send(repos, ws.id, timeDraft.email.id);
  eq(timeout.error, 'timeout', 'timeout surfaces as timeout');
  const timeRow = await repos.outboundEmails.get(ws.id, timeDraft.email.id);
  eq(timeRow.status, STATES.SEND_FAILED, 'timeout => SEND_FAILED, never SENT');
  ok(timeRow.failure_reason.includes('timeout'), 'timeout reason recorded');

  // ------------------------------------------ 11. success without message id => SEND_FAILED
  const noIdDraft = await channel.createDraft(repos, base);
  await channel.requestApproval(repos, ws.id, noIdDraft.email.id);
  await channel.approve(repos, ws.id, noIdDraft.email.id, { approved_by: 'founder@teosegypt.com' });
  fake.push(200, { ok: true });
  const noId = await channel.send(repos, ws.id, noIdDraft.email.id);
  eq(noId.error, 'provider_missing_message_id', 'SENT requires a verifiable provider message id');
  const noIdRow = await repos.outboundEmails.get(ws.id, noIdDraft.email.id);
  eq(noIdRow.status, STATES.SEND_FAILED, 'no message id => SEND_FAILED');
  ok(noIdRow.failure_reason.includes('message id'), 'missing-message-id reason recorded');

  // ------------------------------------------ 12. provider confirmation
  const conf = await channel.confirmFromProvider(repos, ws.id, okDraft.email.id, { status: 'delivered' });
  ok(conf.ok, 'confirmFromProvider returns ok');
  eq(conf.email.status, STATES.PROVIDER_CONFIRMED, 'email moves to PROVIDER_CONFIRMED');
  eq(conf.email.send_status, 'delivered', 'provider status recorded');
  ok(conf.email.confirmed_at, 'confirmed_at timestamp persisted');

  // ------------------------------------------ 13. reject flow
  const rejDraft = await channel.createDraft(repos, base);
  await channel.requestApproval(repos, ws.id, rejDraft.email.id);
  const rej = await channel.reject(repos, ws.id, rejDraft.email.id, {
    rejected_by: 'founder@teosegypt.com',
    reason: 'not in this quarter'
  });
  ok(rej.ok, 'reject returns ok');
  eq(rej.email.status, STATES.REJECTED, 'rejected email is REJECTED');
  ok(rej.email.rejected_at, 'rejected_at persisted');
  eq(rej.email.rejected_by, 'founder@teosegypt.com', 'rejector persisted');
  const rejSend = await channel.send(repos, ws.id, rejDraft.email.id);
  eq(rejSend.error, 'approval_required', 'rejected email cannot be sent');
  eq(fake.calls.length, 5, 'no new external calls after rejection (calls stay at 5)');

  // ------------------------------------------ 14. invalid recipient never persisted
  const inv = await channel.createDraft(repos, { ...base, to: 'not-an-email' });
  eq(inv.error, 'invalid_recipient', 'invalid recipient rejected at draft time');
  eq(inv.ok, false, 'invalid draft returns not ok');

  // ------------------------------------------ 15. invalid state transitions
  const first = await channel.requestApproval(repos, ws.id, okDraft.email.id);
  eq(first.error, 'invalid_state', 'requestApproval refused on PENDING_APPROVAL');
  const draftB = await channel.createDraft(repos, base);
  const approveTooEarly = await channel.approve(repos, ws.id, draftB.email.id);
  eq(approveTooEarly.error, 'invalid_state', 'approve refused on DRAFT');

  // ------------------------------------------ 16. report surface hides body and keys
  const report = channel.toReport(await repos.outboundEmails.get(ws.id, okDraft.email.id));
  eq(report.body, undefined, 'report surface never exposes the message body');
  eq(report.resendApiKey, undefined, 'report surface never exposes the API key');
  ok(typeof report.provider_message_id === 'string', 'report surface includes provider message id');

  // ------------------------------------------ 17. audit trail
  const entries = repos.audit.list(ws.id);
  const actions = entries.map(e => e.action_type);
  for (const expected of ['EMAIL_DRAFTED', 'EMAIL_APPROVAL_REQUESTED', 'EMAIL_APPROVED', 'EMAIL_SENT', 'EMAIL_SEND_FAILED', 'EMAIL_PROVIDER_CONFIRMED', 'EMAIL_REJECTED']) {
    ok(actions.includes(expected), `audit trail contains ${expected}`);
  }

  console.log(`\n✓ tests/test-email-channel.js — ${passed} assertions passed`);
  process.exit(0);
})().catch(err => {
  console.error('TEST FAILED:', err.message);
  process.exit(1);
});

