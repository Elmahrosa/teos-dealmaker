const { runProspectingCycle } = require('../agents/prospecting');
const { classifyLead, DEFAULT_ICP_CRITERIA } = require('../agents/qualification');

console.log('Testing Prospecting Agent...\n');

const leads = [
  {
    id: 'lead_001',
    company: 'FinServe Global',
    industry: 'Finance',
    employeeCount: 850,
    hasWebsite: true,
    contact_email: 'ceo@finserve.com',
    budget: 10000,
    isDecisionMaker: true,
    hasClearNeed: true,
    timelineInMonths: 2
  },
  {
    id: 'lead_002',
    company: 'TechCorp Enterprise',
    industry: 'Technology',
    employeeCount: 250,
    hasWebsite: true,
    contact_email: 'founder@techcorp.com',
    budget: 7500,
    isDecisionMaker: true,
    hasClearNeed: true,
    timelineInMonths: 1
  },
  {
    id: 'lead_003',
    company: 'Local Bakery',
    industry: 'Retail',
    employeeCount: 12,
    hasWebsite: false,
    contact_email: 'owner@localbakery.com',
    budget: 2000,
    isDecisionMaker: true,
    hasClearNeed: false,
    timelineInMonths: 6
  }
];

const { results, summary } = runProspectingCycle(leads);

results.forEach((r, i) => {
  console.log(`Lead ${i + 1}: ${r.company} -> Fit ${r.fitScore} | ${r.classification} | next: ${r.nextStep}`);
  // Log structured data for verification
  if (r.structuredData) {
    console.log('  Structured Data:', JSON.stringify(r.structuredData, null, 2));
  }
});

console.log(`\nSummary: ${summary.total} leads | Hot: ${summary.hot} | Warm: ${summary.warm} | Cold: ${summary.cold}`);

// Test qualification with ICP criteria
const hot = results.find(r => r.classification === 'Hot');
if (hot && hot.structuredData) {
  console.log(`\nRouting ${hot.company} to Qualification agent...`);
  const qualificationResult = classifyLead(hot.structuredData, DEFAULT_ICP_CRITERIA);
  console.log('Qualification Result:', JSON.stringify(qualificationResult, null, 2));

  // Test with warm lead too
  const warm = results.find(r => r.classification === 'Warm');
  if (warm && warm.structuredData) {
    console.log(`\nRouting ${warm.company} to Qualification agent...`);
    const warmQualification = classifyLead(warm.structuredData, DEFAULT_ICP_CRITERIA);
    console.log('Warm Lead Qualification:', JSON.stringify(warmQualification, null, 2));
  }
}

console.log('\nVerification complete. Inspect data/vault/audit.log for PROSPECTING_AGENT_* and QUALIFICATION_AGENT_* entries.');

