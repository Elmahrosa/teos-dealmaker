// bot/screens/* localization test.
//
// Arabic is required end-user coverage. This pins the extraction for the
// screens localized so far so it cannot silently regress:
//
//   1. EN/AR key-set parity across the WHOLE dictionary (0 missing / 0 extra),
//      the same key-set diff used for the original 359-key audit.
//   2. Every key added for a screen exists in AR with a non-empty value.
//   3. Format-safety: the %s placeholder count in AR equals EN for every one
//      of those keys, so an Arabic string can never drop or reorder an
//      interpolation.
//   4. Every key whose EN copy is real prose has Arabic script in its AR
//      value, so a key can never be "added" with the English text copied over.
//   5. Each screen contains zero remaining hardcoded English UI strings. The
//      only ASCII-bearing literals left must be exactly that screen's
//      documented allowlist (model input, audit event identifiers, machine
//      field names) — and every allowlisted literal must still be present, so
//      the allowlist cannot rot into a blanket exemption.

'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || '';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { LANGS, t } = require('../bot/i18n');

const SCREENS_DIR = path.join(__dirname, '..', 'bot', 'screens');

// --- missions.js ----------------------------------------------------------
// Model input, deliberately English: these strings are fed to the runtime
// agent, not rendered to the user. Translating them would change agent
// behaviour rather than presentation. Each is annotated in missions.js.
const MISSIONS_AGENT_FACING = [
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
const MISSIONS_AUDIT_EVENTS = [
  'BOT_MISSION_CREATE',
  'BOT_MISSION1_RUN',
  'BOT_MISSION1_ERROR',
  'BOT_MISSION2_RUN',
  'BOT_MISSION_MARKET',
  'BOT_MISSION_GOAL'
];

// --- integrations.js ------------------------------------------------------
// Connector API method names. The agents call these by name, so they are
// identifiers, not copy; they are passed as the %s argument to int_body_tools.
// Comma-separated with no connective, so that no English word rides the %s
// substitution into the Arabic sentence.
const INTEGRATIONS_TOOL_NAMES = 'searchContacts, searchDeals, sendMessage, createMeeting, storeDocument, fetchKnowledge, crawl';

// Catalog field names used to exclude non-capability keys, plus the ISO-8601
// date/time separator. Machine identifiers, not UI copy.
const INTEGRATIONS_MACHINE_IDS = ['keyEnv', 'baseUrl', 'defaultModel', 'T'];

// --- intelligence.js ------------------------------------------------------
// No allowlist: after localization this file has zero ASCII-bearing literals
// left. The /ask model prompt is built in services/intelligence.js and is out
// of scope here, so nothing in this screen is agent input.

const SCREENS = [
  {
    name: 'missions.js',
    prefix: 'ms_',
    allow: MISSIONS_AGENT_FACING.concat(MISSIONS_AUDIT_EVENTS)
  },
  {
    name: 'intelligence.js',
    prefix: 'il_',
    allow: []
  },
  {
    name: 'integrations.js',
    prefix: 'int_',
    allow: [INTEGRATIONS_TOOL_NAMES].concat(INTEGRATIONS_MACHINE_IDS)
  }
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

  const summary = [];

  for (const screen of SCREENS) {
    const keys = enKeys.filter(k => k.startsWith(screen.prefix));
    const tag = `${screen.name} (${screen.prefix})`;

    // ---- 2. every key resolves, non-empty -------------------------------
    check(keys.length > 0, `${screen.name} keys were added (found ${keys.length} ${screen.prefix} keys)`);
    for (const key of keys) {
      check(arSet.has(key), `AR defines ${key}`);
      const val = LANGS.ar[key];
      check(typeof val === 'string' && val.trim().length > 0, `AR ${key} is a non-empty string`);
    }

    // ---- 3. format-safety: placeholder counts preserved -----------------
    for (const key of keys) {
      const en = countPlaceholders(LANGS.en[key]);
      const ar = countPlaceholders(LANGS.ar[key]);
      check(en === ar, `${key} keeps its %s placeholder count in AR (EN ${en}, AR ${ar})`);
    }

    // ---- 4. real prose in EN => real Arabic in AR -----------------------
    const ARABIC = /[؀-ۿ]/;
    for (const key of keys) {
      if (!/[A-Za-z]{3}/.test(LANGS.en[key])) continue; // format-only, e.g. '%s: %s'
      check(ARABIC.test(LANGS.ar[key]), `${key} is translated to Arabic, not copied English`);
    }

    // t() must resolve every key without falling through to the raw key name
    // (an unknown user resolves to EN, which is the fallback path).
    for (const key of keys) {
      check(t('i18n-probe-user', key) === LANGS.en[key], `t() resolves ${key} to a real EN value`);
      check(LANGS.en[key] !== key, `EN ${key} is not an unresolved passthrough`);
      check(LANGS.ar[key] !== key, `AR ${key} is not an unresolved passthrough`);
    }

    // ---- 5. zero remaining hardcoded English UI strings ----------------
    let src = fs.readFileSync(path.join(SCREENS_DIR, screen.name), 'utf8');
    // strip comments so apostrophes in prose cannot desync the quote scan
    src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    const literals = [];
    const re = /'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
    let m;
    while ((m = re.exec(src))) literals.push(m[1] !== undefined ? m[1] : m[2]);

    const allowed = new Set(screen.allow);
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
      `${screen.name} has no unaccounted hardcoded English strings (found: ${JSON.stringify(unaccounted)})`
    );

    // every allowlisted string must actually still be present, so the
    // allowlist cannot rot into a blanket exemption
    for (const lit of allowed) {
      check(literals.includes(lit), `${tag} allowlisted literal still present: ${JSON.stringify(lit.slice(0, 48))}`);
    }

    summary.push({ name: screen.name, prefix: screen.prefix, keys: keys.length, allow: screen.allow.length });
  }

  // ---- 6. the %s-argument tool list stays pure identifiers ---------------
  // This list is substituted into int_body_tools in both languages, so any
  // English connective inside it lands verbatim in the Arabic sentence. Pin
  // the shape: bare identifiers and separators, nothing else.
  const TOOL_LIST = INTEGRATIONS_TOOL_NAMES;
  check(!/\band\b/i.test(TOOL_LIST),
    'integrations tool list carries no English connective into the translated sentence');
  check(
    TOOL_LIST.split(', ').every(w => /^[A-Za-z][A-Za-z0-9]*$/.test(w)),
    'integrations tool list is bare identifiers separated by ", "');
  check(countPlaceholders(LANGS.en.int_body_tools) === 1 && countPlaceholders(LANGS.ar.int_body_tools) === 1,
    'int_body_tools takes exactly one %s (the tool list)');
  const renderedAr = String(LANGS.ar.int_body_tools).replace('%s', TOOL_LIST);
  check(!/\b(?:and|or|the|of)\b/.test(renderedAr.replace(/[\u0600-\u06FF]/g, '')),
    'the Arabic int_body_tools render has no stray English connective: ' + JSON.stringify(renderedAr));

  console.log(`\n✓ screen AR localization (${n} assertions passed)`);
  for (const s of summary) {
    console.log(`  ${s.name.padEnd(18)} ${String(s.keys).padStart(3)} ${s.prefix} keys · ${s.allow} allowlisted machine strings · 0 hardcoded English UI strings`);
  }
  console.log(`  EN/AR parity ${enKeys.length}/${arKeys.length} · 0 missing · 0 extra · 0 empty`);
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
