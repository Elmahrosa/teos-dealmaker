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

async function editPanel(bot, query, screen) {
  await bot.editMessageText(screen.text, {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: screen.keyboard
  });
}

function learnScreen(res) {
  return { text: res.prompt, keyboard: res.keyboard };
}

function lastEntry() {
  const entries = audit.readVault();
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
  return audit.readVault().filter(e =>
    e.action.startsWith('OUTREACH') && (e.timestamp || '').startsWith(today)
  ).length;
}

function recentErrors() {
  const entries = audit.readVault();
  return entries.slice(-50).filter(e => e.status === 'error').length;
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
