// bot/screens/missions.js localization test.
//
// Arabic is required end-user coverage, and missions.js was the largest
// untranslated screen. This pins the extraction so it cannot silently regress:
//
//   1. EN/AR key-set parity across the WHOLE dictionary (0 missing / 0 extra),
//      the same key-set diff used for the original 359-key audit.
//   2. Every ms_ key added for missions.js exists in AR with a non-empty value.
//   3. Format-safety: the %s placeholder count in AR equals EN for every ms_
//      key, so an Arabic string can never drop or reorder an interpolation.
//   4. Every ms_ key whose EN copy is real prose has Arabic script in its AR
//      value, so a key can never be "added" with the English text copied over.
//   5. missions.js contains zero remaining hardcoded English UI strings. The
//      only ASCII-bearing literals left must be exactly the documented
//      agent-facing allowlist (model input) and audit event identifiers.

'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || '';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { LANGS, t } = require('../bot/i18n');

const MISSIONS = path.join(__dirname, '..', 'bot', 'screens', 'missions.js');

// Model input, deliberately English: these strings are fed to the runtime
// agent, not rendered to the user. Translating them would change agent
// behaviour rather than presentation. Each is annotated in missions.js.
const AGENT_FACING = [
  'Mission: ${mission.name}',
  'Target customer: ${mission.customer}',
  'Target market: ${mission.market}',
  'Expected revenue: ${mission.revenue}',
  'Deadline: ${mission.deadline}',
  'Notes: ${mission.notes}',
  'Run a full revenue pipeline for our target accounts: prospect, qualify, engage, propose and close deals for our known products.',
  'Analyze our target market: research the market, competitors, ideal customers and opportunity, then recommend where to focus.'
];

// audit.writeEntry action names: stable machine identifiers, not UI copy.
const AUDIT_EVENTS = [
  'BOT_MISSION_CREATE',
  'BOT_MISSION1_RUN',
  'BOT_MISSION1_ERROR',
  'BOT_MISSION2_RUN',
  'BOT_MISSION_MARKET',
  'BOT_MISSION_GOAL'
];

const countPlaceholders = s => (String(s).match(/%s/g) || []).length;

(async () => {
  let n = 0;
  const check = (cond, msg) => { assert.ok(cond, msg); n += 1; };

  // ---- 1. whole-dictionary EN/AR key-set parity -------------------------
  const enKeys = Object.keys(LANGS.en);
  const arKeys = Object.keys(LANGS.ar);
  const arSet = new Set(arKeys);
  const enSet = new Set(enKeys);
  const missing = enKeys.filter(k => !arSet.has(k));
  const extra = arKeys.filter(k => !enSet.has(k));
  check(missing.length === 0, `every EN key has an AR value (missing: ${JSON.stringify(missing)})`);
  check(extra.length === 0, `AR has no keys absent from EN (extra: ${JSON.stringify(extra)})`);
  check(enKeys.length === arKeys.length, `EN/AR key counts match (${enKeys.length} vs ${arKeys.length})`);

  // ---- 2. every ms_ key resolves, non-empty -----------------------------
  const msKeys = enKeys.filter(k => k.startsWith('ms_'));
  check(msKeys.length > 0, `missions.js keys were added (found ${msKeys.length} ms_ keys)`);
  for (const key of msKeys) {
    check(arSet.has(key), `AR defines ${key}`);
    const val = LANGS.ar[key];
    check(typeof val === 'string' && val.trim().length > 0, `AR ${key} is a non-empty string`);
  }

  // ---- 3. format-safety: placeholder counts preserved -------------------
  for (const key of msKeys) {
    const en = countPlaceholders(LANGS.en[key]);
    const ar = countPlaceholders(LANGS.ar[key]);
    check(en === ar, `${key} keeps its %s placeholder count in AR (EN ${en}, AR ${ar})`);
  }

  // ---- 4. real prose in EN => real Arabic in AR -------------------------
  const ARABIC = /[؀-ۿ]/;
  for (const key of msKeys) {
    if (!/[A-Za-z]{3}/.test(LANGS.en[key])) continue; // format-only, e.g. '%s: %s'
    check(ARABIC.test(LANGS.ar[key]), `${key} is translated to Arabic, not copied English`);
  }

  // t() must resolve every ms_ key without falling through to the raw key
  // name (an unknown user resolves to EN, which is the fallback path).
  for (const key of msKeys) {
    check(t('i18n-probe-user', key) === LANGS.en[key], `t() resolves ${key} to a real EN value`);
    check(LANGS.en[key] !== key, `EN ${key} is not an unresolved passthrough`);
    check(LANGS.ar[key] !== key, `AR ${key} is not an unresolved passthrough`);
  }

  // ---- 5. zero remaining hardcoded English UI strings in missions.js ----
  let src = fs.readFileSync(MISSIONS, 'utf8');
  // strip comments so apostrophes in prose cannot desync the quote scan
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const literals = [];
  const re = /'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(src))) literals.push(m[1] !== undefined ? m[1] : m[2]);

  const allowed = new Set(AGENT_FACING.concat(AUDIT_EVENTS));
  const unaccounted = [];
  for (const raw of literals) {
    const lit = raw.trim();
    if (!lit) continue;
    // i18n keys, callback data, require paths, enum-ish values
    if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(lit)) continue;
    if (lit.startsWith('cc_')) continue;
    if (lit.startsWith('.') || lit.startsWith('/')) continue;
    if (/^[a-z0-9_]+$/.test(lit)) continue;
    // pure composition: nothing but ${...} interpolation, escape sequences
    // (\n and friends are not English text), punctuation and digits
    const outside = lit.replace(/\$\{[^}]*\}/g, '').replace(/\\[a-z]/g, '');
    if (!/[A-Za-z]/.test(outside)) continue;
    if (!allowed.has(lit)) unaccounted.push(lit);
  }

  check(
    unaccounted.length === 0,
    `missions.js has no unaccounted hardcoded English strings (found: ${JSON.stringify(unaccounted)})`
  );

  // every allowlisted string must actually still be present, so the
  // allowlist cannot rot into a blanket exemption
  for (const lit of allowed) {
    check(literals.includes(lit), `allowlisted literal still present: ${JSON.stringify(lit.slice(0, 48))}`);
  }

  console.log(`\n✓ missions.js AR localization (${n} assertions passed)`);
  console.log(`  ${msKeys.length} ms_ keys · EN/AR parity ${enKeys.length}/${arKeys.length} · 0 hardcoded English UI strings`);
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
