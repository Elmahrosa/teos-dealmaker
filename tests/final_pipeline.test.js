const { buildPlaybook } = require('../agents/strategist');
const { craftPositioning } = require('../agents/marketer');
const { buildTerms } = require('../agents/negotiator');
const { draftContract, createCheckout, closeDeal } = require('../agents/treasurer');
const { closeDeal: closeDealAgent } = require('../agents/closing');
const audit = require('../utils/auditLogger');

async function main() {
  const lead = {
    id: 'deal_777',
    company: 'Nexus AI Sovereign',
    contactName: 'Layla Hassan',
    product: 'TEOS DealMaker Sovereign License',
    classification: 'Hot',
    fitScore: 92,
    budget: 15000,
    competitivePressure: 'low',
    industry: 'Technology',
    currency: 'USD',
    termMonths: 12,
    paymentMethod: 'invoice'
  };
  const targetPrice = 12500;

  console.log("🧪 Final Pipeline Test\n");
  console.log(`Processing deal for ${lead.company} (target ${targetPrice}).`);

  const playbook = buildPlaybook(lead);
  console.log(`1) Strategist -> ${playbook.style} playbook`);

  const positioning = craftPositioning(lead, playbook);
  console.log(`2) Marketer   -> ${positioning.headline}`);

  const terms = buildTerms(lead, targetPrice, lead.budget);
  console.log(`3) Negotiator -> feasible=${terms.feasible} | landing=${terms.landingPrice} | max discount=${terms.maxDiscountPct}% | ${terms.suggestedTerms}`);

  const deal = { ...lead, amount: terms.landingPrice };
  const contract = draftContract(deal);
  const checkout = await createCheckout(deal, contract);
  const summary = closeDeal(deal, contract, checkout);
  console.log(`4) Treasurer   -> ${contract.contractId} | ${checkout.url} | closed=${summary.status}`);

  const closed = closeDealAgent({
    id: lead.id,
    company: lead.company,
    amount: terms.landingPrice,
    currency: 'USD',
    contractId: contract.contractId,
    approved: true,
    paymentMethod: 'invoice'
  });
  console.log(`5) Closing     -> ${closed.status} (${closed.dealId})`);

  const entries = audit.readVault().filter(e =>
    /^(STRATEGIST_AGENT|MARKETER_AGENT|NEGOTIATOR_AGENT|TREASURER_AGENT|CLOSING_AGENT)/.test(e.action)
  );
  console.log(`\nPipeline audit entries: ${entries.length}`);
  console.log("Verify 'data/vault/audit.log' for the agent entries above.");
}

main().catch(err => {
  console.error("PIPELINE FAILED:", err);
  process.exit(1);
});
