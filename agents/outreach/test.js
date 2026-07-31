const { runOutreachCycle } = require('./index');

const testTarget = {
  name: 'Fawry (Test)',
  email: 'partnerships@fawry.com',
  template: 'partnership'
};

console.log('=== OUTREACH AGENT TEST ===');
const result = runOutreachCycle(testTarget);
console.log(`Result: ${result.status}`);
console.log(`Message ID: ${result.message_id}`);
console.log('=== TEST COMPLETE ===');
