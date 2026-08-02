const design = require('../design');
const { getStoreAdapter } = require('../store');
const intelligence = require('../../services/intelligence');
const { getCtx } = require('./lib');

async function buildIntelligence(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('Company Intelligence')}`,
        design.it('Set up a workspace to build your intelligence layer.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const d = await intelligence.describe(getStoreAdapter(), ctx.workspace.id);
  const sourceRows = d.sources
    .filter(s => s.count > 0)
    .map(s => design.row(s.label, String(s.count)));
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Company Intelligence')}`,
    design.it('The knowledge your workforce answers from.'),
    design.divider(),
    design.row('Documents', String(d.total_docs)),
    design.row('Knowledge chunks', String(d.total_chunks)),
    design.row('From your profile', String(d.seeded)),
    design.row('Uploaded', String(d.uploaded)),
    design.section('SOURCES'),
    ...(sourceRows.length ? sourceRows : [design.it('No knowledge yet — add your products, pricing, FAQs and past proposals.')]),
    design.section('COPILOT'),
    design.it('Ask questions like "Which plan fits a 300-person company?" or "Draft a proposal with Enterprise pricing."'),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Ask the AI', 'cc_kg_ask'), design.textButton('Add Knowledge', 'cc_kg_add')],
      [design.textButton('Documents', 'cc_kg_docs'), design.textButton('Edit Company Details', 'cc_memory')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

async function buildKnowledgeDocs(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('Intelligence Documents')}`,
        design.it('Set up a workspace first.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const docs = await intelligence.listDocuments(getStoreAdapter(), ctx.workspace.id);
  const lines = docs.length ? docs.map(d =>
    `${design.EMOJI.info} ${design.b(d.title)}${d.seeded ? ' · ' + design.badge('profile') : ''}\n${design.it(d.label + ' · ' + d.chunks + ' chunk' + (d.chunks === 1 ? '' : 's'))}`
  ) : [design.it('No documents yet — add pricing, FAQs, proposals or notes.')];
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Intelligence Documents')}`,
    design.it(`${docs.length} document${docs.length === 1 ? '' : 's'} in this workspace`),
    design.divider(),
    ...lines,
    design.divider()
  ]);
  const rows = docs.slice(0, 6).map(d => [design.textButton('Delete: ' + d.title.slice(0, 18), `cc_kg_del:${d.id}`)]);
  rows.push([design.textButton('Add Knowledge', 'cc_kg_add'), design.textButton('Intelligence Hub', 'cc_intelligence')]);
  rows.push([design.textButton('Back to Home', 'cc_home')]);
  return {
    text,
    keyboard: design.keyboard(rows)
  };
}

function buildKnowledgeAdd(userId, sourceType) {
  const label = intelligence.SOURCE_TYPES[sourceType] ? intelligence.SOURCE_TYPES[sourceType].label : sourceType;
  return {
    text: design.compose([
      `${design.EMOJI.ai} ${design.b('Add Knowledge · ' + label)}`,
      design.divider(),
      design.it('Paste the knowledge text now.'),
      design.it('First line becomes the title, the rest is the content.'),
      design.it('Example:'),
      design.code('Enterprise Pricing\n$2,999/year for teams up to 100 seats. Includes onboarding, priority support and a dedicated CSM.'),
      design.divider()
    ]),
    keyboard: design.keyboard([
      [design.textButton('Cancel', 'cc_kg_cancel')]
    ])
  };
}

function buildKnowledgeAskPrompt() {
  return {
    text: design.compose([
      `${design.EMOJI.ai} ${design.b('Ask Company Intelligence')}`,
      design.divider(),
      design.it('Type your question. The layer searches products, pricing, FAQs, playbooks and past conversations.'),
      design.it('Examples:'),
      design.code('Which plan fits a company with 300 employees?'),
      design.code('Draft a proposal with our Enterprise pricing.'),
      design.code('What objections has Acme raised before?'),
      design.divider()
    ]),
    keyboard: design.keyboard([
      [design.textButton('Cancel', 'cc_kg_cancel')]
    ])
  };
}

function buildAskResult(userId, question, result) {
  const answerLines = result.answer
    ? result.answer.split('\n')
    : [design.it('I could not find an answer in your intelligence layer yet. Add documents about this topic, then ask again.')];
  const evidenceLines = result.evidence.slice(0, 3).map(e =>
    `${design.code(e.label)} ${design.b(e.title)} · score ${e.score}\n${design.it(e.excerpt.length > 90 ? e.excerpt.slice(0, 90) + '…' : e.excerpt)}`
  );
  const lines = [
    `${design.EMOJI.ai} ${design.b('Company Intelligence Answer')}`,
    design.it('Question: ' + question),
    design.it('Intent: ' + result.intent.label + (result.provider ? ` · ${result.provider_label || result.provider} ${result.model}` : ' · offline evidence')),
    design.divider(),
    ...answerLines,
    design.section('EVIDENCE'),
    ...(evidenceLines.length ? evidenceLines : [design.it('No evidence retrieved.')]),
    design.divider()
  ];
  return {
    text: design.compose(lines),
    keyboard: design.keyboard([
      [design.textButton('Ask Again', 'cc_kg_ask'), design.textButton('Intelligence Hub', 'cc_intelligence')],
      [design.textButton('Back to Home', 'cc_home')]
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
