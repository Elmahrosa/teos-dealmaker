# TEOS DealMaker

**Status: FOUNDATION + 12 AGENTS (v0.1.0) — ~90% of roadmap**

**✅ IMPLEMENTED:**
- [Implemented v0.1.0] Outreach agent (draft → gatekeeper → vault)
- [Implemented v0.1.0] Qualification agent (classify/route, `QUALIFICATION_AGENT_*` audit)
- [Implemented v0.1.0] Sales agent (objection → response)
- [Implemented v0.1.0] Gatekeeper agent (spam/unsafe draft review, `GATEKEEPER_*` audit)
- [Implemented v0.1.0] Orchestrator agent (qualify → route: sales/follow-up/archive, `ORCHESTRATOR_*` audit; `/sales <prompt>` → draft → gatekeeper → route flow)
- [Implemented v0.1.0] Market Intelligence agent (prospect fit scoring + priority, `MARKET_INTELLIGENCE_*` audit)
- [Implemented v0.1.0] Prospecting agent (lead scoring/classification → next agent, `PROSPECTING_AGENT_*` audit)
- [Implemented v0.1.0] Strategist agent (tactical Deal Playbook from lead data, `STRATEGIST_AGENT_*` audit)
- [Implemented v0.1.0] Marketer agent (value positioning from playbook, `MARKETER_AGENT_*` audit)
- [Implemented v0.1.0] Negotiator agent (discount thresholds + payment terms, `NEGOTIATOR_AGENT_*` audit)
- [Implemented v0.1.0] Treasurer agent (contract drafting + DRY-only Dodo checkout via utils/dodoPayments.js, `TREASURER_AGENT_*` audit)
- [Implemented v0.1.0] Closing agent (readiness check → won/blocked, `CLOSING_AGENT_*` audit)
- [Implemented] BVAP audit logging (JSON to data/vault/audit.log)
- [Implemented] DRY/LIVE mode toggle (default DRY, founder-controlled; `agents/router.js` vaults in DRY, sends in LIVE)
- [Implemented] Telegram bot (@TeosEgypt_bot commands incl. `/sales <prompt>`; inline welcome menu with Features/Pricing/Demo/Affiliate/Contact/Docs panels)
- [Implemented] Postgres schema (db/schema.sql: deals + audit_trail with updated_at trigger; db/index.js pg pool, `npm run db:migrate`, needs `DATABASE_URL`)
- [Implemented] Dual-write audit mirror (flat file always; mirrors to audit_trail + syncVaultToDb() when `DATABASE_URL` is set)
- [Implemented] Sentinel dashboard (`npm run server` → landing page at http://localhost:3000 + dark-theme BVAP audit console at http://localhost:3000/dashboard; `/api/health`, `/api/audit`, `/api/pricing`)
- [Implemented] Marketing landing page (server-rendered at `/` from config/pricing.config.js — 12-agent court, feature cards, pricing tiers with Dodo checkout links)
- [Implemented] Dodo Payments stub (utils/dodoPayments.js, mocks payload when `DODO_API_KEY` missing)
- [Implemented] Shared pricing config (config/pricing.config.js — 6-tier source of truth: Solo Operator/Growth Team/Corporate × Monthly/Annual with Dodo checkout URLs + product IDs; served to web via `/api/pricing` and to the bot via `/pricing` and the Pricing menu panel)
- [Implemented] Master pipeline test (tests/final_pipeline.test.js: Strategist → Marketer → Negotiator → Treasurer → Closing)
- [Implemented] Multi-tenant persistence layer (Phase 1: db/schema.sql — workspaces/users/roles/subscriptions/deals/audit/agent_runs/provider_usage/conversations/pipeline_events, every tenant table scoped by `workspace_id`; db/adapter.js — Postgres + in-memory adapters; db/repos.js — tenant-scoped repositories + `forWorkspace()` factory; verified by tests/test-multitenancy.js)
- [Implemented] Bot design system + Control Center (bot/design.js components, bot/access.js role checks, bot/i18n.js EN/AR + settings persistence)

**❌ PENDING:**
- [Pending] Live Postgres verification (schema never migrated — no `DATABASE_URL` provided)
- [Pending] User account system wiring to Telegram identities
- [Pending] Real AI workforce orchestration on top of the persistence layer
- [Pending] Multi-provider LLM layer (Anthropic/OpenAI/etc.)
- [Pending] Real Dodo Payments integration (LIVE key)
- [Pending] Live checkout verification of the published pricing links (Solo $99/$950, Growth $249/$2,390, Corporate $799/$7,600 — links served from config/pricing.config.js, Dodo downstream unverified)
- [Pending] Automated test runner (npm test)

## Fallback structure

- Audit logging is dual-write: the flat file `data/vault/audit.log` is always written; when `DATABASE_URL` is set, entries mirror to the `audit_trail` Postgres table (Postgres failures are logged, never fatal). `syncVaultToDb()` backfills the file into Postgres on demand.
- Payments are DRY-first: `utils/dodoPayments.js` returns a mocked payload/URL unless a real `DODO_API_KEY` is present.
- Persistence is adapter-based: `db/adapter.js` provides a `pg` adapter (activates when `DATABASE_URL` is set) and an in-memory adapter used by the test suite. Repositories in `db/repos.js` always filter by `workspace_id`; `forWorkspace(adapter, workspaceId)` returns a pre-scoped handle so tenant isolation cannot be bypassed.

## Database (Phase 1)

- Schema: `db/schema.sql` (multi-tenant, forward-only, `CREATE TABLE IF NOT EXISTS`, updated_at triggers).
- Tables: workspaces, users, workspace_members (role RBAC), subscriptions, dodo_customers, deals, audit_trail, conversations, messages, agent_runs, provider_usage, pipeline_events.
- Isolation rule: every tenant-owned table carries `workspace_id`; all repository reads/writes filter by it, enforced by `forWorkspace()`.
- Verify locally: `node tests/test-multitenancy.js` (in-memory adapter, no DB required).
- Live: set `DATABASE_URL` then `npm run db:migrate`; adapter + repos then target Postgres.

## Known Issues

- npm audit: 9 vulnerabilities (node-telegram-bot-api deprecated deps)
  Fix: Future swap to grammy or raw fetch

## License

MIT - Elmahrosa International 2026
