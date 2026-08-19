# TEOS DEALMAKER

> **Enterprise AI Revenue Operating System** — a policy-governed AI workforce platform that orchestrates the complete revenue lifecycle (prospect → close) through 12 specialized AI agents, an extensible plugin platform, and enterprise governance.

[![Status](https://img.shields.io/badge/status-v1.1.0-blue)](#versioning--release-notes)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-green)](#prerequisites)
[![License](https://img.shields.io/badge/license-Proprietary-lightgrey)](#license)
[![EU AI Act](https://img.shields.io/badge/EU%20AI%20Act-Transparent-success)](#eu-ai-act-transparency)

---

## Contents

- [What is TEOS DealMaker?](#what-is-teos-dealmaker)
- [Why it exists](#why-it-exists)
- [Governance commitment](#governance-commitment)
- [The 14 agents](#the-14-agents)
- [Key capabilities](#key-capabilities)
- [Mission Center, Playground, Dashboard](#mission-center-playground-dashboard)
- [API reference](#api-reference)
- [**How it works**](#how-it-works) ← the technical deep-dive
- [Configuration](#configuration)
- [Plugin Platform](#plugin-platform)
- [TEOS Sentinel Shield](#teos-sentinel-shield)
- [Deployment](#deployment)
- [Enterprise readiness](#enterprise-readiness)
- [Customization & extension](#customization--extension)
- [Versioning & release notes](#versioning--release-notes)
- [EU AI Act transparency](#eu-ai-act-transparency)
- [License](#license)
- [Support](#support)

---

## What is TEOS DealMaker?

TEOS DealMaker is a **Revenue Operating System** — a coordinated fleet of 14 specialized AI agents that run a complete revenue motion (prospect → qualify → engage → negotiate → close) under a single policy-governed runtime, with human-in-the-loop approval at every critical step.

It is **not a chatbot**. It is not a CRM. It is the orchestration layer that sits above a CRM and beneath a governance boundary, replacing the "Siri-for-sales" pattern with a workforce model: each agent has a defined role, scope, inputs, outputs, and policy envelope. Missions flow through the system as ordered, auditable plans; every capability invocation passes through a deny-wins policy gate before any external side effect.

If you want the elevator pitch: **"A 12-agent sales org plus the governance plumbing to run it on policy, not on coffee."**

---

## Why it exists

The default market options for AI in revenue are point solutions — a single agent that drafts emails, a single agent that scores leads, a single agent that does account research. They don't share context, they don't coordinate, and they don't have a consistent governance model. The result is a fragmented stack that an enterprise security team can't approve, a CFO can't forecast against, and a RevOps lead can't trust.

TEOS DealMaker is the platform answer to that fragmentation:

| Problem | Point-solution answer | TEOS DealMaker answer |
|---|---|---|
| Multiple agents, no coordination | Glue code per integration | Shared mission state, ordered plans, agent handoffs |
| Audit & compliance | Per-vendor logs, no chain | Hash-chained audit trail, deny-wins policy gate |
| Adding a new capability | Fork the vendor | Plugin + manifest, zero core changes |
| Multi-tenant SaaS | Bolt on later | `workspace_id` scoping from day one |
| AI vendor lock-in | One provider | Pluggable providers with automatic fallback |
| Human oversight | Out-of-band (Slack) | First-class approval gates in the mission lifecycle |

---

## Governance commitment

> **Policy-governed AI that operates under enterprise governance, not outside it.**

The platform enforces five rules. Every capability invocation passes through the same 7-check gate (see [§ Governance gate](#94-governance-gate-executecapability) for the full flow), in this order of precedence:

1. **Deny-wins within the gate.** The first check that fails short-circuits with a specific deny reason (e.g. `tenant_inactive`, `insufficient_role`, `policy.reason`). There is no "warn and continue" at the gate level — a deny is a deny.
2. **Authorization & RBAC.** When `TEOS_ENTERPRISE=true`, actions are scoped to tenant role and plan entitlement. The founder role (`TEOS_FOUNDER_TELEGRAM_ID`) is a permanent bypass of the six enterprise sub-checks (but not the rest of the gate).
3. **Approval workflows.** Mission-critical steps (external send, payment request, contract draft) require explicit human approval through the Mission Center. No silent execution.
4. **Hash-chained audit trail.** Every decision, allowance, and denial is recorded in a tamper-detectable, hash-chained log under `/api/audit`. Hash chain breaks surface as a governance incident, not a silent failure.
5. **Human-in-the-loop at every critical juncture.** AI prepares the decision; humans ratify it. Reversible actions can be auto-approved per policy; irreversible actions always require an explicit gate.

For non-engineers: the platform is **designed to be auditable by your security team and provable to your auditors** without trusting the AI vendor. For engineers: see [§ Governance gate](#94-governance-gate-executecapability).

---

## The 14 agents

The platform ships with **14 agent modules under `agents/`**: 12 production agent directories + 2 loose infrastructure files. The production 12 are the user-facing roles operators interact with through the Mission Center. The infrastructure 2 are part of the platform plumbing, not the "13-agent sales org" you see in marketing.

The "How it works" section explains the dispatch model; this table is the roster.

| Agent | Path | Role | Test status |
|---|---|---|---|
| **Prospector** | `agents/prospecting/` | Lead discovery and fit scoring | ⚠️ no dedicated test script |
| **Researcher** | `agents/marketIntelligence/` | Market intelligence, competitor analysis, fit score | ⚠️ no dedicated test script |
| **Qualifier** | `agents/qualification/` | BANT/MedPICC lead qualification | ✅ `test:qualify` |
| **Revenue Strategist** | `agents/revenueStrategist/` | Revenue strategy, monetization, pricing architecture | ⚠️ no dedicated test script |
| **Strategist** | `agents/strategist/` | Tactical deal playbooks | ✅ `test:strategist` |
| **Marketer** | `agents/marketer/` | Value proposition, positioning, messaging | ✅ `test:marketer` |
| **Sales** | `agents/sales/` | Objection handling, response drafting | ✅ `test:sales` |
| **Negotiator** | `agents/negotiator/` | Pricing, discount, payment terms | ✅ `test:negotiator` |
| **Treasurer** | `agents/treasurer/` | Contract drafting, payment requests (always require human approval) | ✅ `test:treasurer` |
| **Gatekeeper** | `agents/gatekeeper/` | Safety/compliance review of all outbound comms | ⚠️ no dedicated test script |
| **Orchestrator** | `agents/orchestrator/` | Workflow coordination, agent handoffs | ⚠️ no dedicated test script |
| **Closing** | `agents/closing/` | Commitment verification, won/lost management | ✅ `test:closing` |
| **Outbound** | `agents/outreach/` | 24/7 governed outreach worker (founder-controlled) | ✅ `test:outreach` |
| **Intelligence** | `agents/marketIntelligence.js` (loose file) + `services/intelligence/` | Knowledge assistant — RAG over company docs | ✅ `test:intelligence` |

**Internal infrastructure (not part of the user-facing agent count):**
- `agents/router.js` (loose file, 28 lines) — DRY/LIVE dispatcher. Vaults messages in DRY mode, sends in LIVE mode. Audited.
- `services/router/` — **the NLP intent router**. Every plain-text user message (Telegram or web) passes through it (`bot/handlers.js:261`). It has no UI screen — it is the implicit message handler that classifies intent and dispatches to the right agent. Mention it here because "router" is easy to confuse with `agents/router.js`; they are different things.

> **Naming note:** the table above is the canonical user-facing name. Some directories use camelCase by file-system convention (e.g. `revenueStrategist` ↔ "Revenue Strategist"). The agent registry maps between the two.

---

## Key capabilities

### Policy-governed revenue execution
- Mission checkpoints and budget enforcement with automatic halts
- Role-based access control and enterprise entitlements (enforced when `TEOS_ENTERPRISE=true`)
- Complete auditability — every AI action, decision, and denial
- Self-directed learning from outcomes, bounded by governance constraints

### Mission Center
- Learn-first onboarding before any mission can launch
- Guided missions (Sell TEOS DealMaker, Revenue Pipeline, goal-driven)
- Step-by-step planning with explicit approval gates
- Progress tracking, agent handoffs, budget-aware execution

### Enterprise Integration Hub
- Connector catalog: Salesforce, HubSpot, Microsoft 365, Google Workspace and more
- **Default state:** catalog definitions only. No connector is wired to live credentials out of the box.
- To activate: configure connector credentials and enable `MCP_ENABLED=true` with a real `MCP_ENDPOINT`

### Advanced Intelligence Layer
- Retrieval-Augmented Generation (RAG) over company documents
- Multi-source ingestion: PDF, DOCX, CSV, web pages
- Semantic search with intent-aware ranking
- Source attribution on every answer

### Observability & governance
- Real-time workforce dashboard
- Detailed audit trail (UI + `/api/audit`)
- Cost tracking and optimization
- Health monitoring
- Configurable alerting

---

## Mission Center, Playground, Dashboard

Three UIs, one product description (single-sourced in `config/product.config.js`):

| Surface | What it is | Where |
|---|---|---|
| **Telegram bot** | Primary user interface for operators. `/start`, guided menus, mission control, approvals, founder console. | Bot menu + `@YourDealMakerBot` |
| **Mission Center** | Web UI for mission lifecycle, approval queues, audit log. | Mission Center route |
| **Landing + Playground** | Marketing site + an interactive client-side walkthrough of the workflow. Everything is **DEMO MODE — SIMULATED DATA**. | `/` and `#playground` |
| **Operations Dashboard** | Founder control surface: status strip, PAUSE/RESUME/EMERGENCY-STOP, audit log, live pricing. Marked `X-Robots-Tag: noindex`. | `/dashboard` |

The Playground is a sales tool — it shows prospects the workflow without sending real email, hitting Dodo checkout, or contacting anyone. The Telegram bot and the website describe the **identical** product, by design (no drift between marketing and product).

---

## API reference

TEOS exposes a small set of public HTTP endpoints. All `/api/audit*` and most `/api/revenue-ops*` and `/api/outreach/*` endpoints require `AUDIT_API_KEY` in the `X-API-Key` header.

> **Authentication:**
> - `AUDIT_API_KEY` (header `X-API-Key`) — required for ops/audit endpoints
> - `DODO_WEBHOOK_SECRET` — required for `/webhook/dodo` (HMAC, fail-closed when unset)
> - `RESEND_WEBHOOK_SECRET` — required for `/webhook/resend` (svix-signed, fail-closed when unset)

### Public marketing/ops
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/pricing` | Live pricing tiers with Dodo checkout URLs |
| GET | `/api/health` | Health check for uptime monitors |
| GET | `/health` | Service probe |
| GET | `/api/reports/latest` | Latest mission report (public) |
| GET | `/api/outreach/status` | Outbound worker status (sanitized, public) |

### Ops/audit (require `X-API-Key: $AUDIT_API_KEY`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/audit` | File-backed audit log |
| POST | `/api/outreach/pause` | Pause outbound worker |
| POST | `/api/outreach/resume` | Resume outbound worker |
| POST | `/api/outreach/emergency-stop` | Emergency stop |
| POST | `/api/outreach/founder-report` | Send ops report to `FOUNDER_REPORT_EMAIL` |
| GET | `/api/outreach/queue` | Sanitized queue view (no bodies, no full addresses) |
| GET | `/api/revenue-ops/status` | 24/7 Revenue Ops status |
| POST | `/api/revenue-ops/trigger` | Run founder report now (idempotent, audited, blocked when emergency-stopped) |
| POST | `/api/revenue-ops/pause` | Pause 24/7 scheduler |
| POST | `/api/revenue-ops/resume` | Resume (refused while emergency-stopped — clear `SOR_EMERGENCY_STOP` first) |
| POST | `/api/revenue-ops/emergency-stop` | Hard stop the scheduler |
| POST | `/api/revenue-ops/discover` | Run deterministic discovery scoring (idempotent) |
| GET | `/api/revenue-ops/approvals` | Pending revenue-gate approvals and founder alerts |
| POST | `/api/revenue-ops/notify` | Send Revenue Ops alert digest via Resend |
| GET | `/api/deploy-verify` | Deploy verification (env var existence, never values) |

### Webhooks
| Method | Path | Auth |
|---|---|---|
| POST | `/webhook/dodo` | HMAC `X-Dodo-Signature`; `401 invalid_signature` on mismatch; **rejected when `DODO_WEBHOOK_SECRET` unset** |
| POST | `/webhook/resend` | svix-signed; fail-closed without `RESEND_WEBHOOK_SECRET` |

### Other routes
- `/` — landing page
- `/robots.txt`, `/sitemap.xml`, `/favicon.svg`, `/og-image.*` — static
- `/dashboard` — operations console (`X-Robots-Tag: noindex`)

### Security
- Rate limits: `120/min/IP` on `/api/`, `30/min/IP` on `/webhook/` (express-rate-limit)
- Security headers on all responses: HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy
- Internal agent / workforce / mission execution is driven by the Telegram bot and internal modules — **not** by public REST endpoints

---

## How it works

> **Audience note:** this section is the technical deep-dive. The first paragraph of each subsection is the "for non-engineers" version; details under `<details>` blocks are for engineers.

### 9.1 System topology

<details>
<summary><strong>For non-engineers:</strong> one Railway service runs the web server, the Telegram bot, and the PostgreSQL database. Plugins are loaded at boot. The agent layer is in-process Node.js; the audit log is a file-backed store (the source of truth for compliance) with a thin HTTP surface.</summary>

```
teos-dealmaker/                 # single Node.js service, single Railway deploy
├── bot/                        # Telegram bot — primary operator UI
│   ├── screens/                # conversational screens (playground, mission, etc.)
│   └── index.js
├── server/                     # Express web server — landing, dashboard, API
│   ├── landing.html
│   └── index.js
├── agents/                     # 12 production agent directories + 2 loose infra files
│   ├── prospecting/
│   ├── qualification/
│   ├── sales/
│   ├── …
│   ├── router.js               # DRY/LIVE dispatcher (loose file, internal)
│   ├── marketIntelligence.js   # loose file — see Intelligence row above
│   └── orchestrator/           # workflow coordination
├── services/                   # 40+ cross-cutting services
│   ├── router/                 # NLP intent router — every user message flows through here
│   ├── workforce/              # Workforce Runtime — scheduler, dispatcher, executor, reviewer
│   ├── mission/                # Mission Controller — planning, lifecycle, approvals, budget
│   ├── audit/                  # hash-chained audit log
│   ├── transparency/           # EU AI Act disclosures
│   ├── memory/                 # per-workspace memory
│   ├── providers/              # multi-provider abstraction with fallback
│   ├── mcp/                    # MCP client layer
│   ├── outboundWorker/         # 24/7 governed outbound worker
│   ├── revenueOps/             # 24/7 Revenue Operations
│   ├── founderMission/         # founder control surfaces
│   ├── …                       # see repo for full list (40+ sub-services)
├── plugins/                    # transport-agnostic plugin manager
│   ├── civic-mixer/            # MCP gateway transport + civic capabilities
│   └── sentinel/               # governance plugin (see "TEOS Sentinel Shield" below)
├── db/                         # PostgreSQL schema + migration runner
├── config/
│   ├── product.config.js       # SINGLE SOURCE OF TRUTH for product copy (landing + bot)
│   └── pricing.config.js       # SINGLE SOURCE OF TRUTH for pricing
├── routes/api/                 # public + founder REST endpoints
├── tests/                      # per-agent + integration test scripts (npm test:*)
├── scripts/
│   ├── prod.js                 # production boot (start:all)
│   ├── apply-migrations.js     # SQL migration runner
│   ├── migrate-production.js   # v1.0.0/v1.0.2 data migrations
│   ├── transparency-check.js   # EU AI Act pre-push gate
│   └── githooks/pre-push       # installs on `npm run hooks:install`
├── docs/
│   ├── MCP_ARCHITECTURE.md
│   └── PLUGIN_CONTRACT.md
└── TRANSPARENCY.md             # EU AI Act requirement → implementation map
```

**Boot order** (per `scripts/prod.js`):
1. Load env, run `db.createTables()` + pending SQL migrations
2. Initialize plugin manager → load plugins from `plugins/*/manifest.json`
3. Initialize workforce runtime → register agents
4. Start HTTP server
5. Start Telegram bot polling
6. Start 24/7 outbound scheduler (if not in `SOR_EMERGENCY_STOP`)

</details>

### 9.2 Request lifecycle

<details>
<summary><strong>For non-engineers:</strong> a Telegram message or HTTP request becomes a Mission; a Mission is broken into ordered Steps; each Step is dispatched to an Agent; the Agent asks the LLM Provider; the result is audited before the next step.</summary>

```
   Operator                Mission Controller          Workforce Runtime              Agent
   (Telegram/REST)         (mission/)                  (workforce/)                   (agents/*)
        │                         │                          │                          │
        │  1. Goal / brief        │                          │                          │
        ├────────────────────────▶│                          │                          │
        │                         │  2. Plan (ordered steps) │                          │
        │                         │     + budget + approvals │                          │
        │                         │  3. Approval gate (if required)                    │
        │  4. Approve / reject    │                          │                          │
        ├────────────────────────▶│                          │                          │
        │                         │  5. Dispatch step        │                          │
        │                         ├─────────────────────────▶│                          │
        │                         │                          │  6. Resolve capability     │
        │                         │                          │  7. executeCapability() ──▶│
        │                         │                          │     (policy gate)
        │                         │                          │  8. Build prompt + context │
        │                         │                          │  9. Call provider          │
        │                         │                          │ 10. Audit + memory write   │
        │                         │                          │ 11. Result + next step     │
        │                         │                          │ ◀────────────────────────┤
        │                         │ 12. Update mission state │                          │
        │                         │ ◀────────────────────────┤                          │
        │  13. Status / result    │                          │                          │
        │ ◀───────────────────────┤                          │                          │
```

**Key invariants:**
- The Mission Controller **never executes work directly** — it only plans, approves, and delegates
- The Workforce Runtime **never bypasses the policy gate** — every capability invocation goes through `executeCapability()`
- Agents **never call providers directly in production** — they go through the provider abstraction, which is the only layer that knows about the fallback chain

</details>

### 9.3 Mission state machine

Every mission is a finite state machine. The state is stored in PostgreSQL, scoped by `workspace_id`, and is the source of truth for resumability after a crash or pause.

```
          ┌────────┐    approve    ┌────────┐   analyze    ┌──────────┐
   goal → │  PLAN  │ ────────────▶ │ APPROVE│ ───────────▶ │ ANALYZE  │
          └────────┘               └────────┘              └──────────┘
                │                                                 │
                │ reject                                          ▼
                ▼                                            ┌──────────┐
          ┌────────┐                                          │ SIMULATE │
          │REJECTED│                                          └──────────┘
          └────────┘                                                │
                                                                    ▼
                                                              ┌──────────┐
                                                              │ APPROVE  │ (human gate)
                                                              └──────────┘
                                                                    │ approve
                                                                    ▼
                                                              ┌──────────┐
                                                              │ EXECUTE  │
                                                              └──────────┘
                                                                    │
                                                              ┌─────┴─────┐
                                                              ▼           ▼
                                                       ┌──────────┐ ┌────────┐
                                                       │ COMPLETE │ │ FAILED │
                                                       └──────────┘ └────────┘
                                                              │
                                                              ▼
                                                       ┌──────────┐
                                                       │  REPORT  │
                                                       └──────────┘
```

| State | Owner | Reversible? |
|---|---|---|
| `PLAN` | Mission Controller | yes (free) |
| `APPROVE` | Human (founder/operator) | yes (reject) |
| `ANALYZE` | Workforce → Researcher/Qualifier | yes (re-plan) |
| `SIMULATE` | Workforce → Strategist/Negotiator | yes (re-plan) |
| `APPROVE` (2nd) | Human (founder/operator) | yes (reject halts) |
| `EXECUTE` | Workforce → Marketer/Sales/Treasurer | **no** for external-send/payment steps (gated) |
| `COMPLETE` / `FAILED` / `REPORT` | terminal | n/a |

**State transitions are recorded in the audit log.** A transition from `APPROVE → EXECUTE` is the most important event in the system from a compliance perspective — it's the only transition that authorizes irreversible side effects.

</details>

### 9.4 Governance gate (`executeCapability`)

The single chokepoint for every external action. Seven sequential yes/no checks, in order. The first failure short-circuits with a deny reason that lands in the audit log.

```
1. MCP enabled?                       ─ no  → simulation path (simulated: true, mcp_disabled)
2. Tool known in registry?            ─ no  → unknown_tool
3. Enterprise gate (TEOS_ENTERPRISE=true only — skipped entirely when off)
   ├─ Founder bypass?                 ─ yes → skip remaining enterprise sub-checks
   ├─ Tenant active?                  ─ no  → tenant_inactive
   ├─ License valid?                  ─ no  → entitlement_invalid
   ├─ Capability in plan scope?       ─ no  → capability_not_entitled
   ├─ RBAC?                           ─ no  → insufficient_role
   └─ Policy engine?                  ─ no  → policy.reason
4. Plugin permission policy?          ─ no  → denied
5. Adapter resolved?                  ─ no  → no_adapter
6. Endpoint configured?               ─ no  → simulation path (simulated: true, mcp_not_configured)
7. Adapter call success?              ─ no  → adapter.error
   ─ yes → execute, audit CAPABILITY_ALLOWED
```

**Two important properties:**

- **Deny-wins within the enterprise gate.** When `TEOS_ENTERPRISE=true` (or `ENTERPRISE_MODE=true`), the six sub-checks run in order. The first one that fails returns its specific deny reason. Founder bypass (`TEOS_FOUNDER_TELEGRAM_ID`) skips sub-checks 2–6 but does not skip checks 1, 2, 4, 5, 6, or 7.
- **The gate is opt-in at the enterprise level.** `TEOS_ENTERPRISE=false` (the default) means check 3 is **skipped entirely** — the call proceeds directly to check 4. The other six checks always run, which is what makes the platform safe to expose by default.

**The full sequence is recorded in the audit log** with the specific deny reason, so a failed invocation tells you exactly which check blocked it.

**Configuration:** `TEOS_ENTERPRISE=true` (or `ENTERPRISE_MODE=true`) enables check 3. `MCP_ENABLED=true` makes check 1 pass instead of routing to the simulation path. `MCP_ENDPOINT` + `MCP_API_KEY` make check 6 pass instead of routing to the simulation path.

</details>

### 9.5 Provider abstraction

The platform supports 8+ LLM providers with automatic fallback chains. **Important caveat:** no LLM SDK is declared as a direct dependency in `package.json` — providers are loaded dynamically through the Plugin Platform / MCP layer, not as bundled Node packages. This is intentional: it keeps the core runtime free of vendor SDKs and lets the platform add/remove providers via plugin without a `package.json` change.

| Concern | Where it lives |
|---|---|
| Provider list | Plugin manifests + `config/providers.config.js` |
| API key storage | Environment only — **never** in code or `package.json` |
| Fallback chain | Declared per-workspace; primary → secondary → tertiary |
| Token accounting | Workforce telemetry; surfaced in `/api/revenue-ops/status` |
| Cost caps | Per-workspace budget; enforced by Mission Controller |

**Provider wording is deliberately vendor-agnostic** ("multi-provider AI, includes Anthropic Claude") — the platform is not "built on" any single vendor.

</details>

### 9.6 Plugin & MCP resolution

When an agent needs to call an external system, the request flow is:

```
agent.sales.sendEmail(to, subject, body)
  → workforce resolves capability "outreach.send"
  → plugin manager looks up capability across loaded plugin manifests
  → if MCP enabled: route through MCP gateway (TEOS Civic Mixer)
  → if MCP disabled: call local adapter (simulated)
  → audit result, return to agent
```

**Why this matters:** an agent never knows whether the email was sent by a local mock, a remote MCP server, or a future REST/gRPC transport. Swapping transports is a plugin-manifest change, not a code change.

See [`docs/PLUGIN_CONTRACT.md`](docs/PLUGIN_CONTRACT.md) for the manifest schema and [`docs/MCP_ARCHITECTURE.md`](docs/MCP_ARCHITECTURE.md) for the call pipeline.

</details>

### 9.7 Audit trail

Every decision, allowance, and denial is written to a file-backed, hash-chained log.

| Property | Value |
|---|---|
| Storage | Append-only file under `services/audit/` (rotated) |
| Hash chain | Each entry includes `prev_hash`; tampering breaks the chain |
| Access | `GET /api/audit` (requires `AUDIT_API_KEY`) |
| Retention | Configurable per workspace |
| What's recorded | capability, actor, tenant, decision, reason, context hash, timestamp |

**Hash chain integrity check** is a governance responsibility — it should be wired into your monitoring, not just trusted to "be there."

</details>

### 9.8 Worked example: a "Sell TEOS DealMaker" mission

A prospect hits the landing page → triggers the inbound Play. End-to-end:

1. **PLAN** — Mission Controller builds a plan: `Researcher → Qualifier → Strategist → Marketer → Sales`
2. **APPROVE** — founder approves plan + budget (`$5 cap on this mission`)
3. **ANALYZE** — Researcher fetches company info, runs fit score; Qualifier scores against BANT
4. **SIMULATE** — Strategist drafts a deal playbook; Negotiator proposes pricing tier
5. **APPROVE** — founder reviews the simulated outreach, approves or edits
6. **EXECUTE** — Marketer drafts email → `executeCapability('outreach.send')` → policy ALLOW → email sent → Treasurer drafts contract → `executeCapability('treasurer.draft')` → policy REVIEW → human approves
7. **REPORT** — mission report written to `/api/reports/latest`

**Total side effects without human approval: 0.** The only way an external send happens is through a reviewed `EXECUTE` transition.

</details>

---

## Configuration

Every behavior-changing setting is an environment variable. **Nothing is hardcoded** in the application code.

### Core

| Variable | Purpose | Default |
|---|---|---|
| `TEOS_ENTERPRISE` | Enable the governance gate (check 3) | `false` |
| `ENTERPRISE_MODE` | Alias for `TEOS_ENTERPRISE`; either one enables check 3 | `false` |
| `TEOS_FOUNDER_TELEGRAM_ID` | Permanent bypass for founder role | unset |
| `NODE_ENV` | `production` / `development` | `development` |
| `PORT` | HTTP port | `3000` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot | unset (bot disabled) |
| `DATABASE_URL` | PostgreSQL connection | falls back to in-memory |

### MCP (opt-in)

| Variable | Purpose |
|---|---|
| `MCP_ENABLED` | Enable the MCP layer |
| `MCP_ENDPOINT` | Gateway URL (TEOS Civic Mixer) |
| `MCP_API_KEY` | Auth for the gateway |
| `MCP_TIMEOUT` | Request timeout (ms) |

### Auth / API

| Variable | Purpose |
|---|---|
| `AUDIT_API_KEY` | Required for `/api/audit*` and most ops endpoints |
| `DODO_WEBHOOK_SECRET` | HMAC for `/webhook/dodo` (fail-closed when unset) |
| `RESEND_WEBHOOK_SECRET` | svix for `/webhook/resend` (fail-closed when unset) |

### Outbound / 24-7 scheduler

| Variable | Purpose |
|---|---|
| `SOR_EMERGENCY_STOP` | Hard kill switch (`true` halts all scheduling) |
| `FOUNDER_REPORT_EMAIL` | Destination for founder ops report |
| `RESEND_API_KEY` | Required for `founder-report` and `notify` endpoints |

### Mission / entitlements

Workspace plan, seat count, agent count, and quota are stored in PostgreSQL and managed via Founder Control Center.

---

## Plugin Platform

The Plugin Platform is a transport-agnostic plugin manager. Plugins declare:

- **adapters** (transport implementations)
- **capabilities** (what the plugin can do)
- **policies** (per-capability policy)
- **schemas** (input/output validation)
- **audits** (what to record)
- **permissions** (what the plugin needs)

### Current plugins

- **Civic Mixer** (`plugins/civic-mixer/`) — MCP gateway transport + civic capabilities

> **TEOS Sentinel Shield** is delivered as an enterprise governance plugin (`plugins/sentinel/`) but is **an independent product** sold separately at `https://sentinel.teosegypt.com`. It is cross-linked from the DealMaker surface only — never sold through DealMaker checkout.

### Future plugins (roadmap)

GitHub · Slack · Jira · Salesforce · HubSpot · Microsoft 365 · Google Workspace

See [`docs/PLUGIN_CONTRACT.md`](docs/PLUGIN_CONTRACT.md) for the contract, manifest schema, lifecycle, and permissions model.

### Adding a new plugin

```bash
mkdir -p plugins/my-plugin
# 1. Create plugins/my-plugin/manifest.json (see docs/PLUGIN_CONTRACT.md)
# 2. Implement adapter, policy, schema, audit modules
# 3. Add tests under plugins/my-plugin/test/
# 4. Configure env vars only — never hardcode URLs or credentials
# 5. Boot — the plugin manager auto-discovers at startup
```

---

## TEOS Sentinel Shield

**Separate product, separate surface, separate billing.** Not a DealMaker feature.

Sentinel Shield (`https://sentinel.teosegypt.com`) provides:

- AI security scanning
- Prompt inspection
- Code review
- Smart contract analysis
- Policy enforcement
- Audit logging

Mission Controller invokes Sentinel through the Plugin Platform — it is a governance plugin, not a bundled feature. Code audit, smart-contract review, and CI/CD security scanning are enforced **only when the plugin is active and `MCP_ENABLED=true`**. Sentinel ships with its own public landing page and governance console.

**Rule for sales:** Sentinel is never sold through DealMaker checkout. Cross-link only.

---

## Deployment

### Current production
Single Railway service: web server + Telegram bot + PostgreSQL. Single deploy artifact (`scripts/prod.js`), no microservices, no orchestration overhead.

### Prerequisites
- Node.js 18+
- PostgreSQL 13+ (production) or in-memory store (development)
- Telegram Bot Token (for the bot interface)
- LLM provider API keys (for any provider you want to enable)

### Local install
```bash
git clone https://github.com/your-org/teos-dealmaker.git
cd teos-dealmaker
npm install
cp .env.example .env
# Edit .env with TELEGRAM_BOT_TOKEN, DATABASE_URL, and provider keys
npm run db:migrate
npm start          # Telegram bot
npm run server     # Web server (landing + dashboard + API)
# Or everything:
npm run start:all
```

### Enterprise mode
```bash
TEOS_ENTERPRISE=true
```
The gate enforces tenant resolution, license/entitlement validity, plan capability scope, and RBAC authorization before any tool or plugin runs. **Off by default** — runtime behavior is unchanged.

### For self-hosted / private instance
Not yet supported. Current production is multi-tenant SaaS on Railway. Roadmap items: Docker containerization, Kubernetes, horizontal autoscaling.

---

## Enterprise readiness

> **Audience note:** this section is deliberately honest. It exists to set correct expectations for procurement, security, and SRE teams. Items listed as "not implemented" or "planned" are not a defect — they are a roadmap with current state.

### Security & compliance
- ✅ Role-based authorization (enforced when `TEOS_ENTERPRISE=true`)
- ✅ Transport encryption (TLS) on public endpoints
- ⚠️ Encryption at rest — not yet implemented
- ⚠️ GDPR/CCPA tooling (export, deletion, consent) — planned
- ❌ SOC 2 / ISO 27001 — not certified
- ❌ Third-party penetration testing — not conducted

### Reliability & performance
- ⚠️ Single-instance deployment; no uptime SLA
- ❌ Horizontal autoscaling — not implemented
- ❌ Automated failover / DR / backup-restore — not implemented
- ✅ Health checks via `/api/health`; latency visible via `/api/diagnostics`

### Operations & support
- ✅ Structured console logging + ops endpoints
- ⚠️ No metrics/tracing stack; OpenTelemetry is on the roadmap
- ❌ Operational runbooks — planned
- ⚠️ Support via the founding team on the Telegram console; no 24/7 SLA

### Roadmap (no dates)
- Billing
- Plugin marketplace
- Plugin signing
- OpenTelemetry / distributed tracing
- SOC 2 readiness

---

## Customization & extension

### Add a new agent
1. Create `agents/my-agent/` with `index.js`, `manifest.json`, `prompt.js`
2. Register the agent in the workforce registry (role, cadence, queue)
3. Define any required DB models in a new migration under `db/migrations/`
4. Add a `test:my-agent` script in `package.json` and a test under `tests/`
5. Expose via the Mission Center screens

### Add a new plugin
See [§ Adding a new plugin](#adding-a-new-plugin). Plugins are isolated by design — they cannot modify core code.

### Integrate a new external system
1. Implement the adapter contract (`plugins/_template/`)
2. Add a config schema for credentials (env vars only)
3. Register in the Integration Hub catalog
4. Implement sync logic (bi-directional)
5. Add monitoring + error handling for the system

### Switch LLM provider
Edit `config/providers.config.js` and add the API key as an env var. No code change, no redeploy of the agent layer.

---

## Versioning & release notes

| Version | Date | Notes |
|---|---|---|
| **1.1.0** (current) | — | (see commit log) |
| 1.0.2 | 2026 | Production SaaS Release: commercial plans, founder controls, CSP/rate-limits/HMAC, EU AI Act transparency hook |
| 1.0.0 | 2026 | Public Launch: TEOS DEALMAKER rebrand, Dodo production catalog, landing page, plugin contract frozen at `^1.0.0` |
| 0.9 | 2026 | Architecture Foundation: modular Workforce, Mission Controller, MCP, Plugin Platform, Sentinel, Civic Mixer, Enterprise Platform |
| 0.8.1 | 2026 | Recovery: repository restored, runtime stabilized |

See `git log` for the full commit history.

---

## EU AI Act transparency

> **Why this exists:** the EU AI Act requires AI-generated content to be disclosed to end users. The platform enforces this in code, not in policy.

Every `git push` runs `scripts/transparency-check.js` (pre-push hook) and the check is also runnable locally via `npm run transparency:check`. The check verifies:

- **Disclosure exports** — `AI_DISCLOSURE_EN`, `AI_DISCLOSURE_AR`, `AI_CONTENT_MARKER` are exported
- **`withAiDisclosure`** — appends language-specific disclosure footers (EN/AR), idempotent
- **`withContentMarking`** — adds machine-readable markers to outbound content
- **Session memory** — tracks disclosure state per session
- **Language resolution** — picks the right disclosure language dynamically
- **Outbound worker** — enforces content marking in the send path
- **`TRANSPARENCY.md`** — maps compliance requirements to implementation

A push is **blocked** if any check fails. This is by design — silent compliance regressions are worse than a slow PR.

**Contributor workflow:**
1. `npm run transparency:check` locally before pushing
2. If a check fails, update the relevant module (`services/transparency/`, `services/outboundWorker/`, or `TRANSPARENCY.md`)
3. Push again — only compliant code passes

See [`TRANSPARENCY.md`](TRANSPARENCY.md) for the full EU AI Act → implementation map.

---

## License

**Proprietary.** © 2026 Elmahrosa International. All rights reserved.

See [`LICENSE`](LICENSE) for the full text.

> **Implementation note:** the `package.json` field `"license": "UNLICENSED"` is a publishing metadata placeholder; the canonical license is the `LICENSE` file. The two will be reconciled in the next release.

---

## Support

- **Enterprise sales** — enterprise@elmahrosa.org
- **Technical support** — support@elmahrosa.org
- **Security reporting** — security@elmahrosa.org

For the latest features, roadmap, and release notes, see the [documentation portal](https://docs.elmahrosa.org/teos-dealmaker).
