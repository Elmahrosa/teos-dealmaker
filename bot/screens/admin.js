const design = require('../design');
const audit = require('../../utils/auditLogger');
const { getMode, setMode } = require('../../config/mode');
const { isFounder, isAdmin } = require('../access');
const { editPanel } = require('./lib');

function buildAdmin(userId) {
  const mode = getMode();
  const rows = [];
  const body = [
    `${design.EMOJI.ai} ${design.b('Admin')}`,
    design.it('Operational control'),
    design.divider(),
    design.row('Mode', design.modeBadge(mode)),
    design.row('Role', isFounder(userId) ? design.badge('success') + ' Founder' : isAdmin(userId) ? design.badge('info') + ' Admin' : design.badge('warning') + ' Operator'),
    design.divider()
  ];
  if (isFounder(userId)) rows.push([design.textButton('Switch to LIVE', 'cc_live')]);
  if (isAdmin(userId)) rows.push([design.textButton('Switch to DRY', 'cc_dry')]);
  if (isAdmin(userId)) rows.push([design.textButton('Audit Log', 'cc_audit')]);
  rows.push([design.textButton('Back to Home', 'cc_home')]);
  return { text: design.compose(body), keyboard: design.keyboard(rows) };
}

function modeConfirm(mode) {
  const live = mode === 'LIVE';
  const target = live ? 'LIVE' : 'DRY';
  return design.confirmPanel(
    `Switch to ${target} mode?`,
    `${design.it(live
      ? 'Messages will be dispatched to customers without vault-only protection.'
      : 'All agent output will be vaulted and nothing is sent to customers.')}\n\n${design.row('Current mode', design.modeBadge(getMode()))}`,
    live ? 'cc_live_confirm' : 'cc_dry_confirm',
    live ? 'cc_live_cancel' : 'cc_dry_cancel',
    `Switch to ${target}`,
    'Cancel'
  );
}

async function applyMode(query, bot, mode) {
  setMode(mode);
  audit.writeEntry('BOT_MODE', 'system', 'success', { mode, by: query.from ? query.from.id : null });
  await editPanel(bot, query, buildAdmin(query.from ? query.from.id : null));
}

module.exports = { buildAdmin, modeConfirm, applyMode };
