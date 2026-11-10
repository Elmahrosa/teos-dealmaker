const dispatcher = require('./dispatcher');

const PRIORITY_BY_AGENT = {
  revenue_strategist: 1,
  treasurer: 1,
  closing: 1,
  negotiator: 2,
  outreach: 4,
  strategist: 3,
  qualification: 3,
  orchestrator: 3,
  gatekeeper: 3,
  prospecting: 4,
  marketer: 4,
  research: 5,
  market_intelligence: 5,
  intelligence: 5,
  summary: 6
};

function intentOf(goal) {
  const g = String(goal || '').toLowerCase();
  if (/(sell|selling|sales mission|revenue mission|launch sales|بيع|مبيعات)/.test(g)) return 'sell';
  if (/(outreach|cold|email campaign|sequence)/.test(g)) return 'outreach';
  if (/(research|analy|dossier|company profile)/.test(g)) return 'research';
  if (/(qualif|fit score|bant|lead scoring)/.test(g)) return 'qualification';
  if (/(proposal|offer|quote)/.test(g)) return 'proposal';
  if (/(close|deal|negotiate|pipeline|contract|invoice)/.test(g)) return 'deal';
  return 'general';
}

function buildSteps(goal, intent) {
  const steps = [];
  const add = (agent_type, step_key, task, { group = 'sequential', depends_on = [], priority = null } = {}) => {
    steps.push({
      step_key,
      agent_type,
      step_group: group,
      depends_on: depends_on.length ? depends_on : null,
      task,
      priority: priority || PRIORITY_BY_AGENT[agent_type] || 4
    });
    return step_key;
  };

  const templates = {
    sell: () => {
      add('revenue_strategist', 'commercial_brief', `Define the commercial objective, measurable KPIs, operating budget and approval boundaries for selling this product or service: "${goal}". Use only the seller identity and business context explicitly provided by the user.`);
      const marketKey = add('market_intelligence', 'market_map', `Identify the strongest buyer segments, geographies, buying triggers and competitor alternatives for the specific product or service in: "${goal}". Separate evidence from assumptions.`, { group: 'parallel' });
      const positioningKey = add('strategist', 'positioning', `Create the ideal customer profile, value proposition and differentiation for the product or service in: "${goal}". Do not invent capabilities, proof or customer results.`, { depends_on: [marketKey] });
      const prospectKey = add('prospecting', 'prospects', `Build a prioritized, evidence-based prospect list for the product or service in: "${goal}". Include source and fit rationale; do not fabricate contacts.`, { depends_on: [positioningKey] });
      const qualifyKey = add('qualification', 'qualify', `Score prospects against need, authority, budget, timing and fit for: "${goal}". Mark unknown fields as unknown; prioritize high-fit buyers.`, { depends_on: [prospectKey] });
      const messageKey = add('marketer', 'personalize', `Create tailored value messages and objection-aware angles for the qualified prospects for: "${goal}".`, { depends_on: [qualifyKey] });
      const termsKey = add('negotiator', 'offer', `Prepare a commercially sound offer, pricing options and negotiation boundaries for: "${goal}". Never grant discounts or change terms without delegated authority.`, { depends_on: [messageKey] });
      const reviewKey = add('gatekeeper', 'policy_review', `Review prospect sources, claims, personalization, pricing and outreach drafts for compliance and accuracy for: "${goal}". Block unsupported claims and unsafe outreach.`, { depends_on: [termsKey] });
      add('outreach', 'outreach_drafts', `Prepare individualized outreach and follow-up drafts for approved high-fit prospects for: "${goal}". Sending requires explicit channel authorization and approval.`, { depends_on: [reviewKey] });
      add('treasurer', 'checkout_ready', `Prepare a quote, payment instructions or checkout handoff for: "${goal}". Do not charge, invoice or make a financial commitment without explicit approval.`, { depends_on: [reviewKey] });
      add('sales', 'objection_playbook', `Prepare responses to likely buyer objections and a qualification-to-meeting handoff for: "${goal}".`, { depends_on: [messageKey] });
      add('closing', 'close_plan', `Define close criteria, next steps and payment-confirmation requirements for: "${goal}". Never report a sale without verified buyer acceptance and payment evidence.`, { depends_on: ['outreach_drafts', 'checkout_ready', 'objection_playbook'] });
    },
    deal: () => {
      add('revenue_strategist', 'assess', `Act as Revenue Strategist. Decide whether this mission makes sense, choose which specialist agents should participate, set success criteria and a cost budget, and decide when to ask for human approval. Goal: "${goal}".`);
      add('strategist', 'strategy', `Build a tactical playbook for the goal: "${goal}". Define positioning, target pricing and the sequence of moves.`);
      const researchKey = add('market_intelligence', 'research', `Compile a company dossier with recent signals and competitive context for the goal: "${goal}".`, { group: 'parallel' });
      const qualKey = add('qualification', 'qualification', `Classify the target by BANT fit and route to the qualification queue for the goal: "${goal}".`, { group: 'parallel', depends_on: [researchKey] });
      const negotiationKey = add('negotiator', 'terms', `Set terms, discount thresholds and negotiation parameters for the goal: "${goal}".`, { depends_on: [qualKey] });
      const reviewKey = add('gatekeeper', 'review', `Review the draft against safety policy and pricing consistency for the goal: "${goal}".`, { depends_on: [negotiationKey] });
      add('treasurer', 'finalize', `Prepare the contract and checkout for the goal: "${goal}". Requires founder approval before anything is sent or issued.`, { depends_on: [reviewKey] });
    },
    proposal: () => {
      add('revenue_strategist', 'assess', `Act as Revenue Strategist. Decide whether this mission makes sense, set success criteria and a cost budget, and decide when to ask for human approval. Goal: "${goal}".`);
      add('strategist', 'strategy', `Build a tactical playbook for the goal: "${goal}". Define positioning and value framing.`);
      const researchKey = add('market_intelligence', 'research', `Compile a company dossier with recent signals for the goal: "${goal}".`, { group: 'parallel' });
      const offerKey = add('negotiator', 'terms', `Set terms and target pricing for the proposal in: "${goal}".`, { group: 'parallel', depends_on: [researchKey] });
      const reviewKey = add('gatekeeper', 'review', `Review the proposal draft against pricing, tone and formatting standards for: "${goal}".`, { depends_on: [offerKey] });
      add('outreach', 'send', `Send the proposal and follow-up message to the target described in: "${goal}". Requires founder approval before sending.`, { depends_on: [reviewKey] });
    },
    outreach: () => {
      add('revenue_strategist', 'assess', `Act as Revenue Strategist. Decide whether this outreach mission makes sense, set success criteria and a cost budget, and decide when to ask for human approval. Goal: "${goal}".`);
      const researchKey = add('prospecting', 'research', `Add the target of "${goal}" to the research queue for scoring.`, { group: 'parallel' });
      const intelKey = add('market_intelligence', 'intel', `Compile a company dossier with recent signals for the target in "${goal}".`, { group: 'parallel' });
      add('outreach', 'draft', `Draft a personalized first-touch email for the target in "${goal}".`, { depends_on: [researchKey, intelKey] });
    },
    research: () => {
      add('revenue_strategist', 'assess', `Act as Revenue Strategist. Decide whether this research mission makes sense, set success criteria and a cost budget, and decide when to ask for human approval. Goal: "${goal}".`);
      const intelKey = add('market_intelligence', 'intel', `Compile a company dossier with recent signals for: "${goal}".`, { group: 'parallel' });
      const deepKey = add('research', 'deep', `Run deep analysis on the topic in: "${goal}".`, { group: 'parallel' });
      add('intelligence', 'synthesis', `Answer the question in "${goal}" from retrieved company knowledge with cited sources, merging the parallel findings.`, { depends_on: [intelKey, deepKey] });
    },
    qualification: () => {
      const researchKey = add('prospecting', 'research', `Add the target of "${goal}" to the research queue for scoring.`);
      add('qualification', 'score', `Classify the target in "${goal}" by BANT and route to the qualification queue.`, { depends_on: [researchKey] });
    },
    general: () => {
      add('revenue_strategist', 'assess', `Act as Revenue Strategist. Decide whether this mission makes sense, choose which specialist agents should participate, set success criteria and a cost budget, and decide when to ask for human approval. Goal: "${goal}".`);
      add('orchestrator', 'plan', `Route the goal to the highest-fit agent for immediate action: "${goal}".`);
      const intelKey = add('intelligence', 'research', `Answer the question in "${goal}" from retrieved company knowledge with cited sources.`, { group: 'parallel' });
      add('strategist', 'playbook', `Write a tactical playbook for the goal: "${goal}".`, { group: 'parallel', depends_on: [intelKey] });
    }
  };

  templates[intent]();
  return steps;
}

function planGoal(goal, opts) {
  const o = opts || {};
  const intent = o.intent || intentOf(goal);
  const steps = buildSteps(goal, intent).map(step => {
    const route = dispatcher.dispatch({ agentType: step.agent_type, priority: step.priority, quality: o.quality });
    return { ...step, provider: route.provider, model: route.model, simulated: route.simulated };
  });
  return { intent, version: 'v1.0.0', steps };
}

module.exports = { PRIORITY_BY_AGENT, intentOf, buildSteps, planGoal };
