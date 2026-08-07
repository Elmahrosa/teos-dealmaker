# BUILD STATE

## Current Version
- Release: v1.1.0-rc1 (AI Revenue OS)
- Latest commit: ced8dd3 (fix(rc1): BOT_POLLING=0 guard for passive/staging instances; live convo-check data-aware assertions)
- Current branch: feat/v1.1-ai-revenue-os
- Working tree: clean (after RC1 commit)

## Verification Status
- Lint (`npm run lint`): PASS (0 errors)
- Test suite (`npm test`): PASS — 45 suites, 45 passed, 0 failed
- RC1 live prod check (`scripts/rc1-prod-check.js`): 16/16 PASS
- RC1 live conversation check (`scripts/rc1-convo-check.js`): 22/22 PASS
- Dependency audit (`npm audit`): 0 vulnerabilities
- Syntax gate (`npm run build`): 233 JS files pass
- CI: `.github/workflows/ci.yml` — install → build → lint → test (Node 20/22) on push/PR

## Security Hardening Applied
- Webhook signature verification now fails closed when `DODO_WEBHOOK_SECRET` is unset (`services/billing/index.js`)
- `/api/audit` protected by `AUDIT_API_KEY` (fail-closed; 503 until configured) (`server/index.js`)
- PostgreSQL TLS certificate verification enabled by default (`db/pool-config.js`, opt-out via `PG_REJECT_UNAUTHORIZED=false`)
- SQL where-clause column whitelist enforced to prevent column-name injection (`db/adapter.js`)
- Audit vault now hash-chained (SHA-256) with `verifyVault()` for tamper detection (`utils/auditLogger.js`)
- `/api/health` uses a cheap line count instead of parsing the full vault
- Trust proxy hop count configurable via `TRUST_PROXY` (`server/index.js`)

## Completed Capability Baseline
- 13 production agents (prospector, researcher, qualifier, revenue strategist, strategist, marketer, sales, negotiator, treasurer, gatekeeper, orchestrator, closing, intelligence)
- Mission Controller (planning, approval gates, lifecycle, checkpoints, budget enforcement)
- Workforce Runtime (planner, scheduler, dispatcher, executor, reviewer, approvals, confidence, optimizer, recovery, telemetry)
- Plugin Platform (manifest contract, permissions, lifecycle, dependency resolution) with Civic Mixer + Sentinel Shield plugins
- MCP Layer (transport-agnostic; simulated when disabled)
- Enterprise Platform (tenants, entitlements, RBAC authorization, policy engine, founder bypass)
- Dodo Payments integration (HMAC webhook, plan mapping, founder protection)
- Production web server (landing page, dashboard, security headers, rate limits)

## Known Notes
- `phase25-supabase`/`phase25-live` suites require `DATABASE_URL` and are skipped in CI; run manually against a staging database before release.
- The file-backed audit vault detects tampering via hash chain but cannot prevent file deletion; keep `data/vault` write-protected in production.
