const { buildPlaybook } = require('../agents/strategist');
const { craftPositioning } = require('../agents/marketer');

console.log('Testing Marketer Agent...\n');

const lead = { id: 'lead_001', company: 'FinServe Global', classification: 'Hot', fitScore: 92, budget: 30000 };
const playbook = buildPlaybook(lead);
const positioning = craftPositioning(lead, playbook);

console.log(`Playbook style: ${playbook.style}`);
console.log(`Headline: ${positioning.headline}`);
console.log(`Tone: ${positioning.tone}`);
console.log(`Hook: ${positioning.hook}`);
console.log(`Value props: ${positioning.valueProps.length}`);

console.log('\nVerification complete. Inspect data/vault/audit.log for MARKETER_AGENT_* entries.');
