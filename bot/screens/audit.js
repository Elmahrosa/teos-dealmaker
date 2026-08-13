const design = require('../design');
const audit = require('../../utils/auditLogger');
const { statusEmoji } = require('./lib');

function buildAudit(offset) {
  const size = 8;
  const total = audit.countEntries();
  const tail = audit.readTail(size + (offset || 0));
  const page = tail.slice(-size).reverse();
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Audit Log')}`,
    design.it('Immutable activity feed'),
    design.divider(),
    ...(page.length ? page.map(e =>
      `${design.code((e.timestamp || '').slice(11, 19))} ${e.action} → ${e.target}\n${design.badge(statusEmoji(e.status))}`
    ) : [design.it('No entries.')]),
    design.divider()
  ]);
  const rows = [];
  const start = Math.max(0, total - size - (offset || 0));
  if (start > 0) rows.push([design.textButton('Earlier', `cc_audit:${(offset || 0) + size}`)]);
  rows.push([design.textButton('Back to Home', 'cc_home')]);
  return { text, keyboard: design.keyboard(rows) };
}

module.exports = { buildAudit };
