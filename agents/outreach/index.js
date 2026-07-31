const { draftOutreach } = require('./drafter');
const { reviewMessage } = require('./gatekeeper');
const audit = require('../../utils/auditLogger');

function runOutreachCycle(target) {
  console.log(`[Outreach] Starting cycle for ${target.name}`);

  // 1. Draft
  const drafted = draftOutreach(target);
  console.log(`[Outreach] Drafted message to ${drafted.to}`);
  audit.writeEntry('OUTREACH_DRAFT', target.name, 'success', drafted);

  // 2. Gatekeeper review
  const reviewed = reviewMessage(drafted);
  console.log(`[Outreach] Gatekeeper: ${reviewed.status}`);
  audit.writeEntry('OUTREACH_REVIEW', target.name, reviewed.status, reviewed);

  if (reviewed.status === 'REJECTED') {
    console.log(`[Outreach] REJECTED: ${reviewed.reason}`);
    return { status: 'REJECTED', cycle: reviewed };
  }

  // 3. Route (vault)
  audit.writeEntry('OUTREACH_SENT', target.name, 'success', {
    to: reviewed.original.to,
    message_id: reviewed.message_id
  });

  console.log(`[Outreach] Cycle complete. Message ID: ${reviewed.message_id}`);

  return {
    status: 'SUCCESS',
    message_id: reviewed.message_id,
    drafted,
    reviewed
  };
}

module.exports = { runOutreachCycle };
