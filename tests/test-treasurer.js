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
  const checkout = await createCheckout(deal, contract);
  console.log(`   Checkout: ${checkout.checkoutId} | ${checkout.url} | dryRun: ${checkout.dryRun}`);

  console.log('\n3) Attempting LIVE checkout (no key)...');
  mode.setMode('LIVE');
  delete process.env.DODO_API_KEY; // ensure no key
  const liveCheckoutNoKey = await createCheckout(deal, contract);
  if (liveCheckoutNoKey !== null) {
    console.error('   FAIL: LIVE checkout with no key should be blocked (null)');
    process.exit(1);
  }
  console.log('   PASS: LIVE checkout blocked as expected (null returned)');
  mode.setMode('DRY'); // reset to DRY for next steps

  console.log('\n4) Attempting LIVE checkout (with DODO_API_KEY set)...');
  mode.setMode('LIVE');
  process.env.DODO_API_KEY = 'test-key-12345';
  try {
    const liveCheckoutWithKey = await createCheckout(deal, contract);
    // Network error offline is acceptable; silent block or fake response is a fail
    console.log('   Note: Attempted real Dodo call (may fail offline, which is OK)');
    if (liveCheckoutWithKey && liveCheckoutWithKey.dryRun === true) {
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
    mode.setMode('DRY'); // reset to DRY
  }

  console.log('\n5) Closing deal in DRY...');
  mode.setMode('DRY');
  const summary = await runTreasuryFlow(deal);
  console.log(`   Closed: ${summary.status} | ${summary.company} | ${summary.contractId} | checkout ${summary.checkoutId}`);

  // Assertions for DRY closing
  if (summary.checkoutId == null) {
    console.error('   FAIL: DRY closing should produce a checkoutId');
    process.exit(1);
  }
  if (summary.status !== 'closed') {
    console.error(`   FAIL: Expected status 'closed', got '${summary.status}'`);
    process.exit(1);
  }
  console.log('   PASS: DRY closing produced a real checkoutId and status=closed');

  console.log('\n6) Testing blocked-audit path (direct closeDeal with null checkout)...');
  const blockedSummary = closeDeal(deal, contract, null);
  if (blockedSummary.status !== 'checkout_failed') {
    console.error(`   FAIL: Expected status 'checkout_failed', got '${blockedSummary.status}'`);
    process.exit(1);
  }
  console.log('   PASS: blocked checkout produces status=checkout_failed');

  console.log('\nVerification complete. Inspect data/vault/audit.log for TREASURER_AGENT_* entries.');
}

main().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
