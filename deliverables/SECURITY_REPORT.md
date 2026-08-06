# Security Report

Current as of v1.0.2-production (commit eb6a518) with the hardening pass applied. This report supersedes the earlier draft.

## Summary of Findings

| Area | Status |
|------|--------|
| Secrets management | Appropriate — `.env` gitignored, only `.env.example` tracked, no secrets in history |
| Webhook signature verification | Fixed — fails closed when `DODO_WEBHOOK_SECRET` unset |
| Audit endpoint access | Fixed — `/api/audit` requires `AUDIT_API_KEY` (fail-closed) |
| Database TLS | Fixed — certificate verification enabled by default |
| SQL injection resistance | Good — parameterized queries + column whitelists (including where-clauses) |
| Dependency vulnerabilities | 0 (`npm audit`) |
| Authentication / authorization | Bot is Telegram-ID based; public API is read-only marketing + health |
| Input validation | Partial — see note below |
| Audit trail integrity | Improved — hash-chained vault with `verifyVault()` |
| Runtime/container security | Not applicable yet — no containerization (see TECHNICAL_DEBT) |

## Details

### 1. Environment Variables and Secrets Management — Appropriate
- Secrets are read from environment variables (`.env`), which is gitignored.
- Only `.env.example` is tracked; git history contains no `.pem`, `.key`, vault files, or API keys.
- Recommendation: use a secrets manager (HashiCorp Vault / AWS Secrets Manager) in production.

### 2. Webhook Signature Verification — Fixed
- `services/billing/index.js` now returns `{ ok: false }` with `reason: 'webhook_secret_not_configured'` when `DODO_WEBHOOK_SECRET` is unset. Previously it accepted unsigned requests when the secret was missing (fail-open). Signed requests are compared with `crypto.timingSafeEqual`.

### 3. Audit API Exposure — Fixed
- `server/index.js` now protects `/api/audit` with a constant-time `X-API-Key` check against `AUDIT_API_KEY`. The endpoint returns 503 until the key is configured, so sensitive audit data is never served without configuration. `/api/pricing` and `/api/health` remain public per the marketing/ops contract; health exposes only status, mode (masked), and an entry count.

### 4. Database Connection Security — Fixed
- `db/pool-config.js` now enables `ssl.rejectUnauthorized` (certificate verification) by default for Postgres/Supabase. Disabling requires an explicit `PG_REJECT_UNAUTHORIZED=false` for trusted private CAs only.

### 5. SQL Injection Resistance — Good
- All queries are parameterized. Column names are validated against the schema for inserts, updates, and where-clauses (`db/adapter.js`); order-by columns are whitelisted. An unknown column in a where-clause throws rather than being interpolated.

### 6. Authentication and Authorization — Appropriate for current surface
- Bot commands are authorized by Telegram user ID via `bot/access.js` (founder/admin roles). The public REST surface exposes only read-only marketing/health endpoints; the payment webhook is HMAC-signed.
- Note (intentional): any ID in `TELEGRAM_ADMIN_IDS` is treated as founder-equivalent in the bot. Confirm this list is restricted to fully trusted operators.

### 7. Input Validation and Sanitization — Partial
- User input is validated in specific handlers but there is no centralized validation layer. Bot inputs flow into prompts and workspace data.
- Risk: Low–Medium (prompt-injection surface for agent tasks).
- Recommendation: add a schema validation layer for all user-facing inputs and treat any data destined for an LLM or external system as untrusted.

### 8. Dependencies — 0 vulnerabilities
- `npm audit` reports 0 known vulnerabilities.

### 9. Communication Security — Appropriate
- Telegram Bot API and MCP gateway are HTTPS. Deploy the Express server behind TLS (reverse proxy) in production.

### 10. Audit Logging — Improved
- The file vault is SHA-256 hash-chained; `verifyVault()` detects any edit to a historical entry. Entries are mirrored to Postgres when `DATABASE_URL` is set.
- Residual: the file can be deleted by a privileged process; keep `data/vault` write-protected and rely on the DB mirror / immutable storage for durability.

### 11. Error Handling — Acceptable
- The Express server returns generic `internal_error`/`not_found` to clients and logs details server-side. The webhook returns safe error codes (401/400/500) without leaking internals.

### 12. Runtime Security — Pending containerization
- No Docker/K8s assets yet. When containerizing, run as non-root, drop capabilities, and use a read-only root filesystem (see TECHNICAL_DEBT.md).

## Priority Actions
1. Configure `AUDIT_API_KEY` and `DODO_WEBHOOK_SECRET` in production (both are fail-closed until set).
2. Restrict `TELEGRAM_ADMIN_IDS` to trusted operators.
3. Add input-validation for user-facing bot inputs.
4. Add plugin signing and containerization (roadmap).
