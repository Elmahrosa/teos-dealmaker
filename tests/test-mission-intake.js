// tests/test-mission-intake.js
// Covers the one-shot mission intake funnel: normalize/validate shared by the
// server (/start) and the repos layer that persists mission_intakes rows.
// Run via `node tests/test-mission-intake.js` or `npm test`.
'use strict';

const missionIntake = require('../services/missionIntake');
const { createMemoryAdapter } = require('../db');
const { createRepos } = require('../db/repos');

let pass = 0;
let fail = 0;

function check(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('  ✗ ' + msg);
  }
}

// --- normalize / validate ---
const valid = missionIntake.normalize({
  mission: 'Win 5 new enterprise customers',
  business: 'We sell construction ERP software to mid-market firms.',
  outcome: 'Qualified prospect list with outreach scripts',
  target_customer: 'Mid-market construction firms in Egypt',
  market: 'MENA',
  budget: '$5K–$50K',
  timeline: 'Within 30 days',
  capabilities: 'Website and product docs linked',
  contact: 'founder@example.com'
});

check(valid.ok, 'valid intake normalizes');
check(valid.row.title === 'Win 5 new enterprise customers', 'title captured from mission field');
check(valid.row.objective === 'We sell construction ERP software to mid-market firms.', 'business captured as objective');
check(valid.row.status === 'received', 'default status is received');
check(valid.row.contact === 'founder@example.com', 'optional contact captured');
check(valid.row.answers.outcome === 'Qualified prospect list with outreach scripts', 'answers JSON captures optional fields');
check(valid.row.answers.market === 'MENA', 'answers JSON captures market');

const missing = missionIntake.normalize({});
check(!missing.ok, 'empty intake rejected');
check(missing.errors.indexOf('mission') !== -1 && missing.errors.indexOf('objective') !== -1,
  'missing mission + objective reported');

const noContact = missionIntake.normalize({ mission: 'Win new customers', objective: 'Grow pipeline' });
check(noContact.ok, 'intake without contact still normalizes ok');
check(noContact.row.contact === missionIntake.CONTACT_FALLBACK,
  'missing contact stores the canonical fallback string');
check(noContact.row.contact === 'Contact channel not yet established',
  'fallback string is the required canonical value');
check(!Object.prototype.hasOwnProperty.call(noContact.row.answers, 'contact'),
  'answers JSON does not carry contact');

const ar = missionIntake.normalize({
  mission: 'مهمة واحدة',
  business: 'نبيع برمجيات تخطيط موارد المؤسسات'
});
check(ar.ok && ar.row.title === 'مهمة واحدة', 'Arabic title accepted');

(async () => {
  // --- repos round-trip on the memory adapter ---
  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  const created = await repos.intakes.create(valid.row);
  check(Boolean(created && created.id), 'create returns intake row with id');
  check(created.status === 'received', 'create persists status');
  check(created.answers && created.answers.outcome, 'create persists answers JSON');
  check(Boolean(created.created_at), 'create stamps created_at');

  const got = await repos.intakes.get(created.id);
  check(Boolean(got && got.title === valid.row.title), 'get returns intake by id');
  check(got.contact === 'founder@example.com', 'get returns stored contact');

  const list = await repos.intakes.list();
  check(list.length === 1, 'list returns stored intakes');

  const missingRow = await repos.intakes.get(9999);
  check(missingRow === null, 'get on unknown id returns null');

  console.log('  mission intake: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
