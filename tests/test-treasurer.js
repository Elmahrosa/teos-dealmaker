const { draftContract, createCheckout, closeDeal, runTreasuryFlow } = require('../agents/treasurer');
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
  mode.setMode('DRY');
  const dryCheckout = await createCheckout(deal, contract);
  console.log(`   Checkout: ${dryCheckout.checkoutId} | ${dryCheckout.url} | dryRun: ${dryCheckout.dryRun}`);
  if (!dryCheckout || dryCheckout.dryRun !== true) {
    console.error('   FAIL: DRY checkout should have dryRun=true');
    process.exit(1);
  }
  console.log('   PASS: DRY checkout created successfully');


  console.log('\n4) Attempting LIVE checkout (with DODO_API_KEY set)...');
  mode.setMode('LIVE');
  process.env.DODO_API_KEY = 'test-key-12345';
  try {

      console.error('   FAIL: LIVE checkout should not return dryRun=true');
      process.exit(1);
    }
    console.log('   PASS: LIVE checkout attempted real API call');
  } catch (err) {
    const isNetworkFailure =
      err.message.includes('Dodo Payments error') ||
      err.message.includes('fetch') ||
      (err.cause && err.cause.code) || // getaddrinfo ENOTFOUND, ECONNREFUSED, etc.
      err.code === 'ENOTFOUND';
    if (isNetworkFailure) {
      console.log(`   PASS: attempted real Dodo call, network-level failure expected offline: ${err.message}`);
    } else {
      throw err;
    }
  } finally {
    delete process.env.DODO_API_KEY;

}

main().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});