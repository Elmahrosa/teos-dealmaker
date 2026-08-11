// EU AI Act transparency enforcement check (Regulation (EU) 2024/1689).
//
// Deterministic guard, run in CI and from the pre-push hook
// (`npm run transparency:check`). It verifies that the transparency markers
// are actually wired into the code paths that expose content to natural
// persons, and that the compliance mapping exists. Fails closed.
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const failures = [];
const checks = [];

function check(name, ok, detail) {
  checks.push({ name, ok, detail: detail || '' });
  if (!ok) failures.push(`${name}: ${detail || 'failed'}`);
}

const tx = require('../services/transparency');

check('transparency module exports markers',
  typeof tx.AI_DISCLOSURE_EN === 'string' &&
  typeof tx.AI_DISCLOSURE_AR === 'string' &&
  typeof tx.AI_CONTENT_MARKER === 'string',
  'AI_DISCLOSURE_EN/AR and AI_CONTENT_MARKER must be exported');

const disclosed = tx.withAiDisclosure('Hello', 'en');
check('withAiDisclosure appends EN disclosure', disclosed.includes(tx.AI_DISCLOSURE_EN), 'missing EN footer');
check('withAiDisclosure is idempotent', tx.withAiDisclosure(disclosed, 'en') === disclosed, 'footer duplicated on re-apply');

const disclosedAr = tx.withAiDisclosure('مرحبا', 'ar');
check('withAiDisclosure appends AR disclosure', disclosedAr.includes(tx.AI_DISCLOSURE_AR), 'missing AR footer');

const marked = tx.withContentMarking('Body');
check('withContentMarking appends machine-readable marker', marked.includes(tx.AI_CONTENT_MARKER), 'missing AI-CONTENT-MARKER');
check('withContentMarking is idempotent', tx.withContentMarking(marked) === marked, 'marker duplicated on re-apply');
check('hasContentMarking detects marker', tx.hasContentMarking(marked) === true && tx.hasContentMarking('Body') === false, 'detection inverted');

const botSource = fs.readFileSync(path.join(root, 'bot', 'index.js'), 'utf8');
check('bot uses session memory to track disclosure state',
  /get\(userId\)/.test(botSource) && /update\(userId, \{ disclosureShown: true \}\)/.test(botSource),
  'bot must use session memory to track disclosure state');
check('bot selects language-specific AI disclosure',
  /DISCLOSURES\[lang\] || DISCLOSURES\.en/.test(botSource),
  'bot must select language-specific AI disclosure');
check('bot conditionally prepends disclosure for AI responses',
  /result\.__isAI && !session\.disclosureShown/.test(botSource),
  'bot must conditionally prepend disclosure for AI responses');
check('bot imports session get/update from router memory',
  /const \{ get, update \} = require\('\.\.\/services\/router\/memory'\)/.test(botSource),
  'bot must import session get/update from router memory');
check('bot imports DISCLOSURES from services/transparency',
  /const \{ DISCLOSURES \} = require\('\.\.\/services\/transparency'\)/.test(botSource),
  'bot must import DISCLOSURES from services/transparency');
check('bot resolves the user language for the disclosure',
  /i18n\.getLang\(/.test(botSource),
  'bot must resolve user language for disclosure');

const workerSource = fs.readFileSync(path.join(root, 'services', 'outboundWorker', 'index.js'), 'utf8');
check('outbound worker marks AI-generated content in the send path',
  /text:\s*withContentMarking\(job\.body\)/.test(workerSource),
  'services/outboundWorker/index.js must send withContentMarking(job.body)');

check('TRANSPARENCY.md compliance mapping exists',
  fs.existsSync(path.join(root, 'TRANSPARENCY.md')),
  'TRANSPARENCY.md must exist at the repository root');

for (const c of checks) {
  console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
}

if (failures.length) {
  console.error(`\n${failures.length} transparency check(s) FAILED`);
  process.exit(1);
}
console.log(`\n${checks.length} transparency checks passed`);
