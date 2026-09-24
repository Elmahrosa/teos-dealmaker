# SECURITY REMEDIATION REPORT — TEOS DealMaker v1.1.0

> Ordered, controlled remediation of `deliverables/NEVER_TOUCH_AUDIT.md` findings.
> Branch: `security/controlled-remediation-2026-09` (from `main@811e578`). Session `ses_f2b84...W935J`.
> All changes remain **uncommitted** on the branch — no commit/push performed (per directive).
> `deliverables/NEVER_TOUCH_AUDIT.md` was **not modified**.

---

## 1. Scope and purpose

Execute the five ordered security phases plus the secondary hardening items against the
TEOS mission controller, fix each verified finding with a minimal diff, protect the audit's
Tier 1 / Tier 2 modules (changed only for verified fixes), keep all interfaces additive and
backward-compatible, and never fabricate test results. Each phase was validated by its own
tests, then by the full suite.

## 2. Baseline

| Item | Value |
|---|---|
| Source branch | `main@811e578` (`811e57884a9f9c2b2174ad81b8abdedb5de738eb`) |
| Remediation branch | `security/controlled-remediation-2026-09` |
| Node | v24.19.0, dependencies installed |
| Baseline suite | **79 / 79** passed |
| Audit reference | `deliverables/NEVER_TOUCH_AUDIT.md` (§5 Red Flags, items 1–14) |

## 3. Methodology and guardrails

Per-phase discipline:

1. Read + verify each flagged site before changing anything.
2. Prefer additive, backward-compatible changes; preserve interfaces; no redesign or relocation.
3. Every Tier 1 / Tier 2 edit was made only for a verified audit fix and covered by the full
   82-suite regression.
4. `node --check` syntax gate on every changed file, then affected suites, then full `npm test`.
5. No false-positive claims: every assertion count below was observed from an actual run.

## 4. Phase 1 — MCP deny-by-default (Audit finding 1)

**Finding:** MCP policy defaulted to allow-ALL when no rule fired; the registry ships dangerous
tools (`docker.runContainer`, `postgres.query`, `filesystem.writeFile`, `stripe.createCharge`,
`slack.postMessage`), so with `MCP_ENABLED=true` plus an endpoint and no allow-list, only
registry membership stood between a caller and those tools.

**Changes (verified fix, Tier 1):**
- `services/mcp/policy.js` — default is now **deny**: requests not matched by any allow rule,
  workspace list, or custom rule are rejected (`policy_deny_default`), deny-wins preserved.
- `services/mcp/index.js` — boot-time `syncPolicyAllowList()`: enabled plugins' declared tools
  are explicitly allow-listed at boot; built-in registry tools are **never** auto-authorized
  (operator must allow-list them explicitly).
- Tests: `tests/test-mcp.js` (82 assertions: registry, allow-list/deny default, workspace
  isolation, civicMixer adapter, client health/discover, execution contract) and
  `tests/test-mcp-mission.js` (33 assertions: mission → workforce → MCP gate chain, audit).

**Verification:** suites green; full suite green after phase.

## 5. Phase 2 — Mission scheduler: opt-in gates + dormant auto-approval path (Audit finding 3)

**Finding:** auto-outreach defaulted ON (`!== 'false'`); `runAutoOutreach()` auto-approved up
to 10 pending-approval emails per tick as founder `'mission_scheduler'`, contradicting the
"nothing ships without founder approval" README guarantee.

**Scope decision (per directive):** strict opt-in (`=== 'true'`) for the two **sending**
switches only — `MISSION_SCHEDULER_ENABLED` and `AUTO_OUTREACH_ENABLED`. The non-sending
analytic flags (`FOLLOW_UP_ENABLED`, `PROSPECT_DISCOVERY_ENABLED`, `PIPELINE_HEALTH_ENABLED`)
are left on their existing `!== 'false'` behavior.

**Changes (`services/missionScheduler.js`, verified fixes, Tier 2):**
- `MISSION_SCHEDULER_ENABLED` and `AUTO_OUTREACH_ENABLED` now require explicit `'true'`.
- **Dormant dispatch path discovered + fixed:** the pending-approval query called
  `list({status, limit})` with the wrong argument shape (it needs `(workspace_id, opts)`), so
  **auto-approval had never fired**; fixed via `listAll(10000)` + pending filter, and the
  retry tick self-gates on the auto-approval status case `PENDING_APPROVAL`.
- `customer0.decide` received the raw adapter instead of the `{adapter, pg, repos}` object —
  crash path fixed.
- Scheduler statics now self-gate against the founder emergency stop
  (`emergencyStop.isEngaged()`).
- `.env.example` scheduler section rewritten to document the opt-in contract.

**Verification:** `tests/test-mission-scheduler.js` (66 assertions) — including that a tick
cannot auto-approve while `AUTO_OUTREACH_ENABLED` is unset, and dispatch authorization is
checked, not just scheduler internals.

## 6. Phase 3 — Founder-only report surfaces (Audit finding 4)

**Finding:** `/reports`, `/api/reports/latest`, `/customer-0` returned the latest mission
report unauthenticated.

**Changes (`server/index.js`, verified fix):**
- `checkFounderSession` (from `sessionService.requireFounderSession`, server-side identity only)
  now gates `/customer-0`, `/reports`, and `/api/reports/latest`.
- `/report/:reportToken` remains public by design — it is authenticated by an unguessable,
  per-report token (192-bit, `generateReportToken`).
- `config/product.config.js` `reports` key untouched (no code consumers).

**Verification:** `tests/test-report-access.js` (28 assertions) — unauth GETs to all three
routes rejected; direct-API checks (not just route presence) confirm no founder data reaches
unauthenticated or non-founder callers; token route still readable.

## 7. Phase 4 — Simulated success must never masquerade as real (Audit finding 2)

**Finding:** `services/mcp/client.js` returned `{ok:true, simulated:true}` for
`mcp_disabled` / `mcp_not_configured`; any caller ignoring `simulated` believed the tool ran.

**Changes (verified fix, Tier 1 `client.js` + `tools.js`):**
- `services/mcp/client.js` — every result now carries an explicit
  `execution: 'live' | 'simulated' | 'none'` (additive, backward-compatible) across
  `call()`, `health()`, and `discover()`; `simulated: true/false` retained for old callers.
- `services/workforce/tools.js` — the audit chokepoint now logs a simulated result under its
  own event **`MCP_TOOL_SIMULATED`** with mode `info` and `execution` in the details;
  `MCP_TOOL_OK`/`success` is emitted **only** for genuine live runs. A simulated success can
  never be logged as a completed real execution.
- Billing dry-runs verified, no change needed: `utils/dodoPayments.js` already returns
  `dryRun:true` with `url:null` and no `ok` flag; treasurer labels `dry_run`/`live` and its
  mock URL is the reserved `manual-pilot.example.com`; a dry-run cannot create entitlement or
  payment state (entitlement is driven only by signed subscription/manual-pilot state).

**Verification:** `tests/test-mcp.js` (execution contract per result type) and
`tests/test-mcp-mission.js` (simulated outcome → `MCP_TOOL_SIMULATED`, never `MCP_TOOL_OK`;
live outcome stays `success`+`live`); `tests/test-treasurer.js` strengthened with hard
assertions (`dryRun===true`, inert URL).

## 8. Phase 5 — Billing: webhook idempotency, TDZ, entitlement alignment (Findings 5, 6, 7)

### 8.1 Webhook idempotency, persistence-backed (Finding 5)

**Finding:** a replayed signed `subscription.created` reset `missions_used=0` and rewrote
plan/status — no event-id dedupe on the revenue-critical path.

**Changes (verified fix, Tier 1):**
- New table `billing_webhook_events` (`db/tables.js`) + migration
  `db/migrations/016_add_billing_webhook_events.sql` with **UNIQUE(event_id)** so the dedupe
  is durable and cross-process in Postgres; forward-only and idempotent.
- New repo `billingWebhookEvents` (`db/repos.js`: `add`, `getByEventId`) mirroring the
  `resend_events` precedent.
- `services/billing/index.js` — `handleEvent(adapter, eventType, data, opts)` accepts
  `opts.eventId`; a replay returns `{ok:true, duplicate:true}` without re-applying state.
  An in-process id set (bounded) closes the check-then-act race for concurrent replays; the
  row is the durable record. **Only successful handlings are marked processed**, so a 500 /
  `ok:false` still allows provider retry.
- `server/index.js` `/webhook/dodo` — extracts the event id and passes it through; signature
  verification (HMAC-SHA256) still runs **before** any state change.

### 8.2 Temporal-dead-zone bug (Finding 6)

`subscription.renewed` referenced `sub` before its `const sub` (previously threw
`ReferenceError` on any invalid/missing status → 500, no state change). Rewritten so the
stored subscription is fetched **first**; a missing/invalid status now keeps the stored
status instead of crashing. `tests/test-billing.js` adds a no-status renewal regression.

### 8.3 Entitlement definitions aligned (Finding 7)

`services/platform/entitlements/index.js` accepted `['active','pending']` and treated a
**missing** subscription row as valid, while billing accepted only `active` — the enterprise
capability gate could grant entitlements before payment confirmed or with no subscription.

**Changes (verified fix, Tier 1 `services/platform/entitlements/index.js`):**
- `VALID_SUBSCRIPTION_STATUSES = ['active']` — mirrors `billing.isEntitled`.
- `license()`: founder/enterprise remain inherently entitled; `manual_pilot` requires a live
  founder activation; every commercial plan requires an **active subscription row** (missing,
  pending, trialing, past_due, canceled → not licensed).

**Verification:** `tests/test-billing.js` (75 assertions) and `tests/test-platform-foundation.js`
(63 assertions) extended: renewed-TDZ regression, replay dedupe, persisted marker row,
failed-handling retry, and the aligned license semantics (pending/no-subscription invalid;
enterprise still inherently entitled).

## 9. Secondary hardening (Findings 9, 11, 12, 13)

| Finding | Change (verified) |
|---|---|
| **9. Postgres TLS may be plaintext** (`db/pool-config.js`) | Non-local connection strings now default to TLS with certificate verification on. Explicit opt-outs preserved: `PGSSLMODE=disable` / `sslmode=disable`; `PG_REJECT_UNAUTHORIZED=false` remains the only way to skip cert verification (Supabase pooler). Localhost exempt. |
| **11. TRUST_PROXY / rate-limit identity** (`server/index.js:70-71`) | Default changed **1 → 0** (trust no proxy). A client can no longer rotate `X-Forwarded-For` to bypass the limiters when the app is directly exposed. `.env.example` documents the new default and when to raise it. |
| **12. Signup error leak** (`server/index.js:133-134`) | `services/auth.js` now tags only user-facing validation errors `expose:true`; the route echoes those verbatim and masks everything else with a generic `Unable to complete signup` (detail still logged server-side). `tests/test-auth-hardening.js` (10 assertions) pins the contract. |
| **13. `data/emergency.json` / `data/approval.json`** (`config/emergency.js`, `config/approval.js`) | Written with owner-only mode `0o600` (the files are gitignored runtime safety controls; a world-writable file made emergency-stop / approval-mode writable by any local user). Content validation on read is preserved. |

## 10. Findings assessed but intentionally NOT changed

Listed here for completeness, per the ordered remediation scope. Each was verified; changing
them was outside the instructed scope and would need a product decision.

| # | Finding | Assessment |
|---|---|---|
| 8 | Founder equivalence by numeric `user.id` (`services/identity.js:161`) | Verified (Tier 1 founder gate, server-side identity). Not changed — touching the founder derivation requires an explicit product directive and its own release. |
| 10 | Sequential intake IDs enumerable (`/start/thanks?id=N`) | Verified; intake rows carry no sensitive data. Low risk; not in scope. |
| 14 | `missions/increment` unbounded self-DoS (`server/index.js:220-223`) | A tenant can only decrement **its own** workspace quota (exhaustion, not privilege). Documented; not in scope. |
| §5 note | `config/approval.js` `automatic`/`simulation` modes bypass gates deliberately | Intentional, founder-controlled, audited — unchanged (per audit). |

## 11. Test results

| Phase | Results (observed) |
|---|---|
| Baseline | 79 / 79 suites |
| Phase 1 | MCP client (82) + mission→MCP gate (33); full suite green |
| Phase 2 | mission scheduler (66 assertions); full suite green (81/81) |
| Phase 3 | report access control (28 assertions); full suite green (81/81) |
| Phase 4 | execution contract added to test-mcp (82) / test-mcp-mission (33); treasurer dry-run hardened; full suite green (81/81) |
| Phase 5 | billing (75) + platform foundation (63); 016 migration added; full suite green (81/81) |
| Secondary | auth hardening (10); full suite green |
| **Final** | **82 suites: 82 passed, 0 failed** |

`node --check` passes on every changed file.

## 12. Files changed

**Source (verified fixes):** `services/mcp/policy.js` · `services/mcp/index.js` ·
`services/mcp/client.js` · `services/missionScheduler.js` · `server/index.js` ·
`services/billing/index.js` · `services/platform/entitlements/index.js` ·
`services/workforce/tools.js` · `services/auth.js` · `db/pool-config.js` · `db/tables.js` ·
`db/repos.js` · `config/emergency.js` · `config/approval.js`

**Schema:** `db/migrations/016_add_billing_webhook_events.sql` (new, forward-only)

**Config/docs:** `.env.example` (scheduler opt-in + TRUST_PROXY default + PGSSLMODE note)

**Tests:** new — `tests/test-mission-scheduler.js`, `tests/test-report-access.js`,
`tests/test-auth-hardening.js`; extended — `tests/test-mcp.js`, `tests/test-mcp-mission.js`,
`tests/test-billing.js`, `tests/test-platform-foundation.js`, `tests/test-treasurer.js`

**Install artifact (not remediation):** `package-lock.json` — one-line `engines` bump
(`>=18` → `>=20`) written by `npm install` at baseline setup on Node 24.

## 13. Security notes and human review required

**Deploy actions required before production:**
1. Apply migration `016_add_billing_webhook_events.sql` (via `npm run db:migrate`);
   the Postgres UNIQUE(event_id) guarantee exists only after it is applied.
2. Set `TRUST_PROXY` to the real hop count (e.g. `1` behind Cloudflare/nginx). With the new
   default of `0`, rate-limit identity behind a proxy collapses to the proxy IP until set.
3. Verify production Postgres TLS now engages by default: non-local URLs get `ssl` with cert
   verification on. `PG_REJECT_UNAUTHORIZED=false` is still honored (Supabase pooler) — keep
   it only if the pooler chain is trusted, and prefer dropping it when possible.

**Behavioral changes to review:**
- Workspaces with **no active subscription** (or `pending` status) are no longer considered
  licensed by the enterprise capability gate. Audit production workspaces that relied on the
  old lenient semantics.
- MCP built-in tools require an explicit operator allow-list at boot (deny by default).
- `MISSION_SCHEDULER_ENABLED` / `AUTO_OUTREACH_ENABLED` must be set to `'true'` explicitly to
  resume auto-outreach.

**Residual risk (unchanged, documented in §10):** findings 8, 10, 14; intentional approval
mode bypasses.

**Integrity:** `deliverables/NEVER_TOUCH_AUDIT.md` untouched. No commits were made; all changes
remain uncommitted on `security/controlled-remediation-2026-09`, awaiting the second-pass
follow-up review.