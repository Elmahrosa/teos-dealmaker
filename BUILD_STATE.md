# BUILD STATE

## Current Version
- Release: v1.0.2-production
- Latest commit: eb6a518 (feat(release): v1.0.2-production — founder controls, commercial plans, enterprise hardening)
- Current branch: main
- Working tree: clean

## Verification Status
- Lint (`npm run lint`): PASS (0 errors)
- Test suite (`npm test`): PASS — 41 suites, 41 passed, 0 failed
- Dependency audit (`npm audit`): 0 vulnerabilities
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
