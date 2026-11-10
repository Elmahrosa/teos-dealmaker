# Payment and acceptance verifier (design; not implemented, no provider wired)

Status: no verifier is installed. `repos.deals.closeWon()` therefore fails closed
with `PAYMENT_VERIFIER_UNAVAILABLE`, and no deal can reach `won` or `closed`.
Nothing here activates a payment provider or accepts payments.

## Where it plugs in
- Only `repos.deals.closeWon(workspaceId, dealId, { customerAcceptance, paymentEvidence })`
  (db/repos.js) can write `won`/`closed`. `create`, `update`, `advanceStage` and the
  raw adapter (`db/adapter.js`, `deals` table) refuse terminal states.
- The verifier is installed once, at process boot, through
  `installTrustedVerifier(verifier)` (services/paymentVerifier.js). The first
  repository construction seals the slot; later installs throw. Request handlers,
  bot code and `services/queue.js` never receive or pass a verifier.
- Tests inject a ledger-backed fake through `createRepos(adapter, { paymentVerifier })`
  (tests/helpers/testPaymentVerifier.js). A test in tests/test-customer0-lifecycle.js
  fails if any production file installs or injects a verifier.

## Contract
Both methods are async and return `{ ok: true, ...facts }` or `{ ok: false, reason }`.

    verifyPayment({ deal, evidence })      -> { ok, reference, source, amount, currency, recordedAt, recordedBy }
    verifyAcceptance({ deal, acceptance }) -> { ok, acceptedBy, acceptedAt, proofRef }

closeWon records the facts RETURNED BY THE VERIFIER, never the caller's object.

## Evidence provenance
The verifier must establish facts independently of the caller. Acceptable sources:
- the payment provider's API, queried server-side by reference with our credentials;
- a webhook event stored earlier by an endpoint that verified the provider signature;
- a line in a bank-statement ledger imported by a trusted process.
Not acceptable: `verified: true`, a reference string, a receipt file name, or a
founder button/assertion without a separately recorded artifact. A founder-confirmed
receipt is valid only when the receipt document exists in a store the verifier reads
and was recorded by an authenticated founder identity.

## Acceptance verification
Acceptance needs a named accepter, a non-future timestamp and a proof reference
(signed contract id, e-signature envelope id, inbound message id) that the verifier
can resolve to a stored artifact belonging to the same workspace and deal.

## Amount and currency
Verified amount must equal `deals.deal_value` (NUMERIC(12,2), returned by pg as a
string, compared as a number) and the ISO currency must match case-insensitively.
Partial, over- and under-payments are rejected, not rounded.

## Replay protection (verifier responsibility; not enforced in this repo yet)
A provider reference may settle exactly one deal. The verifier must keep a consumed
reference set keyed by (source, reference) and reject reuse on another deal or
workspace. Backing it with a UNIQUE index on (source, reference) is recommended; that
needs a schema migration which has NOT been written or reviewed here.

## Atomicity and idempotency
closeWon runs in ONE database transaction (`adapter.withTransaction`): the
compare-and-set on the observed (stage, status), the `pipeline_events` row for the
win, and the `DEAL_WON` `audit_trail` row (scoped to workspace and deal) commit
together or roll back together. If any statement fails, the deal keeps its original
stage and status and nothing is recorded; retrying is safe. Repeating the call for
an already-won deal returns it unchanged with no second event or audit row. Under 12
concurrent callers PostgreSQL recorded one `won` event and one `DEAL_WON` row.

## Audit trail and its authority
- Authoritative, synchronous: the hash-chained vault file (`data/vault/audit.log`,
  utils/auditLogger.js). `verifyVault()` detects edits to history.
- For wins, the transactional `audit_trail` row is the database record, and a
  transactional outbox row (`audit_outbox`) carries the vault event.
- For every other event the PostgreSQL `audit_trail` row is a best-effort mirror:
  asynchronous, errors are logged ("mirror failed") and never thrown.

## Transactional outbox (db/migrations/017_audit_outbox.sql, services/auditOutbox.js)
closeWon inserts an `audit_outbox` row in the SAME transaction as the deal
transition, the `pipeline_events` row and the `audit_trail` row. Each row has a
unique UUID `event_id`, `state` (`pending`, `failed`, `delivered`), `attempts`,
`last_error`, `vault_hash` and `delivered_at`. After commit, closeWon delivers its
own event; if that fails the win stands, the row stays pending, and the caller gets
`audit_vault: 'FAILED'` (never a clean success).

Delivery (`deliverEvent`), in order:
1. `verifyVault()`; a broken chain blocks delivery and nothing is appended.
2. Look the `event_id` up in the vault (it is stored as `details.eventId`). Append
   an entry only if absent, so retries, duplicate attempts and repeated
   reconciliation cannot duplicate a vault entry.
3. `verifyVault()` again and confirm the entry is present.
4. Only then mark the row `delivered` and store the entry hash.
Any failure increments `attempts`, records `last_error`, and leaves the row
`pending`; after 5 attempts it becomes `failed`. Rows are never deleted, and both
`pending` and `failed` rows are retried by every reconcile.

Recovery:
- Startup: `server/index.js` calls `reconcileOnStartup` after listening (never blocks boot).
- Explicit: `auditOutbox.reconcile(adapter)` or the founder-only
  `POST /api/audit-outbox/reconcile`; `GET /api/audit-outbox` and
  `auditOutbox.counts(adapter)` expose `{ pending, failed, delivered }`.
- Crash after commit, before vault: row is pending; reconcile appends the entry once.
- Crash after the vault append, before marking: reconcile finds the `eventId` in the
  vault and marks delivered without appending again.
- Broken vault chain: delivery fails and is counted until the chain is repaired
  (an operator action); then reconcile delivers and `failed` rows recover.
- Missing mirror rows: `syncVaultToDb()` (idempotent) is still the repair for the
  best-effort mirror. The mirror reuses one pool per process.

Cross-process lock: delivery runs under one PostgreSQL session advisory lock
(`pg_try_advisory_lock(hashtextextended('teos:audit_vault_delivery', 0))`) on a
dedicated connection. It covers re-reading the row, the event lookup, the vault
append, the chain verification and the delivered-state update. The lock is global,
not per event, because the hash chain is one sequence and appends of different
events would otherwise fork it. If another session holds the lock for 5 seconds,
nothing is appended, the row stays `pending` with `last_error = vault_lock_busy`
(not counted as a failed attempt), and the next reconcile retries. If the holding
connection dies, PostgreSQL releases the lock. The memory adapter provides an
in-process mutex with the same contract.

Operations:
- `GET /api/audit-outbox` (founder auth) returns `{ ok, counts, warning }`; `ok` is
  false and `warning` is set whenever failed > 0. `GET /api/deploy-verify` also
  reports `audit_outbox` counts and sets `ok:false` on failures.
- Failed events log `[auditOutbox] ALERT` and notify the founder through
  services/notify (Slack or email, inert when unconfigured). Notifications are
  sent when the failed count rises, then at most once every 6 hours; retries do not
  re-notify. The throttle is per process, so a restart may alert once more.
- The web service (`server/index.js`) is the only process that reconciles: once at
  startup (fire-and-forget after listen, 30 second bound, non-overlapping, safe to
  repeat) and every 5 minutes (`OUTBOX_RECONCILE_INTERVAL_MS`, 0 disables). The bot
  never reconciles. A process that calls `closeWon` still delivers its own just
  committed event, under the same lock.

Limits: the lock is a database lock but the vault is a local file. Two services
with separate filesystems would keep separate vaults, so run exactly one web
instance owning the vault file. No verifier exists yet, so closeWon cannot
succeed in production today.

## Failure and retry
- Verifier unavailable/timeout: closeWon throws; the deal stays open. Retry is safe.
- `ok:false`: rejected and audited; retry only with new evidence.
- Any database error inside the transaction: full rollback, error surfaces, retry safe.
