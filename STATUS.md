# STATUS — teos-dealmaker

Verified operational state, assembled from direct commands run in the repo session on 2026-09-25.

## Head

- **Branch**: `main`
- **HEAD**: `d85ff06` (chore: apply org-hygiene change-set — honest README claims, verify/preflight/smoke aliases, audit record)
- **Release commit**: `0c12899` (security: close residual findings 8, 10, 14) — contained in `main`
- **Sync**: 0 ahead / 0 behind `origin/main` (after push)
- **Working tree**: clean except `deliverables/NEVER_TOUCH_AUDIT.md` (uncommitted reference, by design)

## Quality gates (run this session, all `EXIT=0`)

| Gate | Command | Result |
| --- | --- | --- |
| Tests | `npm test` | 83/83 suites passed |
| Lint | `npm run lint` (`eslint .`) | clean |
| Syntax build | `npm run build` | 316/316 JS files pass `node --check` |
| Transparency | `npm run transparency:check` | 15/15 checks passed |
| Audit (prod deps) | `npm audit --omit=dev` | 0 vulnerabilities |
| Mandate aliases | `verify` / `preflight` / `smoke` | defined in package.json (zero new deps) |
| Push | `git push origin main` | pushed (pre-push transparency hook passed) |

## Release-gate status (standing)

- **Code: APPROVED** — migration 016 (production) and `TRUST_PROXY` (Railway) confirmed by
  the operator; merged to `main` at `0c12899`, pushed, CI green on the commit.
- **Deploy: BLOCKED AT GATE 4** — Railway account on billing hold. Post-payment runbook and
  deployed-revision fingerprints: `deliverables/SECURITY_REMEDIATION_REPORT.md` §14.
- **LIVE: NOT DECLARED** — declared only after the deployed app is observed healthy on the
  new revision (fingerprints: `/reports`, `/customer-0`, `/api/reports/latest` → 401/403;
  new thanks page; fresh `railway-app[bot]` deployment record for the release commit).

## Tags present

- `phase-2-deal-simulation-final`, `phase-2-deal-simulation-freeze`
- `v0.8.0`, `v0.8.1`, `v0.8.1-recovery`
- `v0.9.0-architecture-foundation`
- `v1.0.1`, `v1.0.1-production`, `v1.0.1-security`, `v1.0.1-static`
- `v1.0.2-production`
- `v1.1.0-production` (points at a pre-release commit — will be re-pointed only after the
  release deploy is observed live; no re-tag before then)

## Not present / unverified

- Tag **`qss-a3-locked`**: does not exist (`git tag -l` shows no such tag).
- File **`A3_FOUNDER_SIGN_OFF.md`**: does not exist (repo-wide search found nothing outside `node_modules`).
- A "quantum-safe stack (QSS)" / A3 sign-off narrative has been relayed in prior sessions but **no evidence for it exists in this repo**. Treat as ungrounded until a real source/spec is provided.

## Hygiene

- Pre-push transparency hook installed and active (authenticated pre-push run).
- `.env` is local-only and gitignored; only `.env.example` is committed.
- Org-wide audit + remediation record: [`docs/history/ORG_HYGIENE_AUDIT_2026-09-25.md`](ORG_HYGIENE_AUDIT_2026-09-25.md).