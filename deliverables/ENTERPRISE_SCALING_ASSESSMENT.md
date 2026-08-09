# TEOS DealMaker — Enterprise Scaling Readiness Assessment

- **Date:** 2026-08-09
- **Scope:** Read-only assessment. No source code was modified (WORKTREE = CLEAN at `dca49a1`).
- **Method:** Four parallel evidence passes over `server/`, `bot/`, `db/`, `services/`, `docs/`, `deliverables/`, plus live production probes (`dealmaker.elmahrosa.org`). Every verdict cites `file:line`.
- **Constraint respected:** Customer #1 revenue mode is preserved. Nothing below is an instruction to execute; it is a prioritized plan awaiting founder approval item-by-item.

---

## 1. Executive summary

**Verdict: functionally solid for single-tenant-at-a-time SMB use, NOT yet enterprise-ready.** The platform has a genuinely strong foundation in three areas — application-layer tenant scoping, parameterized SQL, and a fail-closed billing/webhook path — but fails or is absent on every category an enterprise procurement team will probe in diligence: identity (no SSO/MFA/SCIM/RBAC-on-by-default), compliance evidence (no SOC 2 / ISO / GDPR tooling, overstated marketing claims), observability (no metrics/log shipping/tracing), reliability (single instance, no backups/DR, no deploy automation in-repo), and legal/contract artifacts (no MSA/DPA/SLA).

The existing self-assessment (`deliverables/ENTERPRISE_READINESS.md:7-58`) scored **7.0/10**; this assessment converges with that but is stricter: the honest score against a *real* enterprise buyer's checklist is **~3/10**, because the missing items are the ones procurement requires, not the ones already present.

**Highest-leverage truth:** a verified real paying Customer #1 (real Dodo payment → webhook → persisted subscription → entitlement → audit) is simultaneously (a) the most credible enterprise proof, and (b) the highest-value fix for the overclaim problem, because it lets marketing claims be replaced by verified evidence. See §4 P0-1 and §6.

---

## 2. What an enterprise buyer will check (the lens)

| # | Category | Typical requirement | Current state |
|---|----------|--------------------|---------------|
| E1 | Identity & access | SSO (SAML/OIDC), MFA, SCIM, per-tenant roles | **Absent** (§3.1) |
| E2 | Tenant isolation | Strong isolation, verifiable per-tenant data separation | **Partial** — app-layer only, no RLS (§3.2) |
| E3 | Security | Secure coding, least privilege, secrets hygiene | **Partial** — good SQLi/headers; CSP weak (§3.3) |
| E4 | Compliance | SOC 2 / ISO evidence, GDPR (export/delete/consent), audit immutability, retention | **Absent** (§3.3) |
| E5 | Reliability & HA | Uptime SLA, backups/DR, failover | **Absent** (§3.5) |
| E6 | Observability | Logs, metrics, alerts, tracing | **Absent** (§3.4) |
| E7 | Integration | Connectors, APIs, webhooks, documented contracts | **Partial** (§3.7) |
| E8 | Governance | Approval chains, audit, policy enforcement | **Partial** — exists but off by default (§3.3) |
| E9 | Commercial | MSA/DPA, SLA doc, invoicing, security questionnaire | **Absent** (§3.8) |
| E10 | Evidence honesty | Claims match reality | **Fails** — README overclaims (§3.8) |

---

## 3. Current state by pillar

### 3.1 Identity, authentication, RBAC — **ABSENT / INERT**

- Identity is Telegram-id only; users are created implicitly (`services/identity.js:41-54`), no email/password, no sessions, no MFA, no OTP (no auth dependency in `package.json:39-47`).
- **No SSO/SAML/OIDC/SCIM.** The only OAuth is an *outbound* integration connector OAuth (`services/integrations/oauth.js`), not platform login. No per-user API keys; the only keyed HTTP endpoint uses a single global `AUDIT_API_KEY` (`server/index.js:35-43`).
- **RBAC engine exists but is inert:** roles `viewer/analyst/operator/developer/admin/owner` and per-capability minimum roles are defined (`services/platform/authorization/index.js:8-30`), but only enforced at the MCP `executeCapability()` gate when `TEOS_ENTERPRISE=true` (`services/mcp/client.js:33-45`); `TEOS_ENTERPRISE` defaults to off (`.env.example:53-57`). Bot callbacks check `isFounder(userId)` with no role param (`bot/menu.js:186-234`, `bot/access.js:8-13`), so DB roles are dead weight in the bot.
- **Member management is dormant:** `identity.addMember` (`services/identity.js:144-147`) and `repos.members.*` exist but have no command/screen; no invite flow; **seat limits are defined (`services/platform/entitlements/plans.js:20-45`) but never enforced** — `checkSeats` is only exercised by tests (`tests/test-platform-foundation.js:61-72`).
- **Founder = env-id:** `TEOS_FOUNDER_TELEGRAM_ID` and `TELEGRAM_ADMIN_IDS` grant founder-equivalence (`bot/access.js:8-13`); any admin id is a total bypass of billing/entitlement gates (`CHANGELOG.md:34`).

### 3.2 Multi-tenancy & isolation — **STRONG FOUNDATION, TWO LEAK SURFACES**

**Strengths (verified by tests):**
- Every tenant repo keys on `workspace_id` (`db/repos.js:76-93`, etc.); a `forWorkspace(adapter, workspaceId)` factory forces the scope into every call (`db/repos.js:387-519`); the workforce layer uses it consistently (`services/workforce/runtime.js:20-22`).
- Cross-tenant get/update return null (`tests/test-multitenancy.js:34-58`); composite indexes on `workspace_id` across all tenant tables (`db/schema.sql`).

**Gaps:**
- **No row-level security, no per-tenant schema, no encryption at rest.** Isolation is by convention only (`db/schema.sql` has no RLS/policies; only crypto is audit-hash + webhook HMAC).
- **Unauthenticated enumerable report endpoint:** `GET /report/:planId` resolves a plan by global sequential id with no auth (`server/index.js:242-257`; `services/missionReport.js:36-40`) — cross-tenant plan enumeration.
- **Unscoped repos exist:** `repos.workspaces.list()` and `repos.subscriptions.list()` return all tenants (`db/repos.js:10-11,58-59`); `users` is a global table with no workspace column (`db/schema.sql:5-12`); founder ops read all tenants by design (`bot/screens/founder.js:19-32`, founder-gated).
- `identity.getWorkspaceForUser` returns the *first* membership for multi-workspace users — no workspace switcher (`services/identity.js:60-75`).

### 3.3 Security & compliance — **MIXED; COMPLIANCE EVIDENCE ABSENT**

**Present and good:**
- Parameterized SQL with column whitelisting (`db/adapter.js:31-38,73-138`); SSL `rejectUnauthorized` on by default (`db/pool-config.js:4-16`).
- Security headers: HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy (`server/index.js:80-90`); rate limits 120/min API, 30/min webhook (`server/index.js:18-30`).
- Webhook HMAC verification is fail-closed and timing-safe (`services/billing/index.js:28-38`; `server/index.js:154-162`).
- Audit trail is hash-chained (SHA-256 over previous entry) with fail-closed API access (`utils/auditLogger.js:20-35,71-86`; `server/index.js:35-43`).
- Secrets are env-only; `.gitignore`/`.railwayignore` exclude `.env` and `data/`; no committed secrets found.

**Gaps:**
- **CSP uses `'unsafe-inline'`** for scripts and styles (`server/index.js:45-62`) — no nonce/hash; weaker than modern requirement.
- **Webhook has no replay protection** (no timestamp/nonce/idempotency) — a replayed signed event re-applies state (`services/billing/index.js:81-152`).
- **Audit vault is not immutable:** `clearVault` exists (`utils/auditLogger.js:170-174`), write-protection unenforced, admin UI still ships "Clear audit log" strings (`bot/i18n.js:178`) — contradicts the "immutable audit trail" claim on the landing page (`server/landing.html:235,327`).
- **No retention policy** for the vault or DB — grows unbounded; `verifyVault` chain-verifier is never wired into any production path (`utils/auditLogger.js:90-114`).
- **PII logged in plaintext:** `BOT_TEXT` records full raw user messages into the vault (`bot/handlers.js:254`).
- **GDPR is absent:** no data export, no deletion/erasure flow, no consent capture, no retention schedule. README claims "GDPR/CCPA compliance tooling" (`README.md:320`) are unimplemented (roadmap TODO at `deliverables/ROADMAP.md:50-52`).
- **No encryption-at-rest evidence for PII** (`deliverables/ENTERPRISE_READINESS.md:58`).
- `/api/diagnostics` is unauthenticated and reveals DB latency + router errors (`server/index.js:114-145`); `/api/health` leaks audit entry count (`server/index.js:101-112`).
- `RESEND_API_KEY` is consumed by `services/notify.js:24` but **missing from `.env.example`** (documentation drift).

### 3.4 Observability — **ABSENT**

- Dependencies contain no logging/metrics/tracing stack (`package.json:39-47`); 100+ raw `console.*` calls; no request logging middleware, no structured logs, no correlation ids, no `/metrics`, no log shipping (`deliverables/TECHNICAL_DEBT.md:27-34`).
- Audit vault lives on **ephemeral container disk** (`data/` gitignored, `.railwayignore:5`) — lost on redeploy, per-instance only (`server/index.js` health `totalEntries` reads the local file, `utils/auditLogger.js:160-168`).

### 3.5 Reliability & scalability — **SINGLE-INSTANCE BY DESIGN**

- **Single consumer:** Telegram long-polling `bot.startPolling()` (`bot/index.js:100`); one poller per token; multiple instances fight. Duplicate poller was already removed (`PRODUCTION_VERIFICATION_REPORT.md:48-50`).
- **Per-process in-memory state** prevents horizontal scaling: mission wizard, onboarding, learning sessions, router sessions, mission registry, event bus, mode/approval module flags (`bot/missionState.js:1`, `bot/onboarding.js:9`, `bot/learning.js:4`, `services/router/memory.js:11`, `services/mission-controller/state.js:28-29`, `services/workforce/events.js:20`).
- **File-backed state on ephemeral disk:** feature flags, emergency stop, approval mode, language prefs, audit vault (`config/flags.js:5`, `config/emergency.js:5`, `config/approval.js:13`, `bot/i18n.js:5`, `utils/auditLogger.js:5`).
- **Rate limits use the in-memory store** — N instances = N× effective limit (`server/index.js:18-30`).
- **Concurrency limits are not enforced:** dispatcher defines per-agent concurrency (`services/workforce/dispatcher.js:89-107`) but runtime runs ready steps with `Promise.all` un-capped (`services/workforce/runtime.js:91`); the executor never applies the value.
- **No queue backend** — DB-backed deal-stage queue only (`services/queue.js:3-54`); documented residual debt (`PRODUCTION_VERIFICATION_REPORT.md:39`).
- **No backups/DR:** no `pg_dump`/restore scripts, no retention, single region (EU West), no CDN/edge, no DR runbook (`README.md:291` lists backups as future).

### 3.6 Deployment & CI/CD — **PARTIAL, NO RELEASE PIPELINE IN-REPO**

- Railway auto-deploy from `main` via GitHub integration; **no deploy workflow exists** in `.github/workflows/` (only `ci.yml` + `test-treasurer.yml`, both test/lint only).
- Build = syntax gate only (`package.json:17`, `scripts/check-syntax.js`); no bundle/container (`deliverables/TECHNICAL_DEBT.md:22-25`).
- Custom supervisor (`scripts/prod.js:14-17`) spawns web + bot children; a crash-looping child is not killed.
- **Migrations not applied by a runner:** `npm run db:migrate` runs only `db/schema.sql` (`db/index.js:31-34`); `db/migrations/001-003` are never applied. **Latent break:** `003_deal_simulation.sql` tables (`deal_scenarios`, `simulation_runs`) are absent from `db/schema.sql` — a fresh Postgres deploy breaks the deal-simulation feature (works on memory adapter only).
- **Live-DB test suites are not run in CI** (skipped without `DATABASE_URL`) — `deliverables/REPOSITORY_AUDIT.md:34`.

### 3.7 Integrations & extensibility — **GOOD PLATFORM, THIN CATALOG**

- Plugin platform is solid: manifest validation, versioned, failure-isolated, deny-on-disable (`services/plugin-manager/loader.js:44-107,295-324`; `docs/PLUGIN_CONTRACT.md:210-219`). Two first-party plugins auto-load: civic-mixer, sentinel (`plugins/*/manifest.json`).
- **MCP is disabled by default** (`services/mcp/client.js:1-3`); all tool calls simulate no-ops without `MCP_ENABLED=true` (`docs/MCP_ARCHITECTURE.md:49-50`).
- **"17+ connectors" claim is aspirational:** `services/integrations/catalog.js:10-100` lists 17 connector configs, but connectors need per-workspace enable + env keys (`services/integrations/manager.js:32-45`); the "pre-built Salesforce/HubSpot/M365/Google" claim (`README.md:187-188`) is contradicted by `docs/PLUGIN_CONTRACT.md:258` (future candidates).
- **No plugin signing** — a valid manifest runs arbitrary code with full Node privileges (`deliverables/TECHNICAL_DEBT.md:7-10`).

### 3.8 Commercial, legal & GTM — **PRICING DONE, ARTIFACTS MISSING, CLAIMS OVERSTATED**

- Pricing fixed: Solo $99/$950 · Growth $299/$2,990 · Business $999/$9,990 · Enterprise custom (`LAUNCH_CHECKLIST.md:19`). Trial/free plans deliberately removed; workspaces default to `solo` (`CHANGELOG.md:33`).
- **No contract artifacts:** no MSA/DPA, no SLA document, no reseller terms, no security-questionnaire answer pack (`README.md:394`, proprietary license).
- **README enterprise claims outstrip evidence** (`README.md:314-334`): "SOC 2 Type II and ISO 27001 ready architecture", "GDPR/CCPA compliance tooling", "Regular third-party penetration testing", "99.9% uptime SLA with multi-zone", "Automated failover and disaster recovery", "Docker/Kubernetes-ready" — none backed by repo artifacts, several contradicted by the roadmap (`deliverables/ROADMAP.md:50-69`) and single-node reality.
- **"Mission-as-a-Trial" copy/code mismatch:** landing flow marked PASS (`LAUNCH_CHECKLIST.md:17`) while the code has no trial feature (`PRODUCTION_VERIFICATION_REPORT.md:86` — trials deliberately removed v1.0.2).
- Plan-name drift: billing uses `corporate` (`REVENUE_PATH_AUDIT.md:148`), marketing uses `Business`.

---

## 4. Prioritized plan

### P0 — Prepare for enterprise conversations (weeks; low-risk; mostly config/docs/tests/defensive)

1. **Fix claim honesty (compliance risk, immediate).** Remove/qualify README overclaims (SOC 2/ISO/GDPR/pentest/99.9%/DR/K8s/Docker) to the Trust Center standard (`PRODUCTION_VERIFICATION_REPORT.md:22`). Reconcile the Mission-as-a-Trial copy (`server/landing.html:151-164,300-315`) with the no-trial reality — rename the flow to what it is ("one real revenue mission") or implement a real gated free mission. Both are foundational for any buyer diligence.
2. **Close the enumerated report surface.** `/report/:planId` uses sequential ids with no auth (`server/index.js:242-257`) — switch to unguessable ids or add tenant resolution; it exists today only for the founder workspace.
3. **Make existing enforcement real.** Turn `TEOS_ENTERPRISE` on after test coverage, so seat/agent/capability/RBAC gates (`services/platform/entitlements/index.js:72-160`) stop being dead code; enforce `checkSeats` on onboarding/member-add.
4. **Harden the audit path.** Wire `verifyVault` into an ops command; add vault/DB retention; stop logging full `BOT_TEXT` (`bot/handlers.js:254`) — log a redacted/truncated summary.
5. **Add webhook replay protection** (timestamp + nonce/idempotency) to `services/billing` — enterprise-relevant payment integrity.
6. **Fix the fresh-install DB break.** Add `deal_scenarios`/`simulation_runs` to `db/schema.sql` and apply `db/migrations/001-003`; add a migrations runner.
7. **Config hygiene.** Add `RESEND_API_KEY` and `DODO_*` to `.env.example`; extend founder ops screen to reflect `DODO_API_KEY`/`DODO_WEBHOOK_SECRET` presence (read-only) — today it only checks `DODO_STARTER_MONTHLY_URL` (`bot/screens/founder.js:265`).
8. **Add a deploy workflow** (GitHub Actions → Railway) with a gated promote + documented rollback, so releases are reproducible instead of push-to-main auto-deploy.
9. **Complete Customer #1 revenue proof.** Verify a real Dodo payment → webhook → persisted subscription/entitlement/audit (founder-approved, after the two Dodo secrets are confirmed configured). This is the single strongest enterprise artifact.

### P1 — Enterprise beta (quarter(s))

1. **Identity:** OIDC/SAML SSO via a managed provider, MFA, SCIM provisioning; email-based login as a second factor.
2. **RBAC productized:** surface roles in bot/console, member invite/management, seat enforcement, workspace switcher for multi-workspace users (`services/identity.js:60-75`).
3. **Observability:** structured logging (pino/winston), request logging, `/metrics` (prom-client), log shipping; move vault/flags/prefs to DB so they survive redeploy.
4. **Backups/DR:** automated `pg_dump` + retention + restore runbook; verify Supabase PITR; document RPO/RTO honestly.
5. **Containerization + live-DB CI:** Dockerfile/compose; run DB suites against a `DATABASE_URL` secret in CI.
6. **OpenAPI spec** for the HTTP surface (`deliverables/TECHNICAL_DEBT.md:17-20`).
7. **GDPR tooling:** per-workspace data export + deletion, consent capture, retention schedule.
8. **Commercial pack:** MSA + DPA templates, security-questionnaire answers (based on verified facts only), SLA document aligned to actual architecture (single-node today — do not commit 99.9%).

### P2 — Enterprise production scale

1. **Queue + shared state:** Redis-based queue replacing in-process mission/event state; shared rate-limit store; move flags/emergency/approval/prefs to DB (multi-instance safe).
2. **Telegram webhook mode or single-leader lock** for polling; enforce dispatcher concurrency values in the executor (`services/workforce/runtime.js:91`).
3. **Encryption at rest** for PII columns (application-level or provider AES).
4. **Plugin signing / sandboxing** (`deliverables/TECHNICAL_DEBT.md:7-10`).
5. **Multi-region + DR** with real leader/read replicas, CDN/edge for static assets; then and only then offer an SLA ≥ 99.9%.

### P3 — Full enterprise suite

- Real SOC 2 Type II / ISO 27001 program with attestation artifacts.
- Per-tenant data residency controls.
- Plugin marketplace with signed distribution.

---

## 5. Documentation contradictions to reconcile (all in P0-1)

| Contradiction | Where |
|---|---|
| "SOC 2/ISO ready", "GDPR tooling", "99.9% SLA", "DR", "Docker/K8s" vs. roadmap + single-node reality | `README.md:314-334` vs `deliverables/ROADMAP.md:50-69`, `deliverables/TECHNICAL_DEBT.md:22-25`, `deliverables/ENTERPRISE_READINESS.md:25-26` |
| "Mission-as-a-Trial" PASS vs "no trial feature in code" (D6) | `LAUNCH_CHECKLIST.md:17`, `PRODUCTION_VERIFICATION_REPORT.md:24` vs `:86` |
| "17+ pre-built connectors (Salesforce/HubSpot/M365)" vs only 2 plugins, connectors = future | `README.md:187-188`, `HOW_IT_WORKS.md:35` vs `docs/PLUGIN_CONTRACT.md:258` |
| "Immutable audit trail" vs `clearVault` + "Clear audit log" UI | `server/landing.html:235,327` vs `utils/auditLogger.js:170-174`, `bot/i18n.js:178` |
| Dodo credentials MISSING vs PRESENT in prod | `STATUS_SUMMARY.md:16-19` vs `RAILWAY_RESTORATION_REPORT.md:23` (reconcile: DODO_API_KEY/DODO_WEBHOOK_SECRET still unverified in prod as of 2026-08-09) |
| Plan naming `corporate` vs `Business` | `REVENUE_PATH_AUDIT.md:148` vs `LAUNCH_CHECKLIST.md:19` |

---

## 6. Bottom line

1. **The platform is not enterprise-ready today** against a procurement checklist, but the data-scoping and security foundations are real and verifiable — that is a defensible starting point.
2. **Do not ship P1/P2/P3 now.** They conflict with Customer #1 revenue mode. P0 is the only bucket that is safe, incremental, and directly raises enterprise credibility — but each P0 item still needs founder approval before implementation.
3. **The fastest path to enterprise credibility is Customer #1:** a verified real payment proves the revenue path, replaces marketing claims with evidence, and generates the reference case that BI-Technologies-class buyers actually ask for.
4. **Until then, marketing must not outrun the code.** Every overstated claim is a diligence liability and a legal one.
