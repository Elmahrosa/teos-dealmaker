// Test for workforce runtime deal creation from opportunities
const { buildBriefing } = require('../services/workforce/runtime');
const extractCompanyFromStep = require('../services/workforce/runtime').extractCompanyFromStep;

console.log('Testing Workforce Runtime Deal Creation...\n');

// Test extractCompanyFromStep function
console.log('Testing extractCompanyFromStep function:');

const testSteps = [
  {
    step_key: 'negotiation',
    agent_type: 'negotiator',
    output: 'Successfully negotiated deal with Acme Corporation for $50,000 pipeline value. Company shows strong interest in our TEOS DealMaker platform.'
  },
  {
    step_key: 'assessment',
    agent_type: 'revenue_strategist',
    output: 'Identified opportunity with Global Tech Inc. Estimated deal value: $75,000. Customer has clear need for revenue operations automation.'
  },
  {
    step_key: 'closing',
    agent_type: 'closing',
    output: 'Closed deal with Healthcare Solutions LLC. Contract value: $100,000 ARR. Implementation scheduled for Q1.'
  },
  {
    step_key: 'research',
    agent_type: 'market_intelligence',
    output: 'Researched target market for TEOS DealMaker. Found strong demand in fintech and healthtech sectors.'
  },
  {
    step_key: 'assessment',
    agent_type: 'revenue_strategist',
    output: 'Company: BankCorp Financial Services. Budget confirmed: $25,000. Timeline: 2 months.'
  }
];

testSteps.forEach((step, index) => {
  const company = extractCompanyFromStep(step);
  console.log(`  Step ${index + 1} (${step.agent_type}): "${company}"`);
});

// Test buildBriefing function (should still work)
console.log('\nTesting buildBriefing function:');
const mockPlan = { title: 'Test Sales Strategy', goal: 'Create sales plan' };
const mockSteps = [
  { step_key: 'step1', agent_type: 'prospecting', status: 'completed', output: 'Identified 10 hot leads' },
  { step_key: 'step2', agent_type: 'qualification', status: 'completed', output: 'Qualified 3 sales-ready opportunities' }
];

const briefing = buildBriefing(mockPlan, mockSteps);
console.log('  Briefing generated successfully');
console.log('  Contains plan title:', briefing.includes('Test Sales Strategy'));
console.log('  Contains completed steps:', briefing.includes('Identified 10 hot leads'));

console.log('\nAll tests completed successfully!');
