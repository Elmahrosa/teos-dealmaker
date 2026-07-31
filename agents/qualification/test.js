const { processResponse } = require('./index');

const mockResponses = [
  {
    id: 'resp_001',
    from: 'fawry@fawry.com',
    subject: 'Re: Partnership: TEOS Sentinel Shield',
    body: 'Sounds great! Let\'s schedule a demo to explore integration possibilities.',
    industry: 'fintech'
  },
  {
    id: 'resp_002',
    from: 'info@somecorp.com',
    subject: 'Re: Partnership inquiry',
    body: 'Not interested at this time. Please remove us from your list.',
    industry: 'retail'
  },
  {
    id: 'resp_003',
    from: 'ceo@startup.io',
    subject: 'Re: AI governance',
    body: 'Maybe. We are busy with our launch but send more info.',
    industry: 'ai'
  }
];

console.log('=== QUALIFICATION AGENT TEST ===\n');

mockResponses.forEach((resp, i) => {
  console.log(`--- Response ${i + 1}: ${resp.from} ---`);
  const result = processResponse(resp);
  console.log(`Result: ${result.routing.action} -> ${result.routing.target_agent || 'archive'}\n`);
});

console.log('=== TEST COMPLETE ===');
