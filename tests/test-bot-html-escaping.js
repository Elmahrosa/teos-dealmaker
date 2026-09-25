// Send-path HTML escaping regression test.
//
// Telegram parses every message with parse_mode:'HTML' and rejects the WHOLE
// message if any part of the markup is malformed. The Company Intelligence
// answer screen interpolates three untrusted sources into that markup: the
// user's raw question, the model answer, and knowledge-base excerpts. This
// pins that all three are escaped at the render boundary, and that the send
// path still degrades to plain text instead of losing the reply.
//
// Coverage:
//   1. buildAskResult escapes <, > and & in question / answer / excerpt /
//      intent label, and emits no tag outside the design.js allowlist.
//   2. esc() is a correct single-pass escape (no double-escaping).
//   3. sendHtml resends as plain text when Telegram rejects the HTML, and the
//      real content still reaches the user.
//   4. sendHtml rethrows non-parse errors (it is not a blanket error swallower).
//   5. End-to-end: escaped screen + strict validator => sends on first try.

'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const assert = require('assert');
const design = require('../bot/design');
const { buildAskResult } = require('../bot/screens/intelligence');
const { sendHtml, toPlainText, isParseError } = require('../bot/screens/lib');

const HOSTILE = '<script>alert(1)</script> & "quoted" <b>not bold</b>';

// Telegram only accepts these tags in HTML mode; everything else is an error.
const ALLOWED_TAGS = new Set(['b', 'i', 'code', 'a', 'pre', 's', 'u', 'tg-spoiler', 'tg-emoji']);

// Stand-in for Telegram's HTML validator. Throws the same 400 shape the real
// API returns, so sendHtml's detection path is genuinely exercised.
function assertValidTelegramHtml(text) {
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z0-9-]+)([^>]*)>/g;
  let last = 0;
  let m;
  while ((m = tagRe.exec(text)) !== null) {
    // Bare & that is not part of a known entity.
    const between = text.slice(last, m.index);
    const badAmp = between.match(/&(?!(amp|lt|gt|quot|#\d+);)/);
    if (badAmp) {
      throw new Error("Bad Request: can't parse entities: Unterminated entity reference at byte offset " + m.index);
    }
    last = m.index + m[0].length;
    const [, closing, name] = m;
    if (closing) {
      if (stack.pop() !== name) {
        throw new Error("Bad Request: can't parse entities: Can't find end tag at byte offset " + m.index);
      }
    } else {
      if (!ALLOWED_TAGS.has(name.toLowerCase())) {
        throw new Error('Bad Request: can\'t parse entities: Unsupported start tag "' + name + '" at byte offset ' + m.index);
      }
      stack.push(name);
    }
  }
  if (stack.length) {
    throw new Error('Bad Request: can\'t parse entities: Can\'t find end tag for <' + stack[stack.length - 1] + '>');
  }
}

function makeResult(overrides) {
  return Object.assign({
    answer: HOSTILE,
    intent: { label: 'pricing & packaging' },
    provider: 'openai',
    provider_label: 'OpenAI & Co',
    model: 'gpt-4o<mini>',
    evidence: [
      { label: 'pricing<doc>', title: 'Plan A & B', excerpt: HOSTILE, score: 0.87 },
      { label: 'faq', title: 'Refunds', excerpt: 'plain excerpt', score: 0.4 }
    ]
  }, overrides);
}

(async () => {
  let n = 0;
  const check = (cond, msg) => { assert.ok(cond, msg); n += 1; };
  const equal = (a, b, msg) => { assert.strictEqual(a, b, msg); n += 1; };

  // ---------------------------------------------------------- 1. esc() itself
  equal(design.esc('a & b'), 'a &amp; b', 'esc escapes ampersand');
  equal(design.esc('<b>'), '&lt;b&gt;', 'esc escapes angle brackets');
  equal(design.esc('&lt;'), '&amp;lt;', 'esc does not double-escape an existing entity');
  equal(design.esc(null), '', 'esc tolerates null');
  equal(design.esc(undefined), '', 'esc tolerates undefined');
  equal(design.esc(42), '42', 'esc stringifies non-strings');

  // ------------------------------------------- 2. buildAskResult escapes data
  const screen = buildAskResult(7700001, HOSTILE, makeResult());
  const text = screen.text;

  check(!/<script>/.test(text), 'hostile question/answer does not emit a raw <script> tag');
  check(text.includes('&lt;script&gt;'), 'hostile input is present in escaped form');
  check(!/ & /.test(text), 'bare ampersand from data is escaped, not left raw');
  check(text.includes('&amp;'), 'ampersand from data survives as an entity');
  check(text.includes('pricing &amp; packaging'), 'intent label is escaped');
  check(text.includes('OpenAI &amp; Co'), 'provider label is escaped');
  check(text.includes('gpt-4o&lt;mini&gt;'), 'model name is escaped');
  check(text.includes('pricing&lt;doc&gt;'), 'evidence label is escaped');
  check(text.includes('Plan A &amp; B'), 'evidence title is escaped');

  // The composed message must be valid Telegram HTML on its own.
  assertValidTelegramHtml(text);
  check(true, 'composed answer screen is valid Telegram HTML');

  // ---------------------------------------------------------- 3. sendHtml
  const sent = [];
  const strictBot = {
    async sendMessage(chatId, body, opts) {
      if (opts && opts.parse_mode === 'HTML') assertValidTelegramHtml(body);
      sent.push({ chatId, body, opts });
      return { message_id: sent.length };
    }
  };

  const clean = await sendHtml(strictBot, 7700001, text, { reply_markup: screen.keyboard });
  equal(clean.fellBack, false, 'valid HTML sends on the first attempt');
  equal(sent.length, 1, 'no fallback needed when the markup is valid');
  equal(sent[0].opts.parse_mode, 'HTML', 'first attempt uses HTML parse mode');
  check(sent[0].opts.reply_markup !== undefined, 'keyboard is preserved on success');

  // Simulate an escaping bug slipping through: Telegram rejects the HTML.
  const sent2 = [];
  const rejectingBot = {
    async sendMessage(chatId, body, opts) {
      sent2.push({ chatId, body, opts });
      if (opts && opts.parse_mode === 'HTML') {
        throw new Error("Bad Request: can't parse entities: Unsupported start tag \"x\" at byte offset 10");
      }
      return { message_id: sent2.length };
    }
  };
  const fell = await sendHtml(rejectingBot, 7700002, '<b>Report</b> for R&D < 10 & growing', { reply_markup: null });
  equal(fell.fellBack, true, 'sendHtml reports that the plain-text fallback ran');
  equal(sent2.length, 2, 'a rejected HTML send is retried exactly once');
  check(sent2[1].opts.parse_mode === undefined, 'fallback strips parse_mode entirely');
  equal(sent2[1].body, 'Report for R&D < 10 & growing', 'fallback delivers the real content as readable plain text');
  check(!/<b>/.test(sent2[1].body), 'fallback strips our own markup rather than showing raw tags');

  // A non-parse failure must NOT be swallowed — that is the bug being fixed.
  const boom = new Error('Bad Request: chat not found');
  const throwingBot = {
    async sendMessage() { throw boom; }
  };
  let caught = null;
  try {
    await sendHtml(throwingBot, 7700003, '<b>hi</b>');
  } catch (err) {
    caught = err;
  }
  equal(caught, boom, 'sendHtml rethrows non-parse errors instead of masking them');

  // ------------------------------------------------- 4. helpers and detection
  check(isParseError(new Error("Bad Request: can't parse entities: Can't find end tag")), 'detects end-tag parse errors');
  check(isParseError(new Error('Bad Request: can\'t parse entities: Unsupported start tag "b"')), 'detects unsupported start tag');
  check(!isParseError(new Error('Bad Request: chat not found')), 'does not treat unrelated 400s as parse errors');
  check(!isParseError(new Error('429: Too Many Requests')), 'does not treat rate limits as parse errors');

  equal(toPlainText('<b>bold</b> &amp; <i>it</i>'), 'bold & it', 'toPlainText removes design tags and unescapes entities');
  equal(toPlainText('&amp;lt;'), '&lt;', 'toPlainText round-trips a literal escaped entity');

  // --------------------------------- 5. end-to-end with the strict validator
  // The exact scenario from the bug report: hostile question + hostile answer
  // + hostile excerpt, rendered by the screen and pushed through the real send
  // path with a bot that enforces Telegram's HTML rules.
  const e2eScreen = buildAskResult(7700004, 'Is A&B < 5 or 5 > 3?', makeResult());
  const e2eSent = [];
  const e2eBot = {
    async sendMessage(chatId, body, opts) {
      if (opts && opts.parse_mode === 'HTML') assertValidTelegramHtml(body);
      e2eSent.push({ chatId, body, opts });
      return { message_id: e2eSent.length };
    }
  };
  const e2e = await sendHtml(e2eBot, 7700004, e2eScreen.text, { reply_markup: e2eScreen.keyboard });
  equal(e2e.fellBack, false, 'end-to-end send succeeds without falling back');
  equal(e2eSent.length, 1, 'end-to-end send delivers exactly one message');
  check(e2eSent[0].body.includes('&lt;script&gt;'), 'end-to-end message carries the escaped model content');

  console.log(`\n\u2713 bot HTML escaping + send-path fallback (${n} assertions passed)`);
  console.log('  esc() · buildAskResult question/answer/excerpt/intent · sendHtml retry · strict validator e2e');
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
