// tests/test-transparency.js
// EU AI Act transparency suite (Regulation (EU) 2024/1689, Art. 50).
// Verifies the transparency module behaves deterministically (idempotent
// disclosure + content marking) and that both send paths that expose content
// to natural persons are actually wired to it:
//   - bot/index.js sends every reply through withAiDisclosure()  (Art. 50(1))
//   - services/outboundWorker sends every email as withContentMarking() (Art. 50(2))
// and that the compliance mapping exists at the repository root.

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const tx = require('../services/transparency');

(async () => {
  let n = 0;
  const check = (cond, msg) => { assert.ok(cond, msg); n += 1; };
  const equal = (a, b, msg) => { assert.strictEqual(a, b, msg); n += 1; };

  // ---------------------------------------------------------- markers exist
  check(typeof tx.AI_DISCLOSURE_EN === 'string' && tx.AI_DISCLOSURE_EN.length > 0, 'EN AI disclosure defined');
  check(typeof tx.AI_DISCLOSURE_AR === 'string' && tx.AI_DISCLOSURE_AR.length > 0, 'AR AI disclosure defined');
  check(typeof tx.AI_CONTENT_MARKER === 'string' && /AI-CONTENT-MARKER/.test(tx.AI_CONTENT_MARKER), 'machine-readable content marker defined');

  // ------------------------------------------------ withAiDisclosure (50(1))
  const plain = 'Hello, this is the assistant.';
  const disclosedEn = tx.withAiDisclosure(plain, 'en');
  check(disclosedEn.includes(tx.AI_DISCLOSURE_EN), 'EN disclosure appended to bot reply');
  check(disclosedEn.indexOf(plain) === 0, 'original reply preserved at the start');
  equal(tx.withAiDisclosure(disclosedEn, 'en'), disclosedEn, 'EN disclosure is idempotent (no duplicate footer)');

  const disclosedAr = tx.withAiDisclosure(plain, 'ar');
  check(disclosedAr.includes(tx.AI_DISCLOSURE_AR), 'AR disclosure appended for AR users');
  equal(tx.withAiDisclosure(disclosedAr, 'ar'), disclosedAr, 'AR disclosure is idempotent');

  equal(tx.withAiDisclosure('', 'en'), tx.AI_DISCLOSURE_EN, 'empty message still carries the disclosure');
  check(tx.hasAiDisclosure(disclosedEn, 'en') === true, 'hasAiDisclosure detects EN footer');
  check(tx.hasAiDisclosure(plain, 'en') === false, 'hasAiDisclosure is false for unmarked text');

  // ------------------------------------------- withContentMarking (50(2))
  const body = 'Your outreach follow-up is ready.';
  const marked = tx.withContentMarking(body);
  check(marked.includes(tx.AI_CONTENT_MARKER), 'email body carries the machine-readable AI-CONTENT-MARKER');
  check(marked.includes(tx.AI_CONTENT_DISCLOSURE_EN), 'email body carries the human-readable AI disclosure');
  check(marked.indexOf(body) === 0, 'original body preserved at the start');
  equal(tx.withContentMarking(marked), marked, 'content marking is idempotent (no duplicate marker)');
  check(tx.hasContentMarking(marked) === true, 'hasContentMarking detects the marker');
  check(tx.hasContentMarking(body) === false, 'hasContentMarking is false for unmarked text');

  // ------------------------------------------------------- wiring: bot (50(1))
  const botSource = fs.readFileSync(path.join(__dirname, '..', 'bot', 'index.js'), 'utf8');
  check(/get\(userId\)/.test(botSource) && /update\(userId, \{ disclosureShown: true \}\)/.test(botSource), 'bot uses session memory to track disclosure state');
  check(/DISCLOSURES\[lang\] || DISCLOSURES\.en/.test(botSource), 'bot selects language-specific AI disclosure');
  check(/result\.__isAI && !session\.disclosureShown/.test(botSource), 'bot conditionally prepends disclosure for AI responses');
  check(/const \{ get, update \} = require\('\.\.\/services\/router\/memory'\)/.test(botSource), 'bot imports session get/update from router memory');
  check(/const \{ DISCLOSURES \} = require\('\.\.\/services\/transparency'\)/.test(botSource), 'bot imports DISCLOSURES from services/transparency');
  check(/i18n\.getLang\(/.test(botSource), 'bot resolves the user language for the disclosure');

  // ------------------------------------------- wiring: outbound (50(2))
  const workerSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'outboundWorker', 'index.js'), 'utf8');
  check(/text:\s*withContentMarking\(job\.body\)/.test(workerSource), 'outbound worker sends withContentMarking(job.body)');
  check(/const \{ withContentMarking \} = require\('\.\.\/transparency'\)/.test(workerSource), 'worker imports withContentMarking from services/transparency');
  check(/content_marked:\s*'ai-generated'/.test(workerSource), 'worker records content_marked in the EMAIL_JOB_SENT audit entry');

  // -------------------------------------------------------- compliance map
  check(fs.existsSync(path.join(__dirname, '..', 'TRANSPARENCY.md')), 'TRANSPARENCY.md exists at the repository root');

  console.log(`test-transparency: ${n} checks passed`);
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
