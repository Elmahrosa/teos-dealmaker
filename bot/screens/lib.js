const design = require('../design');
const audit = require('../../utils/auditLogger');
const { getWorkspaceContext } = require('../../services/workspace');
const { getStoreAdapter } = require('../store');

async function getCtx(userId) {
  try {
    return await getWorkspaceContext(getStoreAdapter(), userId);
  } catch (err) {
    console.error('[menu] context failed:', err.message);
    return null;
  }
}

function denied(resource) {
  const panel = design.errorPanel(
    'Access denied',
    `You do not have permission to open ${resource}.`
  );
  return {
    text: panel.text,
    keyboard: design.keyboard([
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

function isNotModified(err) {
  const msg = String((err && err.message) || err || '');
  return /message is not modified/i.test(msg);
}

// Telegram rejects the entire message when any part of the HTML is malformed.
// Screens escape their dynamic text, but the model answer and the document
// corpus are large enough that one missed case must not cost the user the whole
// reply: resend once as plain text and report that it happened.
function isParseError(err) {
  const msg = String((err && err.message) || err || '');
  return /can't parse entities|unsupported start tag|can't find end tag|entity parse/i.test(msg);
}

// Strip the markup design.js emits and undo esc() so the fallback reads as
// plain text instead of showing the user a wall of <b> tags.
function toPlainText(text) {
  return String(text)
    .replace(/<\/?(?:b|i|code)(?:\s[^>]*)?>/gi, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

async function sendHtml(bot, chatId, text, opts = {}) {
  const rest = { ...opts };
  delete rest.parse_mode;
  try {
    await bot.sendMessage(chatId, text, { ...rest, parse_mode: 'HTML' });
    return { fellBack: false };
  } catch (err) {
    if (!isParseError(err)) throw err;
    console.warn('[sendHtml] Telegram rejected the HTML, resending as plain text:', (err && err.message) || err);
    // No parse_mode in the retry, so the real content still reaches the user
    // instead of collapsing into a generic error. The keyboard is markup and
    // is preserved as-is.
    await bot.sendMessage(chatId, toPlainText(text), rest);
    return { fellBack: true };
  }
}

async function editPanel(bot, query, screen) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  try {
    await bot.editMessageText(screen.text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: screen.keyboard
    });
  } catch (err) {
    // Telegram 400 "message is not modified" is a harmless race (double tap /
    // repeat callback). Swallow it.
    if (isNotModified(err)) return;
    // Any other edit failure (deleted message, edited past the 48h window,
    // transient HTML/parse mismatch) must still show the user the target
    // screen. Fall back to sending a fresh message so a button press never
    // silently does nothing.
    try {
      await bot.sendMessage(chatId, screen.text, {
        parse_mode: 'HTML',
        reply_markup: screen.keyboard
      });
    } catch (sendErr) {
      console.error('[editPanel] fallback sendMessage failed:', sendErr && sendErr.message ? sendErr.message : sendErr);
    }
  }
}

function learnScreen(res) {
  return { text: res.prompt, keyboard: res.keyboard };
}

function lastEntry() {
  const entries = audit.readTail(1);
  if (entries.length === 0) return null;
  return entries[entries.length - 1];
}

function titleCase(str) {
  return String(str || '').replace(/\b\w/g, c => c.toUpperCase());
}

function greetingFor(timezone) {
  const now = new Date();
  let hour = now.getHours();
  try {
    hour = Number(new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timezone || 'UTC'
    }).format(now));
  } catch (_) { /* keep local hour */ }
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function outreachToday() {
  const today = new Date().toISOString().slice(0, 10);
  return audit.readTailSince(today).filter(e =>
    e.action.startsWith('OUTREACH') && (e.timestamp || '').startsWith(today)
  ).length;
}

function recentErrors() {
  const entries = audit.readTail(50);
  return entries.filter(e => e.status === 'error').length;
}

function nextRecommendation(ctx) {
  if (ctx.deals.total === 0) return 'Import your first leads to start the pipeline.';
  if (ctx.deals.open === 0) return 'Your pipeline is closed — import new leads to keep revenue flowing.';
  if (outreachToday() === 0) return 'Run an outreach cycle on your active deals.';
  return 'Follow up on your active deals to move them forward.';
}

function workforceStatus(agent) {
  const status = agent.status;
  if (status === 'running') return `${design.EMOJI.warning} Working`;
  if (status === 'waiting') return `${design.EMOJI.warning} Waiting`;
  if (status === 'paused') return `${design.EMOJI.critical} Paused`;
  return `${design.EMOJI.success} Ready`;
}

function statusEmoji(status) {
  if (['success', 'won', 'closed', 'SENT', 'APPROVE', 'dry_run'].includes(status)) return 'success';
  if (['dry_run', 'info', 'VAULTED_DRY'].includes(status)) return 'info';
  if (['in_progress', 'warning'].includes(status)) return 'warning';
  if (['error', 'denied', 'blocked', 'CRITICAL'].includes(status)) return 'critical';
  return 'info';
}

module.exports = {
  getCtx,
  denied,
  editPanel,
  isNotModified,
  isParseError,
  toPlainText,
  sendHtml,
  learnScreen,
  lastEntry,
  titleCase,
  greetingFor,
  outreachToday,
  recentErrors,
  nextRecommendation,
  workforceStatus,
  statusEmoji
};
