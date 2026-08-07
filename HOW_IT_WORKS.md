# How It Works — Production Freeze

Frozen production versions:

| Product | Version | Tag |
|---------|---------|-----|
| TEOS DealMaker | v1.0.2 Production | `v1.0.2-production` |
| TEOS Civic Mixer | v1.0.0 Production | `v1.0.0-production` |

---

## 1. TEOS DealMaker — v1.0.2 Production

An enterprise AI Revenue Operating System (Revenue OS): a policy-governed AI workforce that orchestrates the full revenue lifecycle, from prospect identification to deal closure.

### Flow

```
Telegram / Web UI / REST API
        │
   Mission Controller      → planning, human approvals, checkpoints, budgets
        │
   Workforce Runtime        → scheduler, dispatcher, executor, reviewer, recovery
        │
   Plugin Platform          → capabilities, policies, schemas, audits, permissions
        │
   MCP Layer                → external actions via TEOS Civic Mixer (MCP gateway)
        │
   Providers                → 8+ LLM providers with automatic fallback
        │
   Enterprise Platform      → tenants, entitlements, plans, RBAC
        │
   Intelligence (RAG)       → company-specific knowledge grounding
        │
   Integration Hub          → 17+ enterprise systems (CRM, email, calendar, storage)
        │
   Persistence              → multi-tenant PostgreSQL, workspace isolation
```

Every capability invocation is governed **before** execution:

```
Mission → Policy → Authorization → Entitlements → Plugin → Workforce → Agent → Provider → Memory + Audit
```

### v1.0.2 additions

- **Founder Control Center** (`TEOS_FOUNDER_TELEGRAM_ID`): 13 consoles — Policy Engine, Analytics, Feature Flags, Emergency Stop, and more.
- **Emergency Stop**: halts all agent actions and pipeline runs platform-wide instantly.
- **Feature Flags**: disable capability families (Missions, Sales flow, Pipeline run, Intelligence, Integrations) at the executor level.
- **Founder bypass**: the founder never passes through billing, subscription, seat, agent, workspace, or quota gates.
- **Commercial plans only**: Solo, Growth, Business, Enterprise. `free`/`trial` plans migrate to `solo`/`pending` via `scripts/migrate-production.js` (idempotent, founder-protected, dry-run supported).
- Public API and dashboards no longer expose internal execution modes.

### Operations

- Deploy from `main` on Railway (Nixpacks; `start:all`; `/api/health` probe).
- Database: Supabase PostgreSQL, TLS enforced, SQL column validation, append-only audit chain.
- Webhook and audit endpoints require signed auth.

---

## 2. TEOS Civic Mixer — v1.0.0 Production

Egypt's sovereign civic governance and accountability app: a badge-verified, ledger-style mixer. Every "mix" is an accountable, verifiable, logged event — **not** an anonymizing service.

### Flow

```
Web app (Next.js 16, EN/AR, mobile-first)
        │
   Transparency dashboard     → holders, supply, burned, locked, distribution
        │
   Wallet analysis            → single API route, mock-flagged data
        │
   Mixer backend (Python)     → badge-verified, receipt-logged mixes
        │
   Badge registry             → SHA-256 hashed badges
        │
   Vault logger               → Firebase (lazy init) + file locking
```

### How a mix works

1. A badge-gated request arrives.
2. `mixer.py` generates a unique `mix_id` (UUID v4) and a `mix_receipt_hash` (SHA-256) for the event.
3. The mix is written to the vault logger with file locking, keyed to the badge registry (hashed, never raw).
4. The receipt is returned; every mix is a permanent, auditable "resurrection shard."

### Governance & transparency

- Whale control framework: badge verification, accountability through transparency, passive monitoring, liquidity lock strategy.
- Governance proposals and votes are recorded off-chain and publicly viewable.
- Single API route (`/api/analyze-wallet`) explicitly returns `mock: true` on every response; all dashboard data is in-browser mock. No live anonymization is performed.

### Operations

- Build: Railpack pinned to Node provider.
- CI: `Python application` workflow on GitHub Actions (pytest + flake8); deploy from `main` on Railway.
- Copy and docs describe transparency and accountability, not privacy or anonymity.

---

## 3. Freeze Policy

- Both repositories are **frozen** at the tags above.
- **No new versions** unless a real customer requirement justifies the change.
- A justified change ships through a new patch/minor/major bump with release notes; the tag above always marks the exact frozen production state.
- Proposed changes require a written customer requirement before any version tag is created or moved.

---

## 4. Recommendation

1. Treat the two tags as the single source of truth for production.
2. Route every change request through: *customer requirement → justification → branch → PR → CI green → deploy → new tag*.
3. Do not redeploy from a moving `main`; deploy only from a tagged commit.
4. Keep the audit chain append-only; the mixer receipts are the proof of accountability.
