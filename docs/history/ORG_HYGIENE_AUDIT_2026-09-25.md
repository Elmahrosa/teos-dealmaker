# Org Hygiene — Deep Audit & Remediation Record

**Date:** 2026-09-25 · **Repo:** teos-dealmaker · **Org:** Elmahrosa International

## Context
Senior-dev deep audit of the Elmahrosa GitHub org (87 repos; 43 active / 44 archived)
and the teos-dealmaker root, conducted against the TEOS VAP-Engine Royal Mandates
(hard rules: gatekeeper, honest status, security-first, token thrift).

## Findings (audit)

| Area | Finding | Severity |
|---|---|---|
| README | Claimed "Live now · v1.1.0 · 59/59 test suites" — stale (83/83 today) and release not yet deployed | Medium (honest reporting) |
| STATUS.md | Stale snapshot (2026-09-12, HEAD `f1226c9`, 79/79) vs release state (`0c12899`, 83/83) | Low |
| package.json | Mandates require `npm run verify` / `preflight` / `smoke` — scripts did not exist | Low (process) |
| Org branch protection | No branch protection on any public repo; no org rulesets | High (process) |
| Secret exposure | Spot scan of focused repo trees + tracked-file pattern scan: clean; `npm audit --omit=dev`: 0 vulns | OK |
| `teos-vap-engine` | Repo archived (default branch `mine`) while its mandates are active doctrine | Decision pending |
| Re-tagging | Do NOT re-tag `v1.1.0-production` until the release deploy is observed live | Held |

## Remediation applied

1. **README.md** — removed the unverified "Live now" claim; refreshed verification table
   (83/83 · 316/316 · lint 0 · transparency 15/15 · audit 0); documented that live-deploy
   verification is pending before `LIVE` is declared.
2. **package.json** — added the mandate-required aliases (zero new dependencies):
   - `verify` → `npm test && npm run lint && npm run build && npm run transparency:check`
   - `preflight` → `npm run lint && npm run build && npm run transparency:check`
     (env-free by design; `bot-token-check` is run separately where `.env` exists)
   - `smoke` → `npm run verify`
3. **STATUS.md** — refreshed to the new release HEAD with current gate numbers and the
   standing release-gate status (deploy pending Railway billing settlement).
4. **GitHub org** — enabled branch protection (required up-to-date checks, linear history,
   force-push/deletion blocked, admins enforced) and secret scanning + Dependabot alerts on
   the org's public repositories (free tier). Private repos: branch protection via the API
   is unavailable on the current plan (GitHub 403 "Upgrade to GitHub Pro") — documented,
   not forced.

## Standing release-gate status (unchanged)
- Code: **APPROVE** — all gates green at `main` (release `0c12899` + this hygiene commit).
- Deploy: **BLOCKED AT GATE 4** — Railway account on billing hold; post-payment runbook in
  `deliverables/SECURITY_REMEDIATION_REPORT.md` §14.
- **NOT LIVE** — declared only after the deployed app is observed healthy on the new revision.