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
  return { intent, version: 'v0.8.0', steps };
}

module.exports = { PRIORITY_BY_AGENT, intentOf, buildSteps, planGoal };
