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
| `npm test` | PARTIAL — 85 suites, 84 passed, 1 failed. Sole failure is `test-link-audit`, an external-network check: `https://elmahrosa.org/trust` returns HTTP 404. Unrelated to this repo's code; not reproducible as a code defect. |
| `npm run lint` | PASS — 0 errors, 0 warnings across the repo, re-verified at `1cec0b8` and re-run on the batch-2 i18n commit. Caveat: this gate **could not be executed** before `54d8f78` because `@eslint/js` was declared but never installed; the earlier "PASS" was unverified. |
| `npm run build` | PASS — 318 JS files pass `node --check` |
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
Arabic is treated as required end-user coverage, not an optional nicety. Work proceeds in explicitly scoped batches. The remaining 10 screens are **not** in scope for this change and remain English-only.

| Item | Status |
|------|--------|
| `bot/screens/missions.js` (batch 1) | DONE — 136 `ms_` keys, EN + AR, 0 remaining hardcoded English UI strings |
| `bot/screens/intelligence.js` (batch 2) | DONE — 43 `il_` keys, EN + AR, 0 remaining hardcoded English UI strings (empty allowlist) |
| `bot/screens/integrations.js` (batch 2) | DONE — 38 `int_` keys, EN + AR, 0 remaining hardcoded English UI strings (5 machine identifiers allowlisted) |
| `bot/screens/pipeline.js` (batch 3) | DONE — 31 `pf_` keys, EN + AR, 0 remaining hardcoded English UI strings (7 machine identifiers allowlisted) |
| `bot/screens/providers.js` (batch 3) | DONE — 33 `pv_` keys, EN + AR, 0 remaining hardcoded English UI strings (empty allowlist) |
| Shared global keys | DONE — 6 `common_` keys (`Back to Home`, `Cancel`, `No workspace`, `Provision a workspace first.`, `Yes`, `No`) introduced in batch 2 |
| EN/AR dictionary parity | PASS — 646 keys each, 0 missing, 0 extra, 0 empty. **See the dead-key follow-up below: ~130 of these 646 are dead, so this figure is not a coverage claim.** |
| Regression guard | `tests/test-screen-i18n.js` — 2020 assertions, covers all five screens |
| Remaining 8 screens (ops, deals, workforce, learning, audit, admin, home, lib) | NOT STARTED — follow-up |

Note on extraction counts: the earlier "58 hardcoded strings" figure for `missions.js` was an **undercount** from a regex that only caught `design.(it|b|code|textButton)('literal')`. Real extraction was 136 keys once `design.row` labels, `design.section` headers, `design.errorPanel` arguments, form-step labels, status ternaries and interpolated strings were included. Do not trust a single narrow regex when scoping the remaining screens.

Known limitations carried forward:
- Agent-facing model prompts in `missions.js` (the `runGoal` goal text and the Mission 2 / market-mission prompts) are intentionally **not** localized, because they are model input rather than UI copy and translating them would change runtime agent behaviour.
- The `/ask` model prompt is built in `services/intelligence.js`, not in the screen. It remains English and out of scope. `buildAskResult` in the screen is display-only and is fully localized.
- Connector API method names (`searchContacts`, `searchDeals`, …) and catalog field names (`keyEnv`, `baseUrl`, `defaultModel`) are machine identifiers, passed as arguments to translated format strings rather than translated themselves.
- Catalog-supplied data (connector labels, categories, document source labels) is English service data and renders untranslated in both languages. Translating it means translating the catalogs in `services/`, not the screens.
- **OPEN ITEM — `SOURCE_TYPES[].label` (`services/intelligence.js:5`) is deliberately NOT translated.** It is the largest remaining English surface reachable from the batch-2 screens: the 12 labels (`Pricing`, `Sales Conversations`, `Previous Proposals`, …) render in the Intelligence **SOURCES** list, as the per-document label in Documents, and in the **Add Knowledge** title, so an Arabic user still sees them in English. It is **not** a plain localization task, because the same labels are also **model input** — they are interpolated into `evidenceText`, which is sent to the LLM in the `/ask` prompt. Translating them therefore needs the same agent-behaviour judgment applied to the `missions.js` `runGoal` allowlist, not a blind string swap: it changes what the model reads, not just what the user sees. Deferred deliberately; requires an explicit decision before it is touched.
- `common_*` keys were introduced in batch 2 and are used by `intelligence.js` and `integrations.js`. `missions.js` still carries its own equivalent `ms_*` keys for the same strings; consolidating them is a cosmetic follow-up, not a defect.

## Post-launch directives
- **Production freeze remains ACTIVE**, except for localization (i18n) work, which is unfrozen for v1.2.0 AR coverage.
- Proactive Telegram notifications are **v1.2.0** scope and have been parked on branch `v1.2.0-notifications` (commit `ddd9805`).
- Only production verification, reproducible bug fixes, security fixes, broken-link fixes, broken-routing fixes, and localization are permitted on `main`.

## i18n dictionary follow-ups (recorded 2026-09-26 · not fixed in this pass)

Found while reviewing the batch-3 localization commit. Both are **pre-existing** (traced to `6324f0d`, not to the commit under review) and are recorded here rather than fixed, because both affect how the parity figure should be read.

### 1. ~130 dead keys inflate the EN/AR parity figure — **OPEN, cleanup needed**

- **Status**: OPEN. Real denominator **TBD** — needs a proper dead-key audit before the number can be stated.
- The headline "EN/AR parity 646/646 · 0 missing · 0 extra · 0 empty" is **arithmetically true but materially misleading as a strength claim.** Roughly **130 of the 646 keys (~20%) are never referenced anywhere outside `bot/i18n.js`.**
- Verified by spot-check: `onb_existing`, `qs_title`, `wl_title`, `nav_home`, `audit_title`, `danger_intro`, `help_items` all have **zero** references outside the dictionary itself.
- **Consequence**: the parity figure flatters the localization coverage. It proves the two dictionaries agree with each other; it does **not** prove 646 strings are reachable by a user, because a large share of the denominator is dead weight carried identically in both languages.
- **Follow-up needed**: a dead-key audit that resolves each of the 646 keys to a call site (or proves it orphaned), then either wire up the genuinely-intended keys or delete them. Until that runs, the real AR coverage denominator is unknown and should not be quoted from the 646 figure.
- Do not treat the 646/646 line as evidence of AR screen coverage. Screen coverage is tracked separately, in the v1.2.0 table above.

### 2. `lang_en` is untranslated in the AR dictionary — **OPEN, one-line fix**

- **Status**: OPEN. Deliberately **not** fixed in this pass.
- `bot/i18n.js` AR dictionary: `lang_en: 'English'` — identical to the EN value.
- Expected: `lang_en: 'الإنجليزية'`.
- **Impact**: low, but real and user-visible. The language picker shows an Arabic-speaking user the word "English" in the language they are currently reading in. This is the **only genuine untranslated string** among the 8 keys flagged in the batch-3 review.
- The other 7 flagged keys are **correct as-is and must not be "fixed"**:
  - `tz_utc`, `tz_utc2`, `tz_utc3`, `tz_utc5`, `tz_utc8` — timezone labels; translating them would be wrong.
  - `cmd_g_list`, `cmd_f_list` — literal slash commands (`/g_list`, `/f_list`); they are matched as literal input, so translating the label would desync the button from the command it sends.

### Review verdict for the batch-3 localization commit (`61c9c91`)

**PASS.** Independently recomputed rather than read from the commit message: 64 keys attributable to that commit (31 `pf_` + 33 `pv_`), EN 646 / AR 646, 0 missing, 0 extra, 0 empty, 0 placeholder mismatches, 0 untranslated and 0 dangling among the 64. No escaping regression was possible from it — it touched neither `design.js`, `lib.js`, nor `intelligence.js`. Neither `pipeline.js` nor `providers.js` makes model calls, so the allowlist-vs-translate judgment is moot for both.
