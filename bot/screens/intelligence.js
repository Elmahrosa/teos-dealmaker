const design = require('../design');
const i18n = require('../i18n');
const { getStoreAdapter } = require('../store');
const intelligence = require('../../services/intelligence');
const { getCtx } = require('./lib');

async function buildIntelligence(userId) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b(t('il_title_hub'))}`,
        design.it(t('il_body_noctx')),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton(t('common_home'), 'cc_home')]
      ])
    };
  }
  const d = await intelligence.describe(getStoreAdapter(), ctx.workspace.id);
  const sourceRows = d.sources
    .filter(s => s.count > 0)
    .map(s => design.row(s.label, String(s.count)));
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(t('il_title_hub'))}`,
    design.it(t('il_body_sub')),
    design.divider(),
    design.row(t('il_documents'), String(d.total_docs)),
    design.row(t('il_row_chunks'), String(d.total_chunks)),
    design.row(t('il_row_profile'), String(d.seeded)),
    design.row(t('il_row_uploaded'), String(d.uploaded)),
    design.section(t('il_sec_sources')),
    ...(sourceRows.length ? sourceRows : [design.it(t('il_body_no_knowledge'))]),
    design.section(t('il_sec_copilot')),
    design.it(t('il_body_copilot')),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton(t('il_btn_ask'), 'cc_kg_ask'), design.textButton(t('il_btn_add'), 'cc_kg_add')],
      [design.textButton(t('il_documents'), 'cc_kg_docs'), design.textButton(t('il_btn_edit_details'), 'cc_memory')],
      [design.textButton(t('common_home'), 'cc_home')]
    ])
  };
}

async function buildKnowledgeDocs(userId) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b(t('il_title_docs'))}`,
        design.it(t('il_body_workspace_first')),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton(t('common_home'), 'cc_home')]
      ])
    };
  }
  const docs = await intelligence.listDocuments(getStoreAdapter(), ctx.workspace.id);
  // Delivered with parse_mode:'HTML', so every dynamic value interpolated into
  // `text` must be escaped at this boundary. d.title is the first line of
  // whatever the user pasted in buildKnowledgeAdd, i.e. fully user-typed;
  // d.label is catalog data that still contains a raw '&' ('Products &
  // Services'), which is a bare entity reference in an HTML body.
  //
  // The Delete button label below is deliberately NOT escaped: Telegram never
  // HTML-parses reply_markup button text, so escaping there would render
  // "Q&amp;A" to the user. See the assertion in tests/test-bot-html-escaping.js.
  const lines = docs.length ? docs.map(d =>
    `${design.EMOJI.info} ${design.b(design.esc(d.title))}${d.seeded ? ' · ' + design.badge('profile') : ''}\n${design.it(design.esc(d.label) + ' · ' + i18n.sprintf(d.chunks === 1 ? t('il_chunks_one') : t('il_chunks_many'), d.chunks))}`
  ) : [design.it(t('il_body_no_docs'))];
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(t('il_title_docs'))}`,
    design.it(i18n.sprintf(docs.length === 1 ? t('il_docs_one') : t('il_docs_many'), docs.length)),
    design.divider(),
    ...lines,
    design.divider()
  ]);
  // Plain-text field: button labels are not HTML-parsed by Telegram, so
  // d.title is intentionally unescaped here. Escaping would show the user a
  // literal "&amp;".
  const rows = docs.slice(0, 6).map(d => [design.textButton(i18n.sprintf(t('il_btn_delete'), d.title.slice(0, 18)), `cc_kg_del:${d.id}`)]);
  rows.push([design.textButton(t('il_btn_add'), 'cc_kg_add'), design.textButton(t('il_btn_hub'), 'cc_intelligence')]);
  rows.push([design.textButton(t('common_home'), 'cc_home')]);
  return {
    text,
    keyboard: design.keyboard(rows)
  };
}

function buildKnowledgeAdd(userId, sourceType) {
  const t = key => i18n.t(userId, key);
  const label = intelligence.SOURCE_TYPES[sourceType] ? intelligence.SOURCE_TYPES[sourceType].label : sourceType;
  return {
    text: design.compose([
      `${design.EMOJI.ai} ${design.b(i18n.sprintf(t('il_title_add'), label))}`,
      design.divider(),
      design.it(t('il_body_paste')),
      design.it(t('il_body_firstline')),
      design.it(t('il_body_example')),
      design.code(t('il_ex_pricing')),
      design.divider()
    ]),
    keyboard: design.keyboard([
      [design.textButton(t('common_cancel'), 'cc_kg_cancel')]
    ])
  };
}

function buildKnowledgeAskPrompt(userId) {
  const t = key => i18n.t(userId, key);
  return {
    text: design.compose([
      `${design.EMOJI.ai} ${design.b(t('il_title_ask'))}`,
      design.divider(),
      design.it(t('il_body_ask')),
      design.it(t('il_body_examples')),
      design.code(t('il_ex1')),
      design.code(t('il_ex2')),
      design.code(t('il_ex3')),
      design.divider()
    ]),
    keyboard: design.keyboard([
      [design.textButton(t('common_cancel'), 'cc_kg_cancel')]
    ])
  };
}

function buildAskResult(userId, question, result) {
  // Everything below is delivered with parse_mode:'HTML'. The question is raw
  // user input, the answer and excerpts are model/corpus output, so all of it
  // is escaped at this render boundary. The markup is ours; theirs is data.
  // Only the surrounding chrome is localized: the model prompt itself is built
  // in services/intelligence.js and is deliberately not translated.
  const t = key => i18n.t(userId, key);
  const answerLines = result.answer
    ? result.answer.split('\n').map(design.esc)
    : [design.it(t('il_body_no_answer'))];
  const evidenceLines = result.evidence.slice(0, 3).map(e =>
    `${design.code(design.esc(e.label))} ${design.b(design.esc(e.title))} · ${i18n.sprintf(t('il_score'), design.esc(e.score))}\n${design.it(design.esc(e.excerpt.length > 90 ? e.excerpt.slice(0, 90) + '…' : e.excerpt))}`
  );
  const lines = [
    `${design.EMOJI.ai} ${design.b(t('il_title_answer'))}`,
    design.it(i18n.sprintf(t('il_question'), design.esc(question))),
    design.it(i18n.sprintf(t('il_intent'), design.esc(result.intent.label)) + (result.provider ? ` · ${design.esc(result.provider_label || result.provider)} ${design.esc(result.model)}` : t('il_offline_evidence'))),
    design.divider(),
    ...answerLines,
    design.section(t('il_sec_evidence')),
    ...(evidenceLines.length ? evidenceLines : [design.it(t('il_body_no_evidence'))]),
    design.divider()
  ];
  return {
    text: design.compose(lines),
    keyboard: design.keyboard([
      [design.textButton(t('il_btn_ask_again'), 'cc_kg_ask'), design.textButton(t('il_btn_hub'), 'cc_intelligence')],
      [design.textButton(t('common_home'), 'cc_home')]
    ])
  };
}

module.exports = {
  buildIntelligence,
  buildKnowledgeDocs,
  buildKnowledgeAdd,
  buildKnowledgeAskPrompt,
  buildAskResult
};
