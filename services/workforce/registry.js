const REGISTRY = {
  orchestrator: { label: 'Orchestrator', role: 'Routes every request through the right agent', cadence: 5, queue: 'incoming' },
  revenue_strategist: { label: 'Revenue Strategist', role: 'Decides if a mission makes sense, picks specialists, sets success criteria and budget, and asks for human approval when needed', cadence: 5, queue: 'incoming' },
  prospecting: { label: 'Prospector', role: 'Finds and scores new companies', cadence: 60, queue: 'research' },
  market_intelligence: { label: 'Researcher', role: 'Analyzes companies and prospect fit', cadence: 60, queue: 'research' },
  qualification: { label: 'Qualifier', role: 'Classifies leads by BANT', cadence: 10, queue: 'qualification' },
  outreach: { label: 'Outreach', role: 'Drafts and dispatches emails', cadence: 30, queue: 'proposal' },
  strategist: { label: 'Strategist', role: 'Builds tactical deal playbooks', cadence: 15, queue: 'proposal' },
  marketer: { label: 'Marketer', role: 'Positions value for every deal', cadence: 15, queue: 'proposal' },
  sales: { label: 'Sales', role: 'Handles objections', cadence: 5, queue: 'negotiation' },
  negotiator: { label: 'Negotiator', role: 'Sets thresholds and terms', cadence: 15, queue: 'negotiation' },
  treasurer: { label: 'Treasurer', role: 'Drafts contracts and checkout', cadence: 15, queue: 'closing' },
  gatekeeper: { label: 'Gatekeeper', role: 'Reviews drafts for safety', cadence: 5, queue: 'qualification' },
  closing: { label: 'Closer', role: 'Closes or blocks deals', cadence: 15, queue: 'closing' }
};

module.exports = { REGISTRY };
