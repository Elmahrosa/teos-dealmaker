 # TEOS DealMaker

### The Enterprise AI Revenue Operating System — production, governed, MCP-native.

> A policy-governed AI workforce that plans, approves, executes, and audits your entire revenue pipeline.
> 13 specialized agents. A Mission Controller. A plugin platform. Real governance — not a chatbot with a prompt.

**Live now** at [dealmaker.elmahrosa.org](https://dealmaker.elmahrosa.org) · **v1.1.0** · 59/59 test suites passing · 0 lint errors · 0 dependency vulnerabilities.

---

## The 30-second pitch

If you've ever tried to ship an "AI sales agent" and ended up with a chat window that hallucinates pricing — this is for you.

**TEOS DealMaker is a revenue operating system, not a chatbot.** A real, governed fleet of 13 specialized AI agents runs your pipeline end-to-end:

- It finds and qualifies prospects.
- It drafts outreach (and waits for your approval before sending).
- It negotiates terms — within the caps you set.
- It drafts contracts, prepares payment requests, and routes every consequential action through a human gate.
- It writes everything to a tamper-evident, hash-chained audit log.
- It learns from outcomes — under governance, not on its own.

You can run it from **Telegram** (the bot is live at [@TeosEgypt_bot](https://t.me/TeosEgypt_bot)) or the **web dashboard**. The same Mission Controller drives both.

---

## Why now: the 2026 market context

If you're evaluating this, here's the landscape we built against:

- **MCP became the default agent contract in 2026.** The Model Context Protocol moved from Anthropic-original to Linux Foundation governance (Dec 2025) and now ships with first-party support from OpenAI, Microsoft, AWS, Google, and Cloudflare. Combined SDK downloads hit 97M/month by March 2026. **TEOS is already MCP-native** — every external action flows through our MCP gateway (Civic Mixer) or stays simulated when MCP is off. You don't need a six-month integration project.
- **Pricing is shifting to outcome-based.** Salesforce ships Flex Credits at ~$0.10/action; HubSpot Breeze moved to $0.50/resolution in April 2026. We're keeping per-seat pricing because the full revenue OS — including the control plane, audit, and policy — isn't a per-action product. But the *direction* matters: we're watching usage, not logins.
- **Governance is the 2026 procurement gap.** Per Futurum's H1 2026 report, "the gap between MCP adoption and governance readiness" is the defining work of 2026. The big CRMs (Salesforce, HubSpot, Microsoft) are now racing to close it. **TEOS shipped with governance from day one** — policy engine, RBAC, entitlements, capability gate, hash-chained audit, founder emergency stop.
- **Drift shut down in March 2026.** A reminder that undifferentiated AI agents without a control plane don't survive. We have the control plane.
- **Agentforce is the scale benchmark.** Salesforce reports 18,500+ Agentforce customers running 3B+ agent workflows/month. That's the bar for "real production AI." TEOS is much smaller — but it is genuinely governed, not just gated.

In other words: the platform is real, the agents are real, the governance is real, and the only thing that's small is the customer count — which is exactly the point of going to market.

---

## What you actually get

| Capability | What it does |
|---|---|
| **Mission Controller** | Plan → Analyze → Simulate → Approve → Execute → Report. A single lifecycle that turns a goal into a reviewable mission. |
| **13-agent AI workforce** | Prospector, Researcher, Qualifier, Revenue Strategist, Strategist, Marketer, Sales, Negotiator, Treasurer, Gatekeeper, Orchestrator, Closer, Intelligence. |
| **Deal Brief → Stakeholder Map → Simulation** | Real stakeholder analysis and a simulated deal outcome before you commit time or money. |
| **Governed email** | Outreach worker is fail-closed, approval-required, provider-confirmed. Default: paused. You flip it on when ready. |
| **24/7 outbound worker** | Persistent queue with daily/hourly/per-recipient limits. Nothing ships without founder approval. |
| **Mission Reports** | Executive report on the web (`/report/:planId`) and Customer #0 reference showcase (`/customer-0`). |
| **Dodo checkout** | Solo $99 · Growth $299 · Business $999 · Enterprise custom. HMAC-signed webhooks. |
| **Hash-chained audit vault** | SHA-256 chained. Verifiable. Append-only. Founder has read access via the `/api/audit` endpoint (gated by `AUDIT_API_KEY`). |
| **Policy engine** | Every capability invocation passes `executeCapability()` — tenant resolution → license/entitlement → plan scope → RBAC → audit. Deny-wins. Fail-closed. |
| **Multi-tenant by default** | Workspace isolation enforced at the DB layer. SQL column whitelisting. PostgreSQL TLS on. |
| **MCP gateway** | Real MCP support (Civic Mixer) or simulated when disabled. Same agent code, same governance — only the transport changes. |
| **Plugin platform** | A transport-agnostic plugin manager. Plugins expose adapters, capabilities, policies, schemas, audits, permissions. MCP is one transport; REST, gRPC, and webhook transports fit the same contract. |
| **Operations console** | Live service status, founder controls, audit trail, pricing — at `/dashboard`. |
| **EN + AR** | Full bilingual support in the bot and the landing page. |

---

## The 2-minute start

You don't need to deploy anything to try it.

1. **Open the bot** → https://t.me/TeosEgypt_bot → `/start`
2. **Pick a mission** (e.g. "Sell TEOS DealMaker") and watch the 13-agent workforce plan it.
3. **Approve, simulate, execute** — every consequential step waits for you.
4. **Read the report** at `/report/:planId` when the mission completes.
5. **Or just play with the playground** at https://dealmaker.elmahrosa.org — the demo is a simulated walkthrough, no checkout, no real contact.

If you want to wire it into your stack, the bot speaks to the same Mission Controller that the web dashboard, REST API, and MCP gateway do. One product, every surface.

---

## Who this is for

- **Founders and GTM leads** who want a real revenue engine, not a Slack channel.
- **Agencies and consultancies** that need to deliver client work with an audit trail.
- **Regulated industries** (finance, healthcare, public sector) where every AI action needs to be policy-evaluated, role-scoped, and logged.
- **AI-curious enterprises** evaluating a controlled runtime before letting agents touch customers, contracts, or money.

If you're a startup that just wants a ChatGPT wrapper, this is overkill. If you want the control plane that the big CRMs are racing to build, you're in the right place.

---

## The architecture, in one screen

```
Telegram / Web UI / REST API
        │
   Mission Controller         → plans missions, holds approval gates, enforces budgets
        │
   Workforce Runtime          → scheduler, dispatcher, executor, reviewer, recovery
        │
   Plugin Platform            → capabilities, policies, schemas, audits, permissions
        │
   MCP Layer                  → external actions via TEOS Civic Mixer (MCP gateway)
        │
   Providers                  → 8+ LLM providers with automatic fallback chains
        │
   Enterprise Platform        → tenants, entitlements, plans, RBAC, capability gate
        │
   Intelligence (RAG)         → company-specific knowledge grounding
        │
   Integration Hub            → connector catalog (CRM, email, calendar, storage)
        │
   Persistence                → multi-tenant PostgreSQL, workspace isolation
```

Every capability invocation is governed **before** execution:

```
Mission → Policy → Authorization → Entitlements → Plugin → Workforce → Agent → Provider → Memory + Audit
```

Governance happens **first**. That's the difference.

---

## The 13-agent workforce

| Agent | Job |
|---|---|
| **Prospector** | Lead discovery. Identifies and scores new company prospects. |
| **Researcher** | Market intelligence. Analyzes companies, competitors, signals. |
| **Qualifier** | Lead assessment. BANT/MedPICC evaluation, recommends next steps. |
| **Revenue Strategist** | Revenue strategy. Designs monetization, pricing architecture. |
| **Strategist** | Deal planning. Tactical playbooks for specific opportunities. |
| **Marketer** | Value proposition. Compelling positioning and messaging. |
| **Sales** | Objection handling. Data-driven counters to common objections. |
| **Negotiator** | Terms optimization. Pricing, discounts, payment terms — within caps. |
| **Treasurer** | Contract & payment. Drafts agreements and prepares payment requests, **submitted for human approval** per policy. |
| **Gatekeeper** | Safety & compliance. Reviews every communication for policy and risk. |
| **Orchestrator** | Workflow coordination. Routes work between agents. |
| **Closer** | Deal finalization. Manages won/lost outcomes. |
| **Intelligence** | Knowledge assistant. Answers complex questions using company-specific data. |

**Adding a new agent?** Create a folder under `agents/`, register it in the universal agent registry, and ship tests. The Mission Controller picks it up.

---

## Governance and safety — what we actually mean

This is the part most AI platforms either skip or hand-wave. We mean it concretely.

- **Deny-wins policy evaluator.** Every capability call passes through `executeCapability()`. If the policy can't be evaluated, the call is denied. Fail-closed is the default.
- **Human approval gates.** Anything consequential (sending real email, processing real payment, modifying a contract) requires explicit founder approval. The 24/7 outbound worker is paused by default and only runs after founder flip-on.
- **RBAC and entitlements.** Plan-based capability scope. Tenant isolation. License, plan, limits, quotas — all enforced at the gate, not in the UI.
- **Hash-chained audit trail.** Every decision, allowance, denial is recorded with SHA-256 chaining. `verifyVault()` confirms integrity. The audit log is the source of truth.
- **Emergency Stop.** One toggle, founder-only, halts every agent and pipeline run platform-wide.
- **Feature Flags.** Founder can disable capability families (Missions, Sales flow, Pipeline run, Intelligence, Integrations) at the executor level.
- **Prompt-injection treated as data.** Hostile inputs in the simulation layer were tested explicitly (see `tests/promptInjectionTest.js`); the platform treats them as data, never as instructions.
- **Webhooks are signed and fail-closed.** Dodo HMAC. Resend svix. Unset secret = no requests accepted.
- **Founder bypass is explicit and auditable.** The founder's `TEOS_FOUNDER_TELEGRAM_ID` skips billing/seat/workspace gates — and every bypass is in the audit log.

### Honest compliance posture

We don't have certifications we don't have. Here's the real state:

- ✅ RBAC, audit, tenant isolation, TLS, CSP, rate limits, signed webhooks
- ✅ Hash-chained tamper-detectable audit vault
- ⚠️ No SOC 2 or ISO 27001 yet (planned, not yet certified)
- ⚠️ GDPR/CCPA tooling — partial (data export/deletion tooling is in the roadmap)
- ⚠️ No third-party penetration test yet
- ⚠️ Single-instance deployment, no published uptime SLA

We're honest about this because procurement teams need to know what's real. See [docs/SECURITY_REPORT.md](docs/SECURITY_REPORT.md) for the full posture and [docs/ENTERPRISE_READINESS.md](docs/ENTERPRISE_READINESS.md) for the maturity matrix.

---

## Pricing

| Tier | Monthly | Annual | What you get |
|---|---|---|---|
| **Solo** | $99 | $950 (save ~20%) | 1 workspace, Mission Controller, 13-agent workforce, core agent capabilities, community support. |
| **Growth** | $299 | $2,990 (save ~17%) | 10 seats, Civic Mixer plugin, Enterprise Knowledge Intelligence (RAG), email support. |
| **Business** | $999 | $9,990 (save ~17%) | 25 seats, third-party plugin installs, all platform add-ons, priority support. |
| **Enterprise** | Custom | Custom | Unlimited workspaces/missions, custom deployment, policy governance at scale, direct access to the founding team. |

Pricing is **per-seat SaaS** — not outcome-based. We're watching the outcome-pricing trend (HubSpot Breeze, Salesforce Flex Credits) and may add a usage component in v1.3, but the full control plane is a subscription product, not a per-action one. **Source of truth:** [`config/pricing.config.js`](config/pricing.config.js) — single-sourced, no placeholder links.

Checkout URLs are wired to Dodo Payments with HMAC webhook verification. **Sentinel** is a separate product (`https://sentinel.teosegypt.com`) and is never sold from this surface.

---

## Get started

### Try it first (no install)
- **Live site:** https://dealmaker.elmahrosa.org
- **Telegram bot:** https://t.me/TeosEgypt_bot
- **Demo report:** https://dealmaker.elmahrosa.org/customer-0

### Self-host (Node 18+)

```bash
git clone https://github.com/Elmahrosa/teos-dealmaker.git
cd teos-dealmaker
npm install
cp .env.example .env       # fill in TELEGRAM_BOT_TOKEN, DATABASE_URL, and the keys you need
npm run db:migrate         # PostgreSQL (Supabase-compatible)
npm start                  # bot (Telegram)
npm run server             # web (landing + dashboard + API)
npm run start:all          # both
```

### Enable governance mode
```bash
TEOS_ENTERPRISE=true
```
That single flag turns on the `executeCapability()` gate: tenant resolution, license/entitlement validity, plan capability scope, and RBAC authorization — enforced before any tool or plugin runs. Off by default; runtime behavior is unchanged otherwise.

### Verify it
```bash
npm test         # 59 suites, 59 passed, 0 failed
npm run lint     # 0 errors
npm run build    # syntax gate (node --check on every JS file)
npm audit --omit=dev   # 0 vulnerabilities
```

---

## Public API surface

| Endpoint | What it does |
|---|---|
| `GET /` | Landing page (EN/AR) |
| `GET /api/health` | Health check, returns `{"status":"ok",...}` |
| `GET /health` | Service probe |
| `GET /api/pricing` | Live pricing tiers with Dodo checkout URLs |
| `GET /api/reports/latest` | Latest mission report (public) |
| `GET /api/outreach/status` | Governed outbound worker status (public, sanitized) |
| `GET /api/audit` | Audit log (gated by `AUDIT_API_KEY` in `X-API-Key`; 503 until configured) |
| `POST /webhook/dodo` | Dodo payment webhook (HMAC-signed, fail-closed) |
| `POST /webhook/resend` | Resend delivery webhook (svix-signed, fail-closed) |
| `GET /dashboard` | Operations console (noindex) |
| `GET /report/:planId` | Executive mission report |
| `GET /customer-0` | Customer #0 reference |

Founder controls (`/api/outreach/pause`, `/resume`, `/emergency-stop`, `/queue`, `/deploy-verify`) all require `AUDIT_API_KEY`. Internal agent/workforce/mission execution is not exposed via public REST.

---

## What's verified today

Last verification (2026-08-08, post-v1.1.0 freeze):

| Check | Result |
|---|---|
| `npm test` | 59 suites, 59 passed, 0 failed |
| `npm run lint` | 0 errors |
| `npm run build` | PASS (node --check on 265 JS files) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `GET /api/health` | 200, `status=ok`, `mode=live` |
| `GET /` landing | 200 |
| `GET /customer-0` | 200 |
| `GET /report/:planId` | 200 |
| `GET /api/pricing` | 200 with Dodo checkout URLs for Solo/Growth/Business |
| `GET /api/audit` | 503 (fail-closed until `AUDIT_API_KEY` is configured) |
| Bot trust/security intents (EN + AR) | PASS — no `/start` fallback |
| Customer-facing honesty | No "Coming Soon"/"Demo" placeholders, no simulated branding in reports |

See `BUILD_STATE.md` and `FINAL_VALIDATION_REPORT.md` for the full evidence.

---

## Extending the platform

### Add an agent
1. Create `agents/<name>/` with a single entrypoint.
2. Register in the universal agent registry (`agents/registry.js`).
3. Add a test file under `agents/<name>/test.js` — picked up by the aggregate runner.
4. The Mission Controller picks it up automatically.

### Add a plugin
1. Create a leaf package under `plugins/` with a `manifest.json` (capabilities, tools, permissions, entries).
2. Implement adapter, policy, schema, and (optionally) audit modules.
3. Ship a plugin-local test suite.
4. Configure via environment variables — never hardcode URLs or credentials.
5. Load through the Plugin Platform; MCP consumes it as one transport.

### Add a connector
1. Implement the integration interface (`services/integrations`).
2. Add a configuration schema for credentials and settings.
3. Register in the Integration Hub catalog.
4. Implement sync logic for bi-directional data flow.
5. Add monitoring and error handling.

See [`docs/PLUGIN_CONTRACT.md`](docs/PLUGIN_CONTRACT.md) for the full plugin contract and [`docs/MCP_ARCHITECTURE.md`](docs/MCP_ARCHITECTURE.md) for the MCP call pipeline.

---

## Trust, credentials, and the wider product family

- **Trust Center:** https://elmahrosa.org/trust — the canonical source for security, compliance, and credentials.
- **Verified Credly credential:** Claude Partner Network — Claude Code (link on the landing page).
- **TEOS Sentinel Shield:** `https://sentinel.teosegypt.com` — a **separate** Elmahrosa product for AI security scanning, prompt inspection, code review, and policy enforcement. Not sold through DealMaker checkout. Cross-linked only.
- **TEOS Civic Mixer:** the MCP gateway plugin that ships with DealMaker. Free, open, civic-governance oriented.

**Honest claims:** DealMaker does not claim guaranteed revenue, autonomous financial/legal/clinical authority, or certifications that don't exist. What you see is what you get.

---

## Roadmap (post-v1.1.0 freeze)

The v1.1.0 release is **frozen** on `main`. Only reproducible bug fixes, security fixes, broken-link fixes, and broken-routing fixes are accepted. The roadmap lives in [`docs/ROADMAP.md`](docs/ROADMAP.md).

- **v1.2.0** — Proactive Telegram notifications (preserved on the `v1.2.0-notifications` branch)
- **v1.3.x** — Outcome-based usage pricing component, per-action telemetry export
- **v1.4+** — SOC 2 readiness, GDPR/CCPA tooling, third-party pentest, multi-region
- **Long-term** — OpenTelemetry, plugin signing, distributed tracing, public marketplace

---

## License

Proprietary. © 2026 Elmahrosa International. All rights reserved.
See [`LICENSE`](LICENSE) for full details.

---

## Support

- **Enterprise sales:** enterprise@elmahrosa.org
- **Technical support:** support@elmahrosa.org
- **Security reporting:** security@elmahrosa.org
- **Live ops console:** https://dealmaker.elmahrosa.org/dashboard

---

*TEOS DealMaker v1.1.0 — production, governed, MCP-native.*
*Maintained by the Elmahrosa International team.*
