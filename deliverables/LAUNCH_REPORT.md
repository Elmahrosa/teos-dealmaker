# TEOS DealMaker — Launch Report (Governed 24/7 Operations)

- **Date:** 2026-08-10
- **Scope:** Final code-layer launch work: canonical product config, governed email config, founder ops report, deploy-verification routes, landing playground, dashboard ops console, bot parity. No new roadmap features were added.
- **This report is the STOP point for the launch order.** Engineering is complete; one deployment follow-up (a production DB migration) is explicitly listed below.

---

## RELEASE_COMMIT

- Commit: `57ce5c3` — `feat(dealmaker): launch governed 24/7 operations`
- Previous: `3526446` — `feat(dealmaker): add governed resend email channel`
- Pushed to `origin/main` (`Elmahrosa/teos-dealmaker`); local `main` == `origin/main`.

## DEPLOYMENT_STATUS

- **Method:** Railway auto-deploy from GitHub `main` (`railway.json` → `npm run start:all` → `scripts/prod.js` runs web + bot supervised). No railway/gh automation was added; push-to-main auto-deploy remains.
- **Live probes (2026-08-10):**
  - `GET /health` → `200` `{"status":"ok","service":"TEOS DealMaker","timestamp":...}`
  - `GET /api/health` → `200` (Railway healthcheck path)
  - `GET /` landing → `200` (playground banner, `Run a Demo Mission`, provider-agnostic hero EN + AR)
  - `GET /dashboard/` → `200` (Operations Console strip: `strip-service`, `strip-outbound`)
  - `GET /reports`, `GET /api/reports/latest` → `200`
  - `GET /api/pricing` → `200` canonical mapping (see DODO)
  - `GET /api/deploy-verify` → `401` without `AUDIT_API_KEY` (route exists; auth-gated as designed — existence-only booleans, never secret values)
  - `POST /webhook/resend` → `503` without signature (fail-closed as designed)
- **DEPLOYMENT FOLLOW-UP (founder action, one command):** `GET /api/outreach/status` currently returns `500`. Root cause: the production Postgres predates the outbound tables (`outbound_service_state`, `outbound_jobs`, `email_suppressions`, `resend_events`) — schema migration was never applied to the live DB. The DB itself is reachable (`/api/diagnostics` → `dbPingMs:65`). Remediation:
  ```
  DATABASE_URL=<prod> npm run db:migrate
  ```
  (`db:schema.sql` is idempotent — `CREATE TABLE IF NOT EXISTS`.) Until applied, `/api/outreach/status` is `500` and the 24/7 worker stays inert; it fails closed and never sends (OUTREACH=PAUSED, no sending risk).

## LANDING_PAGE

- Served from `server/landing.html` (self-contained; `server/render.js` renders placeholders server-side; no external assets).
- Hero is provider-agnostic: *"multi-provider AI, includes Anthropic Claude"* (EN + AR) — removed the "built on" exclusivity implication.
- Nav includes Playground; primary CTA is **Run a Demo Mission**.
- Cross-links Telegram bot (`https://t.me/TeosEgypt_bot`) and TEOS Sentinel (`https://sentinel.teosegypt.com`) — external cross-links only, no Sentinel checkout/pricing inside DealMaker.
- Bilingual EN/AR (playground strings verified live in AR).
- All product copy is single-sourced from `config/product.config.js` (name, tagline, capabilities, mission lifecycle, governance, integrations, Sentinel separation, demo behavior) shared with the bot.

## PLAYGROUND

- `#playground` section on the landing page, labeled **DEMO MODE — SIMULATED DATA** (verified live).
- Cards 01–06: Deal Brief · Stakeholder Analysis · Deal Simulation · Mission Controller (lifecycle PLAN → ANALYZE → SIMULATE → APPROVE → EXECUTE → REPORT) · Governance (ALLOW · WARN · REVIEW · BLOCK) · Mission Report preview.
- **Run a Demo Mission** runs a client-side simulation (700 ms phases, log lines, report preview). Nothing is sent: no external email, no Dodo checkout, no prospect contact, no real customer result.
- Bot mirrors it: `🎮 Playground / Demo` screen links to `{siteUrl}#playground`.

## TELEGRAM_BOT

- Runs via `scripts/prod.js` on the deploy (long-polling; one poller).
- Recommended navigation present on home: 🏠 DealMaker, 🎯 Missions, 🧠 Deal Intelligence, 🎮 Playground/Demo, 📊 Reports, 💳 Plans, 🛡 Governance, ⚙️ Settings, 🛑 Emergency Stop.
- `cc_playground` routed in `bot/menu.js` → `bot/screens/playground.js` (`buildPlayground`, bilingual, links to website playground).
- Bot pricing uses the canonical `config/pricing.config.js` — identical product to the website.
- Verified by the full callback-navigation characterization suite (960 assertions, including dead-button guard on `cc_playground`/`cc_missions` and role-aware home keyboards). Direct Telegram probing requires the founder (run `/start` from the founder Telegram id).

## REPORTS

- `GET /reports` → `200`; `GET /api/reports/latest` → `200` (live report #33 present).
- Mission report outbound section sanitized: `recipient` stripped from `last_sent` (`services/missionReport.js` `sanitizeOutboundActivity()`); counts/timestamps/provider ids retained.

## DODO

- `GET /api/pricing` verified live — canonical mapping: Solo `$99/$950` · Growth `$299/$2,990` · Business `$999/$9,990` · Enterprise **Custom** (no public checkout), with real Dodo checkout URLs (dodo.pe / checkout.dodopayments.com product links).
- Source of truth: `config/pricing.config.js` (also exported `SENTINEL_URL`). `server/render.js` serves it; no duplicated pricing blob in the API path.
- `DODO_API_KEY`/`DODO_WEBHOOK_SECRET` presence could not be confirmed from here (founder-gated: `GET /api/deploy-verify` requires `AUDIT_API_KEY`). `POST /webhook/dodo` is HMAC fail-closed by design.

## RESEND

- Canonical sender `info@elmahrosa.org` (`EMAIL_FROM`); default `RESEND_TIMEOUT_MS=15000`.
- `POST /webhook/resend` → `503` without signature (fail-closed; svix-style HMAC, idempotent by `event_id`).
- `RESEND_API_KEY` presence is founder-gated (same as DODO). Missing key ⇒ `health()` reports OUTBOUND BLOCKED; worker fails closed; `sendFounderOpsReport` returns `503 resend_not_configured` without ever attempting a send.
- `health()` and the public `/api/outreach/status` surface never leak the API key, the webhook secret, or `FOUNDER_REPORT_TO`.

## 24/7_WORKER

- `services/outboundWorker/index.js`: persistent DB queue (`outbound_jobs`), approval-required enqueue, provider-confirmed sends (`email.delivered` → `PROVIDER_CONFIRMED`), per-recipient cooldown, daily/hourly/queue limits, retries, suppression on bounce/complaint, heartbeat + `last_error` on `outbound_service_state`.
- **Default state PAUSED** (`outbound_service_state.state='PAUSED'`); only the founder can resume and only when `OUTREACH_ENABLED=true`. A new sender is never deployed RUNNING.
- `sendFounderOpsReport()` → founder destination only (`FOUNDER_REPORT_EMAIL=teosegy@gmail.com`; never a sender address); sanitized aggregate (states, counts, last 10 provider-confirmed ids, heartbeat, errors); audited `FOUNDER_OPS_REPORT`.
- Worker start is try/caught and fail-closed; a missing DB table cannot crash the web/bot processes (verified: tables absent in prod today, service still healthy).

## FOUNDER_CONTROLS

- `POST /api/outreach/pause` · `/resume` · `/emergency-stop` · `/founder-report` — all require `AUDIT_API_KEY`; `founder-report` → `503` when Resend not configured.
- `GET /api/deploy-verify` (auth-gated): existence-only env booleans + `revenue_path` (`CONFIRMED`/`NOT_CONFIRMED`) + `outbound` (`CONFIGURED`/`BLOCKED`). Never returns secret values.
- Ops dashboard (`/dashboard/`, `public/dashboard/index.html`) = **TEOS DealMaker — Operations Console**: SERVICE RUNNING / OUTBOUND PAUSED strip, founder controls, audit trail, live pricing (Enterprise "Custom deployment options (COMING SOON)" snapshot fixed).

## SENTINEL_SEPARATION

- TEOS Sentinel is a **separate product** (`https://sentinel.teosegypt.com`) cross-linked only; never sold or priced through DealMaker checkout.
- `server/sentinel.html` is a 312-line legacy dashboard template consumed only by `build-static.js` (not served as a route) — left unchanged, as instructed.

## SECURITY

- No secrets committed: `.env.example` canonicalized (`EMAIL_FROM=info@elmahrosa.org`, `FOUNDER_REPORT_EMAIL=teosegy@gmail.com`, legacy aliases commented); secret-scan of all new files clean.
- Fail-closed surfaces verified live: `/webhook/resend` 503, `/api/deploy-verify` 401 without key.
- `health()`/status never expose key, webhook secret, or founder-report destination (asserted in `tests/test-outbound-worker.js`).
- Legacy static artifact `hostinger/` remains tracked but stale — intentionally unchanged; documented here rather than modified.

## TESTS

- `npm test` → **57 suites, 57 passed, 0 failed** (includes `tests/test-outbound-worker.js`, 138 assertions, and `test-callback-navigation.js`, 960 assertions).
- `npm run lint` → clean. `npm run build` → 255 JS files pass `node --check`. `git diff --check` → clean.
- Server smoke test (local): `/health` 200, `/api/deploy-verify` auth-gated, landing 200, dashboard 200, founder-report 503 fail-closed.

## CUSTOMER_1

- **STATUS: NOT ACQUIRED.** No real prospect email, no Dodo payment, no checkout, no payment recorded.
- BI-Technologies remains QUALIFICATION=PASS, OUTREACH=PENDING / NOT SENT, OFFER/NOT_CREATED, CHECKOUT=NOT_CREATED, PAYMENT=NONE. No outreach was ever sent; the only founder-controlled internal test/report emails may be sent after production Resend is verified.

## REVENUE_PATH

- **STATUS: NOT CONFIRMED.** No verified real payment → Dodo webhook → persisted subscription/entitlement/audit yet.
- Code path is fail-closed and tested (webhook HMAC, entitlement, audit), but no live transaction evidence exists.

## GO/NO-GO

- **ENGINEERING GO-NO-GO: GO.** Full QA green; release committed and deployed; landing, playground, bot parity, dashboard console, reports, pricing, and fail-closed surfaces all verified live.
- **PRODUCTION GO-NO-GO: GO WITH ONE DEPLOYMENT FOLLOW-UP.** Apply the idempotent schema migration to the production DB (`DATABASE_URL=<prod> npm run db:migrate`) to enable `/api/outreach/status` and the 24/7 worker tables. Until then the worker is inert and fails closed.
- **REVENUE: NOT_CONFIRMED.** **OUTBOUND: PAUSED.** **CUSTOMER_1: NOT ACQUIRED.**
- **Operating discipline after this report:** outbound stays PAUSED until the founder (a) applies the DB migration, (b) verifies Resend in production, (c) explicitly enables `OUTREACH_ENABLED=true`, and (d) resumes via the operations console. BI-Technologies outreach is not part of this launch.
