# Technical Debt Report

Current as of v1.0.2-production (commit eb6a518). Earlier debt items (missing agents directory, no CI/CD, no rate limiting, dependency vulnerabilities) are **resolved**; this report reflects the remaining and newly identified items.

## Remaining Items

### 1. Plugin signing (Medium)
- Plugins are loaded from the local filesystem via `require()` with full Node privileges (`services/plugin-manager/loader.js`). Any plugin passing manifest validation runs arbitrary code.
- Impact: a compromised or untrusted plugin directory is equivalent to remote code execution.
- Suggested fix: Implement plugin signing/verification (public-key signature over the plugin manifest + entries) and load plugins only from a trusted root. This is already on the platform roadmap.

### 2. Live-DB test coverage in CI (Medium)
- `tests/phase25-supabase.js` and `tests/phase25-live.js` require `DATABASE_URL` and are skipped when it is unset; CI does not provide one.
- Impact: database-backed behaviors are not continuously verified.
- Suggested fix: Add a Postgres service container to CI and run the live suites against it (with a throwaway schema), or run them manually against staging before every release.

### 3. OpenAPI/Swagger documentation (Low)
- The HTTP API (`/api/pricing`, `/api/health`, `/api/audit`, `/webhook/dodo`) has no OpenAPI spec.
- Impact: hampers client integration and automated contract testing.
- Suggested fix: Generate an OpenAPI 3 spec from the Express routes or write one manually.

### 4. Containerization (Low)
- No Dockerfile / docker-compose present.
- Impact: environment drift between local and production.
- Suggested fix: Add a Dockerfile (non-root user, read-only root fs) and a compose file with Postgres for local development.

### 5. Centralized logging (Low)
- Logging mixes `console.*` and the file-based audit logger; no structured logging library.
- Impact: harder log aggregation and correlation at scale.
- Suggested fix: Adopt a structured logger (pino/winston) with levels and sinks; keep the audit vault separate.

### 6. Observability/metrics (Low)
- Telemetry exists for agent runs and there is a health endpoint, but no Prometheus/Grafana export or distributed tracing.
- Suggested fix: Export key metrics (request latency, error rates, agent performance) via OpenTelemetry; this is on the platform roadmap.

### 7. Memory adapter transaction semantics (Low)
- `transaction(fn)` in the in-memory adapter simply calls `fn(null)` (`db/adapter.js`) — rollback is not simulated.
- Impact: code relying on rollback semantics could behave differently under the memory adapter (tests only).
- Suggested fix: Document the limitation or implement snapshot/rollback in the memory adapter.

### 8. Audit vault is not physically immutable (Low)
- The file-backed vault detects tampering via hash chain but can be deleted or truncated by a process with write access.
- Suggested fix: Enforce filesystem write protection on `data/vault`, rely on the Postgres mirror as the durable store, and/or ship the vault to immutable object storage.

### 9. Default customer email placeholder (Low)
- `utils/dodoPayments.js` uses `buyer@example.com` when no email is supplied to a checkout link.
- Impact: checkout links can be created with a placeholder address.
- Suggested fix: Require an email at the call site or omit the customer field.

## Summary
No high-severity technical debt remains. Priorities: plugin signing, live-DB CI coverage, and containerization. The remaining items are operational hardening and are largely covered by the existing roadmap.
