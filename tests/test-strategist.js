const { buildPlaybook } = require('../agents/strategist');

console.log("Testing Strategist Agent...\n");

const leads = [
  { id: 'lead_hot', company: 'FinServe Global', classification: 'Hot', fitScore: 92, budget: 30000 },
  { id: 'lead_cold', company: 'Local Bakery', classification: 'Cold', fitScore: 30, budget: 2000 },
  { id: 'lead_mid', company: 'TechCorp', classification: 'Warm', fitScore: 60, budget: 8000, competitivePressure: 'high' }
];

leads.forEach(lead => {
  const playbook = buildPlaybook(lead);
  console.log(`${lead.company} -> style: ${playbook.style}`);
  console.log(`  rationale: ${playbook.rationale.join(' ')}`);
  console.log(`  phases: ${playbook.phases.length}`);
});

console.log("\nVerification complete. Inspect data/vault/audit.log for STRATEGIST_AGENT_* entries.");
