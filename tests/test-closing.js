const { closeDeal } = require('../agents/closing');

console.log("Testing Closing Agent...\n");

const ready = {
  id: 'deal_001',
  company: 'Nexus AI',
  amount: 8750,
  currency: 'USD',
  contractId: 'CONTRACT-deal_001-20260731',
  approved: true,
  paymentMethod: 'invoice'
};

console.log("1) Ready deal (should close as won)...");
const won = closeDeal(ready);
console.log(`   Result: ${won.status} | ${won.company} | ${won.currency} ${won.amount}`);
console.log(`   Next steps: ${won.nextSteps.join(', ')}`);

const incomplete = {
  id: 'deal_002',
  company: 'Local Bakery',
  amount: 2000
};

console.log("\n2) Incomplete deal (should be blocked)...");
const blocked = closeDeal(incomplete);
console.log(`   Result: ${blocked.status} | missing: ${blocked.missing.join(', ')}`);

console.log("\nVerification complete. Inspect data/vault/audit.log for CLOSING_AGENT_* entries.");
