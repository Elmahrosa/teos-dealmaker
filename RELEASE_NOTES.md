# TEOS DealMaker — Release Notes

## v1.1.0 (2026-08-07)

### Post-review polish — honest executive output

- **Executive Mission Report** (`/report/:planId`): per-mission timeline (each step with duration, confidence, and output), mission KPIs (completion/success rate, average confidence, cost, budget, agents used, provider usage), and a full executive report text — all derived from real reviewed step data.
- **Mission KPIs** in the Telegram bot (`/missions` → "Mission KPIs") mirroring the web report.
- **Customer #0 page** (`/customer-0`): public-facing showcase of the reference customer "Elmahrosa International" mission, linking to its executive report. Both pages are `noindex`/disallowed in `robots.txt`.
- **Honest customer-facing output**: removed all `[simulated {provider} · {model}]` branding and fabricated "Confidence X%. Estimated impact: +Y%" lines from provider output. Customer-facing screens now show defensible values only; simulation details stay in internal telemetry.
- **Pipeline fixes**: negotiator discount now reads the real `maxDiscountPct` field; treasurer note is a commercial summary (company · product · amount · term · payment method); gatekeeper step runs between negotiation and closing; closing note is a pipeline-stage summary.
- **Clean pipeline flow**: 6-stage pipeline (Incoming → Research → Qualification → Proposal → Negotiation → Closing) with gatekeeper status and commercial contract surfaced in the bot pipeline screen.

### Verification

- 46/46 local suites, ESLint clean, syntax gate 234 files.

## v1.1.0-rc1 (2026-08-07)

### AI Revenue OS — Release Candidate 1

Conversational AI revenue operations layer on top of the v1.0.2 production platform.

- **Conversation router** with fast/slow path and intent detection (greeting, help, status, analytics, revenue, deals, knowledge search, talk-to-agent, diagnostics).
- **Universal agent registry** and live agent-run tracking.
- **Knowledge RAG** with shared-token relevance guard and Arabic/English handling.
- **Channel adapters and learning hook** for extensions.
- **RC1 validation tooling**: `scripts/rc1-prod-check.js` (16 assertions) and `scripts/rc1-convo-check.js` (22 assertions) run against the live database.
- **Operational hardening**: passive-mode keep-alive for `BOT_POLLING=0` instances; `/api/diagnostics` latency probe.

### RC1 verification (2026-08-07)

- 22/22 live conversation assertions, 16/16 live production data assertions, 45/45 local suites.
- `npm audit` 0 vulnerabilities; syntax gate 233 files.
- Customer #0 mission #26 "Sell TEOS DealMaker" completed 13/13; deal #15 active.

## v1.0.2-production (2026-08-05)

TEOS DealMaker ships as a production SaaS platform. Founder-only controls, strict commercial gating, and enterprise-grade operations are now in place.

### What's new

- **Founder Control Center** (`TEOS_FOUNDER_TELEGRAM_ID`) with 13 consoles, including new **Policy Engine**, **Analytics**, **Feature Flags**, and **Emergency Stop** panels.
- **Emergency Stop** halts every agent action and pipeline run platform-wide the moment it is engaged.
- **Feature Flags** let the founder disable capability families (Missions, Sales flow, Pipeline run, Intelligence, Integrations) with executor-level enforcement.
- **Founder permanent bypass**: the founder never hits billing, subscription, seat, agent, workspace, or quota gates.

### Operational changes

- **Commercial plans only**: Solo, Growth, Business, Enterprise. `free`/`trial` plans and `trial`/`trialing` statuses are migrated to `solo`/`pending` by `scripts/migrate-production.js` (idempotent, founder-protected, dry-run support).
- The public API and dashboards no longer expose internal execution modes.

### Deployment checklist

1. Run the migration: `node scripts/migrate-production.js` (preview with `--dry-run`).
2. Deploy from `main` on Railway.
3. Confirm `/api/health` returns HTTP 200.
4. Verify the founder Telegram bot shows "Control Center" with the full founder console set.

### License

Proprietary — Elmahrosa. All rights reserved.
