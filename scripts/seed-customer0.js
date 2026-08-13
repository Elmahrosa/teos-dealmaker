'use strict';

// scripts/seed-customer0.js
// Idempotent Customer #0 self-sale seed.
//
// Provisions (via the existing founder seed):
//   - Bosta (Egypt logistics, CEO Mohamed Ezzat) — top opportunity, with the
//     founder-approved outreach draft held at PENDING_APPROVAL (governed).
//   - PushBots, Inc. (B2B SaaS) — qualified on the scorecard; no email is
//     drafted until the decision maker is identified.
//
// Nothing is sent. Drafts stay in the outbound email lifecycle until the
// founder approves through the authenticated surface, and the outbound worker
// is paused — so even an approval cannot produce a send.

const customer0 = require('../services/customer0');

function resolveAdapter() {
  try {
    return require('../db').getAdapter();
  } catch (_err) {
    return require('../db').createMemoryAdapter();
  }
}

async function main() {
  const adapter = resolveAdapter();
  const result = await customer0.seed({ adapter }, {});
  if (!result.seeded) {
    console.error('Seed failed:', result.reason || 'unknown');
    process.exitCode = 1;
    return;
  }
  console.log('Customer #0 seed complete.');
  console.log('  Created prospects  :', result.createdProspects);
  console.log('  Created drafts     :', result.createdEmails);
  console.log('  Existing (skipped) :', result.existing);
  console.log('  Note               :', result.note);
  const queue = await customer0.pendingOutreach({ adapter }, {});
  console.log('Pending outreach queue:', queue.length);
  for (const q of queue) {
    console.log(`  #${q.id} [${q.status}] ${q.company} — ${q.subject}`);
    console.log(`    Review/decide: ${q.links.review}`);
  }
  await adapter.close && adapter.close();
}

main().catch(err => {
  console.error('seed-customer0 failed:', err.message);
  process.exitCode = 1;
});
