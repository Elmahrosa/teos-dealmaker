# TEOS DealMaker v1.1.0 Launch Verification Checklist

## Final State
- **Branch**: `main`
- **Version**: `v1.1.0`
- **Commit**: `a66c053` (chore: add trust center and verified credly credential)
- **Production freeze**: ACTIVE
- **Trust integration**: APPROVED
- **Feature development**: STOPPED (proactive Telegram notifications preserved on `v1.2.0-notifications` branch)
- **Freeze exception**: localization (i18n) only, unfrozen for v1.2.0 AR coverage. No other scope unfrozen.

## Release Scope (approved for v1.1.0)
| Item | Status |
|------|--------|
| Trust Center integration (`https://elmahrosa.org/trust`) | KNOWN ISSUE — link returns HTTP 404 (see Verification Gate) |
| Verified Credly credential (Claude Partner Badge) | PASS |
| EN/AR trust/security/credential conversation intents | PASS |
| **AR screen coverage at v1.1.0** | **INCOMPLETE — only 5 of 18 bot screens were localized; 248 hardcoded English strings across the other 13** |
| Mission-as-a-Trial landing flow | PASS |
| Customer #0 (Elmahrosa International) | PASS |
| Dodo pricing/billing (Solo $99/$950 · Growth $299/$2,990 · Business $999/$9,990 · Enterprise custom) | UNCHANGED |
| Sentinel Shield · Policy Engine · Audit Trail | UNCHANGED |
| Executive Mission Reports (`/report/:planId`, `/customer-0`) | PASS |

## Verification Gate (2026-08-08 · figures re-verified 2026-09-26)
| Check | Result |
|-------|--------|
| `npm test` | PARTIAL — 84 suites, 83 passed, 1 failed. Sole failure is `test-link-audit`, an external-network check: `https://elmahrosa.org/trust` returns HTTP 404. Unrelated to this repo's code; not reproducible as a code defect. |
| `npm run lint` | PASS — 0 errors, 0 warnings across the repo (as of `54d8f78`). Caveat: this gate **could not be executed** before `54d8f78` because `@eslint/js` was declared but never installed; the earlier "PASS" was unverified. |
| `npm run build` | PASS — 313 JS files pass `node --check` |
| `npm audit --omit=dev` | PASS — 0 vulnerabilities |
| Landing page `/` | PASS — HTTP 200 |
| Trust Center link | **FAIL — HTTP 404.** Known open issue, NOT resolved. Reproduced independently of the test suite via `curl`. Owned outside this repository. |
| Credly badge link | PASS — HTTP 200 |
| Bot intents EN (trust/security/credentials/certification) | PASS — no `/start` fallback |
| Bot intents AR (الأمان/الثقة/الاعتمادات/الشهادات/هل النظام آمن؟) | PASS — no `/start` fallback |
| Mission/pricing flows | UNCHANGED |
| Customer #0 | UNCHANGED |
| No "Coming Soon" / "Demo" / placeholder output | PASS |
| No simulated branding in reports | PASS |
| Production branch clean | PASS |

## Launch Status
```
READY FOR PUBLIC LAUNCH — with one open external issue
```

**Justification**: Corrected as of 2026-09-26. The v1.1.0 claim "all verified checks pass, no blockers" was **not accurate**: the Trust Center link returns HTTP 404, and AR screen coverage was incomplete. The 404 is external to this repository and is tracked as a known issue above, not closed here. Test and lint figures above are the currently reproducible ones.

## v1.2.0 scope — Arabic (AR) screen coverage
Arabic is treated as required end-user coverage, not an optional nicety. This work closes the largest single gap in the 248-string backlog; the remaining 12 screens are **not** in scope for this change and remain English-only.

| Item | Status |
|------|--------|
| `bot/screens/missions.js` (58 hardcoded strings — largest gap) | DONE — 136 i18n keys added, EN + AR, 0 remaining hardcoded English UI strings |
| EN/AR dictionary parity | PASS — 495 keys each, 0 missing, 0 extra, 0 empty |
| Regression guard | `tests/test-missions-i18n.js` — 968 assertions |
| Remaining 12 screens (intelligence, integrations, ops, deals, providers, pipeline, workforce, learning, audit, admin, home, lib) | NOT STARTED — follow-up |

Known limitation carried forward: agent-facing model prompts in `missions.js` (the `runGoal` goal text and the Mission 2 / market-mission prompts) are intentionally **not** localized, because they are model input rather than UI copy and translating them would change runtime agent behaviour.

## Post-launch directives
- **Production freeze remains ACTIVE**, except for localization (i18n) work, which is unfrozen for v1.2.0 AR coverage.
- Proactive Telegram notifications are **v1.2.0** scope and have been parked on branch `v1.2.0-notifications` (commit `ddd9805`).
- Only production verification, reproducible bug fixes, security fixes, broken-link fixes, broken-routing fixes, and localization are permitted on `main`.
