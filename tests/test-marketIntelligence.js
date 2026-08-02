const { analyzeProspect } = require('../agents/marketIntelligence');

console.log('Testing Market Intelligence Agent...\n');

const testCases = [
  { id: 'p_001', company: 'TechCorp Enterprise', industry: 'Technology', employeeCount: 250 },
  { id: 'p_002', company: 'Local Bakery', industry: 'Retail', employeeCount: 12 },
  { id: 'p_003', company: 'FinServe Global', industry: 'Finance', employeeCount: 85 }
];

testCases.forEach((prospect, index) => {
  console.log(`Test ${index + 1}: Analyzing ${prospect.company}`);
  const result = analyzeProspect(prospect);
  console.log(`  Result: Fit Score ${result.fitScore} | Priority: ${result.priority}`);
});

console.log('\nVerification complete. Inspect data/vault/audit.log for MARKET_INTELLIGENCE_* entries.');
