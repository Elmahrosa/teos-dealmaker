const { classifyLead, DEFAULT_ICP_CRITERIA } = require('../agents/qualification/index');

console.log('Testing Qualification Agent (ICP-Enabled Classification)...\n');

const testLeads = [
  { id: 'L-100', company: 'Nexus AI', budget: 10000, isDecisionMaker: true, hasClearNeed: true, timelineInMonths: 1, industry: 'Technology', employeeCount: 50 },
  { id: 'L-101', company: 'Apex Retail', budget: 2000, isDecisionMaker: false, hasClearNeed: true, timelineInMonths: 6, industry: 'Retail', employeeCount: 5 },
  { id: 'L-102', company: 'Sovereign Fintech', budget: 6000, isDecisionMaker: false, hasClearNeed: true, timelineInMonths: 2, industry: 'Finance', employeeCount: 30 }
];

testLeads.forEach((lead) => {
  console.log(`Analyzing Lead [${lead.id}] - ${lead.company}`);
  const result = classifyLead(lead, DEFAULT_ICP_CRITERIA);
  console.log(`  Score: ${result.score}/100`);
  console.log(`  Status: ${result.classification}`);
  console.log(`  Action: ${result.nextStep}`);
  if (result.missingCriteria.length > 0) {
    console.log(`  Gaps: ${result.missingCriteria.join(', ')}`);
  }
  console.log('---');
});

// Test with custom ICP criteria
console.log('\n--- Testing with Custom ICP Criteria ---');
const customICP = {
  minBudget: 5000,
  maxTimelineMonths: 3,
  targetIndustries: ['Technology', 'Finance'],
  minEmployeeCount: 20,
  requiredTechnologies: ['AI', 'cloud']
};

const techLead = {
  id: 'L-200',
  company: 'AI Startup',
  budget: 8000,
  isDecisionMaker: true,
  hasClearNeed: true,
  timelineInMonths: 2,
  industry: 'Technology',
  employeeCount: 25,
  technologies: ['AI', 'machine learning']
};

console.log(`Analyzing Lead [${techLead.id}] - ${techLead.company} with Custom ICP:`);
const customResult = classifyLead(techLead, customICP);
console.log(`  Score: ${customResult.score}/100`);
console.log(`  Status: ${customResult.classification}`);
console.log(`  Action: ${customResult.nextStep}`);
if (customResult.missingCriteria.length > 0) {
  console.log(`  Gaps: ${customResult.missingCriteria.join(', ')}`);
}

console.log('\nQualification pipeline simulation complete.');
console.log('Inspect data/vault/audit.log to verify QUALIFICATION_AGENT_* entries.');

