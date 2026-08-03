const { draftContract, createCheckout, runTreasuryFlow } = require('../agents/treasurer');
const mode = require('../config/mode');

async function main() {
  console.log('Testing Treasurer Agent...\n');

  const deal = {
    id: 'deal_001',
    company: 'Nexus AI',
    contactName: 'Layla Hassan',
    product: 'TEOS DealMaker Enterprise License',
    amount: 48000,
    currency: 'USD',
    termMonths: 12,
    paymentMethod: 'invoice'
  };

  console.log('1) Drafting contract (DRY)...');
  const contract = draftContract(deal);
  console.log(`   Contract: ${contract.contractId} | ${contract.company} | ${contract.currency} ${contract.amount} / ${contract.termMonths}mo | monthly ${contract.monthlyPayment}`);
  console.log(`   Clauses: ${contract.clauses.length} | payment method: ${contract.paymentMethod}`);

  console.log('\n2) Creating DRY checkout...');
  const checkout = await createCheckout(deal, contract);
  console.log(`   Checkout: ${checkout.checkoutId} | ${checkout.url} | dryRun: ${checkout.dryRun}`);

  console.log('\n3) Attempting LIVE checkout (must be blocked)...');
  mode.setMode('LIVE');
  const blocked = await createCheckout(deal, contract);
  console.log(`   Result: ${blocked === null ? 'BLOCKED (correct)' : 'FAIL: was not blocked'}`);

  console.log('\n4) Closing deal in DRY...');
  mode.setMode('DRY');
  const summary = await runTreasuryFlow(deal);
  console.log(`   Closed: ${summary.status} | ${summary.company} | ${summary.contractId} | checkout ${summary.checkoutId}`);

  console.log('\nVerification complete. Inspect data/vault/audit.log for TREASURER_AGENT_* entries.');
}

main().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
