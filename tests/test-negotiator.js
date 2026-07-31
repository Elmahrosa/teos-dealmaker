const { buildTerms } = require('../agents/negotiator');

console.log("Testing Negotiator Agent...\n");

const cases = [
  { id: 'lead_hot', company: 'FinServe Global', targetPrice: 12500, budget: 15000 },
  { id: 'lead_lean', company: 'TechCorp', targetPrice: 12500, budget: 9000 },
  { id: 'lead_no', company: 'Local Bakery', targetPrice: 12500, budget: 3000 }
];

cases.forEach(c => {
  const terms = buildTerms(c, c.targetPrice, c.budget);
  console.log(`${c.company}: feasible=${terms.feasible} | floor=${terms.floorPrice} | landing=${terms.landingPrice} | max discount=${terms.maxDiscountPct}% | ${terms.suggestedTerms}`);
  console.log(`  offer ladder: ${terms.offerLadder.join(' -> ')}`);
});

console.log("\nVerification complete. Inspect data/vault/audit.log for NEGOTIATOR_AGENT_* entries.");
