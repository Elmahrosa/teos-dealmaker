# Changelog

All notable changes to TEOS DealMaker are documented here.

## [1.0.2] — 2026-08-05

### Production SaaS Release

- **Commercial plans only**: workspaces `plan` now defaults to `solo`. Free and Trial are gone; subscriptions in `free`/`trial` migrate to `solo`, and `trial`/`trialing` statuses migrate to `pending`.
- **Founder permanent bypass**: the founder (identified solely by `TEOS_FOUNDER_TELEGRAM_ID`) is exempt from subscription, seat, agent, workspace, and quota enforcement. Billing webhooks never modify a founder workspace.
- **Founder Control Center consoles**: System Mode, Approval Mode, Billing, Workspaces, Customers, Revenue, Debug, Enterprise Ops, Sentinel Shield, Policy Engine, Analytics, Feature Flags, and Emergency Stop.
- **Emergency Stop**: a global kill-switch that halts every agent execution and pipeline run instantly.
- **Feature Flags**: founder-only toggles for Missions, Sales flow, Pipeline run, Intelligence, and Integrations; disabled capabilities are skipped at the executor.
- **Policy Engine console**: fail-closed governance visibility (policy engine, RBAC, entitlements, capability gate, decision audit).
- **Production migration**: `scripts/migrate-production.js` — idempotent, founder-protected, dry-run support, fully logged.
- **Live-product messaging**: public consoles and landing pages never surface internal execution modes (`DRY`/`LIVE`); `/api/health` reports `live`/`operational`.
- **Enterprise readiness**: CSP security headers, rate limiting (API 120/min, webhook 30/min), HMAC webhook verification, security-audit logs.
- **Terminology alignment**: "demo" legacy references replaced with production wording ("schedule a call", "Test Entity"); `runPipelineDemo` renamed `runPipeline`; "Control Center Demo" renamed "Control Center Run".
- **Verification**: 41/41 test suites, ESLint clean, `node --check` on all files, i18n parity verified.

## [1.0.0] — earlier

- Core AI sales workforce: 13 agents (prospecting, qualification, outreach, strategist, market intelligence, negotiator, treasurer, closing, gatekeeper, marketer, sales, orchestrator, revenue strategist).
- Mission Center, Approval flow, Workforce Console, Pipeline, Deals, Executive Briefing, Costs, Audit Log, Company Intelligence.
- Multi-tenant workspaces with identity, entitlements, and Dodo checkout billing.
- Telegram bot (EN/AR) and public dashboard.
