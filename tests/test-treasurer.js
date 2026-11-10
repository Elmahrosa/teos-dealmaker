'use strict';

const assert = require('assert');
const { createCheckout, closeDeal } = require('../agents/treasurer');

async function main() {
  const deal = { id: 'test-deal', company: 'Test Company' };
  const contract = {
    contractId: 'test-contract',
    amount: 100,
    currency: 'USD'
  };

  const checkout = await createCheckout(deal, contract);
  assert.strictEqual(checkout, null, 'Checkout must remain disabled');

  const result = closeDeal(deal, contract, null);
  assert.strictEqual(result.checkoutId, null);
  assert.strictEqual(result.won, false);
  assert.strictEqual(result.status, 'awaiting_customer');
  assert.match(result.reason, /customer acceptance/i);
  assert.match(result.reason, /verified payment evidence/i);

  console.log('PASS: no checkout; deal remains open pending customer acceptance and verified payment.');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
