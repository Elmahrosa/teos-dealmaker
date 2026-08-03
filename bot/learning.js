const learning = require('../services/learning');
const design = require('./design');

const sessions = new Map();

function current(session) {
  const q = questionFor(session);
  const context = session.currentName || null;
  const section = session.section;
  const sectionMeta = learning.SECTIONS.find(s => s.id === section);
  const list = listFor(section);
  const total = list.length;
  const idx = session.qIdx;
  return {
    type: 'question',
    section,
    sectionLabel: sectionMeta ? sectionMeta.label : section,
    question: q,
    context,
    idx: idx + 1,
    total,
    optional: !q.required,
    text: buildQuestionText(q, context, idx + 1, total, section)
  };
}

function listFor(section) {
  if (section === 'company') return learning.COMPANY_QUESTIONS;
  if (section === 'product') return learning.PRODUCT_QUESTIONS;
  if (section === 'playbook') return learning.PLAYBOOK_QUESTIONS;
  if (section === 'persona') return learning.PERSONA_QUESTIONS;
  return [];
}

function questionFor(session) {
  return listFor(session.section)[session.qIdx] || null;
}

function buildQuestionText(q, context, idx, total) {
  const ctx = context ? ` · ${design.b(context)}` : '';
  const optional = q.required ? '' : ' (optional)';
  return `${design.EMOJI.info} Question ${idx}/${total}${ctx}${optional}\n${design.b(q.text)}`;
}

function begin(userId) {
  sessions.set(userId, { section: 'company', qIdx: 0, currentName: null, enteredNames: [] });
}

function pending(userId) {
  return sessions.has(userId);
}

function resume(userId) {
  return pending(userId);
}

function sessionOf(userId) {
  return sessions.get(userId);
}

function clear(userId) {
  sessions.delete(userId);
}

async function handleSkip(userId, adapter, workspaceId) {
  const session = sessions.get(userId);
  if (!session) return null;
  const q = questionFor(session);
  if (q && q.required) return null;
  return advance(userId, adapter, workspaceId);
}

async function handleName(userId, adapter, workspaceId, name) {
  const session = sessions.get(userId);
  if (!session) return null;
  const isProduct = session.section === 'product' || session.section === 'product_name';
  const isPersona = session.section === 'persona' || session.section === 'persona_name';
  if (isProduct) await learning.record(adapter, workspaceId, { section: 'product', key: 'name', value: name, context: name });
  if (isPersona) await learning.record(adapter, workspaceId, { section: 'persona', key: 'name', value: name, context: name });
  session.currentName = name;
  session.enteredNames = session.enteredNames || [];
  session.enteredNames.push(name);
  if (isProduct) session.section = 'product';
  if (isPersona) session.section = 'persona';
  session.qIdx = 0;
  return buildPrompt(userId, adapter, workspaceId);
}

function another(userId) {
  const session = sessions.get(userId);
  if (!session) return null;
  if (session.section === 'product') session.section = 'product_name';
  else if (session.section === 'persona') session.section = 'persona_name';
  session.qIdx = 0;
  return session;
}

async function handleAnswer(userId, adapter, workspaceId, text) {
  const session = sessions.get(userId);
  if (!session) return { type: 'finished' };

  const mode = promptMode(session);

  if (mode === 'product_name') {
    const clean = String(text).trim();
    if (/^(done|finish|skip|next)$/i.test(clean)) {
      if (!session.enteredNames.length) {
        return {
          type: 'prompt',
          prompt: 'At least one product is required before moving on. Type the name of your first product.',
          keyboard: design.keyboard([[design.textButton('Quit Learning', 'cc_learn_quit')]])
        };
      }
      session.section = 'playbook';
      session.qIdx = 0;
      session.currentName = null;
      return buildPrompt(userId, adapter, workspaceId);
    }
    return handleName(userId, adapter, workspaceId, clean);
  }

  if (mode === 'product_done_prompt') {
    const clean = String(text).trim();
    if (/^(done|finish|skip|next|no)$/i.test(clean)) {
      session.section = 'playbook';
      session.qIdx = 0;
      session.currentName = null;
      return buildPrompt(userId, adapter, workspaceId);
    }
    return handleName(userId, adapter, workspaceId, clean);
  }

  if (mode === 'persona_name') {
    const clean = String(text).trim();
    if (/^(done|finish|skip|next)$/i.test(clean)) {
      if (!session.enteredNames.length) {
        return {
          type: 'prompt',
          prompt: 'Capture at least one buyer persona. Type a role (e.g. CTO) or pick one from the buttons.',
          keyboard: design.keyboard([
            ...learning.DEFAULT_PERSONAS.map(p => [design.textButton(p, `cc_learn_persona:${p}`)]),
            [design.textButton('Quit Learning', 'cc_learn_quit')]
          ])
        };
      }
      return finish(userId, adapter, workspaceId);
    }
    return handleName(userId, adapter, workspaceId, clean);
  }

  if (mode === 'persona_done_prompt') {
    const clean = String(text).trim();
    if (/^(done|finish|skip|next|no)$/i.test(clean)) {
      return finish(userId, adapter, workspaceId);
    }
    return handleName(userId, adapter, workspaceId, clean);
  }

  const q = questionFor(session);
  if (!q) return finish(userId, adapter, workspaceId);
  await learning.record(adapter, workspaceId, {
    section: session.section,
    key: q.key,
    value: text,
    context: session.currentName
  });
  return advance(userId, adapter, workspaceId);
}

function promptMode(session) {
  if (session.section === 'product' && session.qIdx >= learning.PRODUCT_QUESTIONS.length) return 'product_done_prompt';
  if (session.section === 'persona' && session.qIdx >= learning.PERSONA_QUESTIONS.length) return 'persona_done_prompt';
  if (session.section === 'product_name') return 'product_name';
  if (session.section === 'persona_name') return 'persona_name';
  return 'question';
}

function nextSection(section) {
  const order = ['company', 'product', 'playbook', 'persona'];
  const idx = order.indexOf(section);
  return idx >= 0 ? order[idx + 1] || null : null;
}

async function advance(userId, adapter, workspaceId) {
  const session = sessions.get(userId);
  if (!session) return { type: 'finished' };
  session.qIdx += 1;
  const list = listFor(session.section);
  if (session.qIdx >= list.length) {
    const next = nextSection(session.section);
    if (next === 'product' || next === 'persona') {
      session.section = next + '_name';
    } else if (next) {
      session.section = next;
    }
    session.qIdx = 0;
  }
  return buildPrompt(userId, adapter, workspaceId);
}

async function buildPrompt(userId, adapter, workspaceId) {
  const session = sessions.get(userId);
  if (!session) return { type: 'finished' };
  const mode = promptMode(session);

  if (mode === 'product_name') {
    return {
      type: 'prompt',
      prompt: `${design.EMOJI.info} ${design.b('Product Intelligence')}\n${design.it('Type the name of a product (e.g. "Enterprise Plan" or "TEOS SaaS").')}`,
      keyboard: design.keyboard([[design.textButton('Quit Learning', 'cc_learn_quit')]])
    };
  }
  if (mode === 'product_done_prompt') {
    return {
      type: 'prompt',
      prompt: `${design.EMOJI.info} ${design.b('Product Intelligence')}\n${design.it('Another product? Type its name, or choose')} ${design.b('Finish Products')}.`,
      keyboard: design.keyboard([
        [design.textButton('Add Another Product', 'cc_learn_more')],
        [design.textButton('Finish Products →', 'cc_learn_done')],
        [design.textButton('Quit Learning', 'cc_learn_quit')]
      ])
    };
  }
  if (mode === 'persona_name') {
    return {
      type: 'prompt',
      prompt: `${design.EMOJI.info} ${design.b('Customer Personas')}\n${design.it('Who is a buyer persona? Type a role or pick one.')}`,
      keyboard: design.keyboard([
        ...learning.DEFAULT_PERSONAS.map(p => [design.textButton(p, `cc_learn_persona:${p}`)]),
        [design.textButton('Done with Personas', 'cc_learn_done')],
        [design.textButton('Quit Learning', 'cc_learn_quit')]
      ])
    };
  }
  if (mode === 'persona_done_prompt') {
    return {
      type: 'prompt',
      prompt: `${design.EMOJI.info} ${design.b('Customer Personas')}\n${design.it('Another persona? Type a role, or choose')} ${design.b('Finish')}.`,
      keyboard: design.keyboard([
        [design.textButton('Add Another Persona', 'cc_learn_more')],
        [design.textButton('Finish →', 'cc_learn_done')],
        [design.textButton('Quit Learning', 'cc_learn_quit')]
      ])
    };
  }

  const cur = current(session, adapter, workspaceId);
  const buttons = [];
  if (cur.optional) buttons.push([design.textButton('Skip', 'cc_learn_skip')]);
  buttons.push([design.textButton('Quit Learning', 'cc_learn_quit')]);
  return {
    type: 'question',
    section: cur.section,
    question: cur.question,
    context: cur.context,
    idx: cur.idx,
    total: cur.total,
    prompt: cur.text,
    keyboard: design.keyboard(buttons)
  };
}

async function finish(userId, adapter, workspaceId) {
  const p = await learning.progress(adapter, workspaceId);
  const gaps = (await learning.validate(adapter, workspaceId)).gaps;
  clear(userId);
  const gapLines = gaps.length ? gaps.map(g => `${design.EMOJI.critical} ${g}`) : [];
  const text = design.compose([
    `${design.EMOJI.success} ${design.b('Mission 0 Complete')}`,
    design.it(`Company Intelligence ${p.pct}% · ${p.companyAnswered}/${p.companyTotal} company · ${p.products} product${p.products === 1 ? '' : 's'} · ${p.playbookAnswered}/${p.playbookTotal} playbook · ${p.personas} persona${p.personas === 1 ? '' : 's'}`),
    design.divider(),
    design.section('STILL TO CAPTURE (OPTIONAL)'),
    ...(gapLines.length ? gapLines : [design.it('Your knowledge foundation is complete.')]),
    design.section('NEXT'),
    design.it('Your workforce now acts with grounded company knowledge. Start Mission 1 to build your sales strategy.'),
    design.divider()
  ]);
  return { type: 'finished', prompt: text, keyboard: design.keyboard([[design.textButton('Start Mission 1', 'cc_mission1'), design.textButton('Home', 'cc_home')]]) };
}

module.exports = { begin, pending, resume, clear, sessionOf, handleAnswer, handleSkip, handleName, another, buildPrompt, finish };
