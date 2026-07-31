const { runSalesCycle } = require('./index');

console.log('=== SALES AGENT TEST ===\n');

const testCases = [
  'This is too expensive for us right now.',
  'We need to check with our team lead before deciding.',
  'How do we know this actually works? Got any proof?'
];

testCases.forEach((test, i) => {
  console.log(`Test ${i + 1}: "${test}"`);
  const result = runSalesCycle(test);
  console.log(`→ Type: ${result.objection_type}, Action: ${result.suggested_action}\n`);
});
