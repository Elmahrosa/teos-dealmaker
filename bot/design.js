const EMOJI = {
  success: '🟢',
  info: '🔵',
  warning: '🟡',
  critical: '🔴',
  ai: '🤖',
  rocket: '🚀',
  target: '📈',
  globe: '🌍',
  brain: '🧠'
};

const STATUS_LABEL = {
  success: 'SUCCESS',
  info: 'INFO',
  warning: 'WARNING',
  critical: 'CRITICAL',
  ai: 'AI'
};

const LINE = '─';
const BAR_FILL = '█';
const BAR_EMPTY = '░';

function b(text) {
  return `<b>${text}</b>`;
}

function it(text) {
  return `<i>${text}</i>`;
}

function code(text) {
  return `<code>${text}</code>`;
}

function ltr(text) {
  return `\u202A${text}\u202C`;
}

function divider(width) {
  return LINE.repeat(width || 26);
}

function badge(status) {
  const key = STATUS_LABEL[status] ? status : 'info';
  return `${EMOJI[key]} ${b(STATUS_LABEL[key])}`;
}

function modeBadge(mode) {
  return mode === 'LIVE'
    ? `${EMOJI.critical} ${b('LIVE')}`
    : `${EMOJI.warning} ${b('DRY')}`;
}

function row(label, value) {
  return `${b(label)}  ${ltr(value)}`;
}

function stat(label, value) {
  return `${b(label)}\n${ltr(value)}`;
}

function list(items) {
  return items.map(item => `· ${item}`).join('\n');
}

function progressBar(steps, currentIndex, width) {
  const w = width || 10;
  return steps.map((step, i) => {
    let filled;
    if (i < currentIndex) filled = w;
    else if (i === currentIndex) filled = Math.round(w * 0.6);
    else filled = 0;
    const bar = BAR_FILL.repeat(filled) + BAR_EMPTY.repeat(w - filled);
    return `${code(bar)} ${b(step)}`;
  });
}

function textButton(label, callbackData) {
  return { text: label, callback_data: callbackData };
}

function urlButton(label, url) {
  return { text: label, url };
}

function keyboard(rows) {
  return { inline_keyboard: rows };
}

function confirmPanel(title, body, confirmData, cancelData, confirmLabel, cancelLabel) {
  return {
    text: [b(title), '', body].join('\n'),
    keyboard: keyboard([
      [textButton(confirmLabel || 'Confirm', confirmData)],
      [textButton(cancelLabel || 'Cancel', cancelData)]
    ])
  };
}

function errorPanel(title, detail) {
  return {
    text: [badge('critical'), b(title), '', detail].join('\n')
  };
}

function section(title) {
  return ['', b(title), divider()].join('\n');
}

function compose(blocks) {
  return blocks.filter(Boolean).join('\n\n');
}

module.exports = {
  EMOJI,
  STATUS_LABEL,
  b,
  it,
  code,
  ltr,
  divider,
  badge,
  modeBadge,
  row,
  stat,
  list,
  progressBar,
  textButton,
  urlButton,
  keyboard,
  confirmPanel,
  errorPanel,
  section,
  compose
};
