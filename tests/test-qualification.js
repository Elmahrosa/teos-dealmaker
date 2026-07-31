const { classifyLead } = require('../agents/qualification/index');

console.log("Testing Qualification Agent (BANT Auto-Classification)...\n");

const testLeads = [
  { id: 'L-100', company: 'Nexus AI', budget: 10000, isDecisionMaker: true, hasClearNeed: true, timelineInMonths: 1 },
  { id: 'L-101', company: 'Apex Retail', budget: 2000, isDecisionMaker: false, hasClearNeed: true, timelineInMonths: 6 },
  { id: 'L-102', company: 'Sovereign Fintech', budget: 6000, isDecisionMaker: false, hasClearNeed: true, timelineInMonths: 2 }
];

testLeads.forEach((lead) => {
  console.log(`Analyzing Lead [${lead.id}] - ${lead.company}`);
  const result = classifyLead(lead);
  console.log(`  Score: ${result.score}/100`);
  console.log(`  Status: ${result.classification}`);
  console.log(`  Action: ${result.nextStep}`);
  if (result.missingCriteria.length > 0) {
    console.log(`  Gaps: ${result.missingCriteria.join(', ')}`);
  }
  console.log('---');
});

console.log("\nQualification pipeline simulation complete.");
console.log("Inspect data/vault/audit.log to verify QUALIFICATION_AGENT_* entries.");
