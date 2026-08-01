# TEOS DealMaker

**Status: FOUNDATION + 12 AGENTS + MULTI-TENANT PERSISTENCE + WORKSPACE IDENTITY + PROACTIVE DASHBOARD + AI WORKFORCE RUNTIME + WORKSPACE MEMORY + AGENT COLLABORATION + WORKFORCE CONSOLE + MULTI-PROVIDER AI LAYER + COST INTELLIGENCE + AGENT HEALTH + QUEUE MANAGER + EXECUTIVE BRIEFING + ENTERPRISE INTELLIGENCE LAYER (v0.6.0)**

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
- [Implemented] Real workspace identity + onboarding (Phase 2: services/identity.js — Telegram User → Authenticated User → Workspace Member → Workspace → Subscription → AI Workforce; bot/onboarding.js self-service wizard `/start`/`/setup`: company name → language → plan → auto-provisioned 12 agents + workspace settings + audit stream + pending subscription; bot/store.js adapter selection; extended schema with `users.telegram_id UNIQUE`, `workspaces.owner_user_id`/`subscription_id`, `audit_trail.user_id`, `agents` + `workspace_settings` tables; verified by tests/test-identity.js)
- [Implemented] Bot free-text routing into onboarding (active wizard consumes typed company name; `/setup` re-enters onboarding or opens Control Center for provisioned workspaces)
- [Implemented] Workspace dashboard (Phase 3: after onboarding, Control Center home renders the live workspace — Welcome <company>, plan, members, agents active, revenue pipeline (open/closed), subscription status (Trialing/Active); new AI Guide + Settings panels; Settings shows workspace config and persists EN/AR language choice to both prefs and `workspace_settings`; aggregated via services/workspace.js `getWorkspaceContext`, verified by tests/test-workspace.js)
- [Implemented] Proactive dashboard (greeting by name + time-of-day, Today's AI Activity — agents ready/active deals/outreach dispatches/health, Next Recommendation, Today You Can checklist with setup ETA; coming-soon handlers for CRM/catalog/campaigns)
- [Implemented] AI Workforce runtime (Phase 4: services/workforce.js — agent registry with friendly labels + roles + cadence, `runAgent` wraps any agent execution: records agent_runs (status/duration/cost/output), updates agent runtime state (total_runs/total_cost_cents/last_run_at/next_run_at/provider/model/status), surfaces errors and recovers to ready; `runPipelineDemo` executes the 5-stage pipeline through the runtime and persists a deal + pipeline events; workforce screens — AI Workforce (per-agent Ready/Working/Waiting status), Today's Activity feed (per-agent runs today + latest outcome), per-agent detail panel (status/runs/last/next/provider/cost); schema extended (agents runtime columns + forward-only ALTERs); verified by tests/test-workforce.js)
- [Implemented] Workspace Memory (Phase 5: services/memory.js — shared memory every agent reads before working: company, industry, products, services, ICP, competitors, brand voice, sales playbook, languages, documents, preferred providers, plus a `past_deals` aggregate from the deals repo; per-agent context slices via CONTEXT_MAP so each agent only receives the keys it needs; `ensureDefaults` seeds the 11 memory keys on workspace provision; memory editor in Settings (view/edit via `cc_memory`/`cc_mem_edit:<key>` callbacks and `/memory`); schema `workspace_memory` table (UNIQUE workspace_id+key, JSONB values); verified by tests/test-memory.js)
- [Implemented] Agent Collaboration (Phase 5.5: agents hand off work by writing notes to the deal — `deal_notes` table (workspace_id, deal_id, agent_name, note); `runPipelineDemo` produces a visible team chain Strategist → Marketer → Negotiator → Treasurer → Closing with each agent's note surfaced in the pipeline result TEAM NOTES panel; verified in tests/test-workforce.js)
- [Implemented] Workforce Console + visibility layer (services/workforce.js aggregates — `workforceConsole` (workers busy/ready, today's cost, completed tasks, estimated pipeline from open deals, per-agent live status Running/Completed/Waiting/Ready), `dealTimeline` (per-deal collaboration chain with timestamps + stage transitions), `costSummary` (today's cost by provider + total + avg per task), `healthCheck` (AI Providers/Database/Payments/Audit/Memory/Workers 12/12); Control Center screens — AI Workforce console header + live roster, Deal Timeline (all deals + per-deal deep view), AI Cost Dashboard, Platform Health; latest-run resolution tie-broken by run id (same-millisecond safety); verified by tests/test-console.js)
- [Implemented] Multi-provider AI layer (v0.5.0: services/providers.js — 8-provider catalog (OpenAI/Anthropic/Gemini/Groq/OpenRouter/NVIDIA NIM/Ollama/LM Studio) with per-model pricing, DEFAULT_POLICY routing for all 12 agents (e.g. prospector → Gemini Flash, researcher → Claude Sonnet, negotiator → GPT-5, gatekeeper → Groq Llama-3.1), FALLBACK_CHAIN across providers, `resolveRoute` policy → configured → fallback → simulated, seeded deterministic `simulate` + real HTTP `realCall` (OpenAI/Anthropic/Gemini payload shapes + usage token extraction), `costFromTokens` from per-model pricing, usage recorded to `provider_usage`; no keys → simulated runs at $0.00; verified by tests/test-providers.js)
- [Implemented] Provider policies (db `provider_policies` table — workspace-scoped agent → provider/model overrides with `UNIQUE(workspace_id, agent_type)`; seeded via `providers.ensurePolicies` on workspace provision; editable from the Providers screen (`/providers`, `cc_pol:<agent>` → `cc_pol_set:<agent>:<provider>`))
- [Implemented] Cost intelligence (services/cost.js `costIntelligence` — today's cost/tokens/tasks, avg cost per task, avg runtime, spend by provider/agent/deal (agent labels from REGISTRY, deal company names joined), estimated monthly spend from average daily cost; Cost Intelligence screen at `/costs`)
- [Implemented] Agent health (services/workforce.js `agentHealth` — per-agent Ready/Busy/Failed/Disabled from runtime status + latest run, avg runtime, success %, last success/error timestamps; Platform Health screen now includes the full 12-agent health roster)
- [Implemented] Queue manager (services/queue.js — 7-stage deal queue incoming → research → qualification → proposal → negotiation → closing → won; `enqueueDeal`/`advanceQueue` (closes deal on `won`)/`queueSnapshot`/`queueMovements`; `runPipelineDemo` now walks the queue and closes won deals; Deal Queue screen at `/queue` with stage counts + live movement feed)
- [Implemented] Executive briefing (services/briefing.js `executiveBriefing` — yesterday prospects/qualified/emails/proposals, today's opportunities, open pipeline value, meetings needed, 20% revenue forecast, high-risk deals stalled >14 days, recommended action; Executive Briefing screen at `/briefing`)
- [Implemented] LLM-driven agent runs (`runAgent` now accepts a `prompt` — executed through the provider layer via `providers.generate` — alongside the deterministic `fn` path; runs carry `deal_id` and record provider/model into `agent_runs`; audited as `AGENT_RUN_*` with provider/model/cost/deal_id)
- [Implemented] Enterprise Intelligence Layer (v0.6.0: services/intelligence.js — multi-source knowledge the workforce answers from: company profile, products & services, pricing, FAQs, playbooks, CRM data, website, email templates, previous proposals, sales conversations, competitor profiles, customer personas, uploaded documents; sources stored in the `knowledge_documents` table (workspace-scoped, chunked, metadata-tagged); `seedSources` re-syncs profile sources from workspace memory idempotently on provision)
- [Implemented] Semantic-style retrieval (TF-IDF token scoring with document-frequency weighting + intent-aware source boosts; `retrieve(query, topK)` returns ranked knowledge chunks with scores and source labels)
- [Implemented] Enterprise copilot (`ask(question)` — detects intent (pricing/product fit/proposal/objections/competitor/persona/FAQ), retrieves evidence, and answers via the LLM when a provider key is configured (RAG prompt with cited sources) or synthesizes an evidence-based answer offline; `/ask <question>` command + Ask the AI flow)
- [Implemented] Agent knowledge grounding (agents run with retrieved company knowledge appended to their prompts via `intelligencePrompt`; `getAgentContext` returns per-agent memory + relevant knowledge chunks)
- [Implemented] Renamed product surface: "Workspace Memory" → **Company Intelligence** (Settings, AI Guide, memory editor, new Intelligence hub `/intelligence`, Documents `/documents`, Add Knowledge flow with source-type picker, Ask the AI)
- [Implemented] Intelligence copilot policy (13th routing policy `intelligence` → openai/gpt-4o-mini for cheap RAG answers, editable from the Providers screen)

**❌ PENDING:**
- [Pending] Live Postgres verification (schema never migrated — no `DATABASE_URL` provided; pending: `agent_runs.deal_id` ALTER + `provider_policies` + `knowledge_documents` tables on real PG/Supabase)
- [Pending] Document upload parsing (PDF/DOCX/CSV ingestion into the intelligence layer — paste-based text input works today; binary parsing libs not yet installed)
- [Pending] Website crawl + CRM/email/calendar imports as intelligence sources (scheduled for the v0.7 integration phase)
- [Pending] Subscription activation wiring (onboarding creates pending subscription; checkout/payment activation is next)
- [Pending] Real multi-provider live calls (provider layer ships with seeded simulation; set any provider API key to go live)
- [Pending] Real Dodo Payments integration (LIVE key)
- [Pending] Live checkout verification of the published pricing links (Solo $99/$950, Growth $249/$2,390, Corporate $799/$7,600 — links served from config/pricing.config.js, Dodo downstream unverified)
- [Pending] Automated test runner (npm test)

## Fallback structure

- Audit logging is dual-write: the flat file `data/vault/audit.log` is always written; when `DATABASE_URL` is set, entries mirror to the `audit_trail` Postgres table (Postgres failures are logged, never fatal). `syncVaultToDb()` backfills the file into Postgres on demand.
- Payments are DRY-first: `utils/dodoPayments.js` returns a mocked payload/URL unless a real `DODO_API_KEY` is present.
- Persistence is adapter-based: `db/adapter.js` provides a `pg` adapter (activates when `DATABASE_URL` is set) and an in-memory adapter used by the test suite. Repositories in `db/repos.js` always filter by `workspace_id`; `forWorkspace(adapter, workspaceId)` returns a pre-scoped handle so tenant isolation cannot be bypassed. `bot/store.js` picks the adapter at runtime: Postgres when `DATABASE_URL` is set, otherwise in-memory (ephemeral — data resets on restart, surfaced to the user during onboarding).
- Onboarding: `/start` or `/setup` on the bot opens the self-service wizard (company name → language → plan). On completion the workspace is created and provisioned: owner membership, pending subscription linked to the workspace, 12 default agents, workspace settings, and a provisioning audit event. Without `DATABASE_URL` all of it runs on the in-memory adapter.

## Database (Phase 1 + Phase 2)

- Schema: `db/schema.sql` (multi-tenant, forward-only, `CREATE TABLE IF NOT EXISTS`, updated_at triggers).
- Tables: workspaces (owner_user_id, subscription_id), users (telegram_id UNIQUE), workspace_members (role RBAC), subscriptions, dodo_customers, deals, audit_trail (user_id), conversations, messages, agent_runs (incl. deal_id), provider_usage, pipeline_events, provider_policies (workspace agent routing), agents (provisioned workforce), workspace_settings (lang/timezone/notifications/theme), workspace_memory (key/value JSONB), deal_notes (agent collaboration hand-offs), knowledge_documents (Enterprise Intelligence sources: title/source_type/content/metadata, workspace-scoped).
- Isolation rule: every tenant-owned table carries `workspace_id`; all repository reads/writes filter by it, enforced by `forWorkspace()`.
- Identity flow: `services/identity.js` — `ensureUser` (telegram_id → user), `getWorkspaceForUser` (user → member → workspace), `onboardWorkspace` (transactional: workspace + owner membership + pending subscription + provision), `uniqueSlug` (collision-safe slug).
- Verify locally: `node tests/test-multitenancy.js` and `node tests/test-identity.js` and `node tests/test-workspace.js` and `node tests/test-workforce.js` and `node tests/test-memory.js` and `node tests/test-console.js` and `node tests/test-providers.js` and `node tests/test-operations.js` and `node tests/test-intelligence.js` (in-memory adapter, no DB required).
- Live: set `DATABASE_URL` then `npm run db:migrate`; adapter + repos then target Postgres.

## Known Issues

- npm audit: 9 vulnerabilities (node-telegram-bot-api deprecated deps)
  Fix: Future swap to grammy or raw fetch

## License

MIT - Elmahrosa International 2026
