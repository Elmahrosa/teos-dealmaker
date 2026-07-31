const { runProspectingCycle } = require('../agents/prospecting');
const { processResponse } = require('../agents/qualification');

console.log("Testing Prospecting Agent...\n");

const leads = [
  { id: 'lead_001', company: 'FinServe Global', industry: 'Finance', employeeCount: 850, hasWebsite: true },
  { id: 'lead_002', company: 'TechCorp Enterprise', industry: 'Technology', employeeCount: 250, hasWebsite: true },
  { id: 'lead_003', company: 'Local Bakery', industry: 'Retail', employeeCount: 12, hasWebsite: false }
];

const { results, summary } = runProspectingCycle(leads);

results.forEach((r, i) => {
  console.log(`Lead ${i + 1}: ${r.company} -> Fit ${r.fitScore} | ${r.classification} | next: ${r.nextStep}`);
});

console.log(`\nSummary: ${summary.total} leads | Hot: ${summary.hot} | Warm: ${summary.warm} | Cold: ${summary.cold}`);

const hot = results.find(r => r.classification === 'Hot');
if (hot) {
  console.log(`\nRouting ${hot.company} to Qualification agent...`);
  processResponse({
    id: 'resp_' + hot.leadId,
    from: 'prospect@' + hot.company.toLowerCase().replace(/[^a-z]/g, '') + '.com',
    body: 'Sounds great! Let us schedule a demo to explore integration possibilities.',
    industry: 'fintech'
  });
}

console.log("\nVerification complete. Inspect data/vault/audit.log for PROSPECTING_AGENT_* and QUALIFICATION_AGENT_* entries.");
