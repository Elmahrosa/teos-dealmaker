const { runOrchestrator } = require('./index');

const testResponses = [
  {
    id: 'orch_001',
    from: 'fawry@fawry.com',
    body: 'Sounds great! Let us schedule a call to explore integration possibilities.',
    industry: 'fintech'
  },
  {
    id: 'orch_002',
    from: 'info@somecorp.com',
    body: 'Not interested at this time. Please remove us.',
    industry: 'retail'
  },
  {
    id: 'orch_003',
    from: 'ceo@startup.io',
    body: 'Maybe. We are busy with our launch but send more info.',
    industry: 'ai'
  }
];

console.log('=== ORCHESTRATOR TEST ===\n');

testResponses.forEach((resp, i) => {
  console.log(`--- Response ${i + 1}: ${resp.from} ---`);
  const result = runOrchestrator(resp);
  console.log(`→ Stage: ${result.outcome.stage}\n`);
});

console.log('=== TEST COMPLETE ===');
