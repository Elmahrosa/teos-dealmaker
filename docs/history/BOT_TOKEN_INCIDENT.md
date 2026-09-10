# BOT TOKEN INCIDENT — Railway 2026-09-10

## Summary

The TEOS DealMaker Telegram bot (`@TeosEgypt_bot`) was non-functional on Railway for the duration of a multi-hour incident. The root cause was a single stale variable: `TELEGRAM_BOT_TOKEN` in Railway's production `web` service never received a rotated value. The bot booted, reached Telegram, and was rejected (`Unauthorized`) on every poll. No callbacks, no messages, no `/start` replies. The bot code itself was fully functional throughout — this was a config/deploy gap, not a code defect.

## Root Cause

- `TELEGRAM_BOT_TOKEN` in Railway Variables held an old, revoked value (the original first rotation `AAEDL5T…`).
- After the founder rotated the bot token via BotFather, the new token was saved to the gitignored `.env` on the local machine but was never written into Railway Variables.
- `config/mode.js` reads `process.env.TEOS_MODE || 'DRY'`, defaulting to `DRY` — so the bot was also operating in DRY mode, masking full impact during testing.
- `railway.json` start command `npm run start:all` runs both `web` and `bot` via `scripts/prod.js` as supervised children; no separate worker service was needed.

## Timeline

| When | Event |
|------|-------|
| Earlier session | First token rotation (`AAEDL5T…` → `AAG0urm…` → `AAH9-2rq…`). Code pushed (`1dd1c35`, `365e9de`). Landing page fixes pushed (`337c1ee`, `04b6231`). Railway Variables still holds old value. |
| Sep 10 — start of incident diagnosis | 2 queued callback updates drained when bot run locally; pending_update_count 0 after local poll. Railway confirmed not polling new token (no 409). |
| Sep 10 — `railway variables --json` masked read | `TELEGRAM_BOT_TOKEN` key present in Railway, value passes `getMe` ok: false (`Unauthorized`). `TEOS_MODE: LIVE`. |
| Sep 10 — founder dumps full Railway variable export into chat | `TELEGRAM_BOT_TOKEN 8148505959:AAELx…` (no `=` — malformed variable name). Other secrets also in dump (see Leaked Secrets below). |
| Sep 10 — `railway variable set TELEGRAM_BOT_TOKEN --stdin` | Set the current value from the founder's dump. `getMe ok: true` confirmed. Old `web` service crash-looped (`TELEGRAM_BOT_TOKEN is not set` → restart loop). |
| Sep 10 — `railway deployment redeploy --yes` | Fresh deploy of `04b6231` with corrected env. `[TEOS DealMaker Bot] polling (mode: LIVE)` confirmed. |
| Sep 10 — 409 Conflict appears | Second poller detected. Investigated: `production/teos-civic-mixer` has a `TELEGRAM_BOT_TOKEN` in its own env. Logged, not modified. |
| Sep 10 — founder confirms live | `/start` replies, Founder Control Center menu responsive. `deleteWebhook` deprecation warning in logs (cosmetic). |

## Code Pushed During Incident

All fixes were pushed to `main` and deployed; none were related to the root cause (which was a config gap):

| Commit | What |
|--------|------|
| `1dd1c35` | `fix(bot)`: callback buttons always visibly respond — `editPanel` sendMessage fallback + callback error fallback |
| `365e9de` | `ops`: gate production mode loudly — `scripts/prod.js` warns if `TEOS_MODE != LIVE`; `.env.example` production contract note |
| `337c1ee` | `fix(landing)`: hero CTA above fold, evidence section, FAQ/legal footer, pricing bullets |
| `04b6231` | `ops`: add `scripts/bot-token-check.js` — validates `TELEGRAM_BOT_TOKEN` from `.env` via Telegram API, never echoes the token |

## Secrets Exposed in Chat

The founder exported the full Railway variable dump into the conversation transcript. All of the following are now in the session log and must be treated as compromised:

| Secret | Severity | Status |
|--------|----------|--------|
| `TELEGRAM_BOT_TOKEN` (current: `AAELx…`) | HIGH — bot control | Rotated 4th time; needs 5th rotation |
| `DATABASE_URL` (Postgres password in plaintext) | HIGH — production data | **Pending rotation** |
| `DODO_API_KEY` | HIGH — billing/payment API | **Pending rotation** |
| `DODO_WEBHOOK_SECRET` | MEDIUM-HIGH — webhook integrity | **Pending rotation** |
| `AUDIT_API_KEY` | MEDIUM — scoped audit API (limited blast radius per `5ba3bf9`) | **Pending rotation** |

All values also appeared in Railway CLI `variables --json` masked output during diagnostics, though values were not echoed in the final session.

## Standing Rules Established

1. **Railway Variables field is the only place the token lives** — never in `.env` (placeholder by default), never in chat, never in a local file.
2. **`npm run bot-token-check`** reads `.env` via Telegram API — validates without echoing; `.env` is empty/placeholder by default.
3. **BotFather → Railway directly** — any token path that includes a chat tool is a leak vector.
4. **Rotate all exposed secrets** in one pass — DB password, Dodo API key, Dodo webhook secret, audit API key — when convenient; none block production.

## Second Poller — `teos-civic-mixer`

`production/teos-civic-mixer` has a `TELEGRAM_BOT_TOKEN` set (value not checked for equality). During the fix sequence, `409 Conflict: terminated by other getUpdates request` appeared in `web` service logs. Confirmed live after deploy despite the 409; `teos-civic-mixer` was not modified (different service, not our responsibility). Owner should audit whether civic-mixer should hold this token at all, or whether it should use its own.

## Verification (post-fix)

- `npm run bot-token-check`: `getMe ok: true | username: TeosEgypt_bot`
- Railway `web` service production: `TELEGRAM_BOT_TOKEN` valid, `TEOS_MODE=LIVE`, `BOT_POLLING=1`
- Phone test: `/start` → Founder Control Center menu renders; context buttons (Approve/Cancel/Status/Fix error) responsive
- `GET https://dealmaker.elmahrosa.org/api/health` → `200`, `mode: live`
- Git working tree clean; `main` = `04b6231`, pushed to `origin/main`
- Test suite: 74/74 passed (pre-deploy)

## Pending Follow-Up

- [ ] Rotate Postgres `DATABASE_URL` password → update Railway + `.env.example`
- [ ] Rotate `DODO_API_KEY` → update Railway
- [ ] Rotate `DODO_WEBHOOK_SECRET` → update Railway
- [ ] Rotate `AUDIT_API_KEY` → update Railway + `bot/screens/founder.js` if referenced
- [ ] 5th bot token rotation via BotFather → update Railway only (no chat, no local file)
- [ ] Audit `teos-civic-mixer` token ownership
- [ ] `railway.json` deprecation warning — migrate to Infrastructure-as-Code (`.railway/railway.ts`) before 2026-12-01
