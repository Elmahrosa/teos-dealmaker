'use strict';

const { REGISTRY } = require('../workforce/registry');

function matchers(id) {
  const map = {
    orchestrator: s => s === 'orchestrate' || s === 'orchestrator' || s === 'help',
    revenue_strategist: s => /mission|sales|strategy|campaign|roadmap/.test(s),
    prospecting: s => /prospect|customer|find|hunt|campaign|list/.test(s),
    market_intelligence: s => /research|dossier|signal|analy|intel|market/.test(s),
    qualification: s => /qualif|bant|score|lead|tier/.test(s),
    outreach: s => /outreach|email|follow|draft|contact|message/.test(s),
    strategist: s => /playbook|position|pricing|strategy|proposal|offer/.test(s),
    marketer: s => /value|position|messag|brand|narrative/.test(s),
    sales: s => /deal|close|proposal|negotiat|pipeline|opportunit/.test(s),
    negotiator: s => /negotiat|term|threshold|price|discount/.test(s),
    treasurer: s => /invoice|checkout|contract|billing|payment|revenue|price/.test(s),
    gatekeeper: s => /approval|gate|safety|review|present|compliance/.test(s),
    closing: s => /close|block|won|lost|contract/.test(s)
  };
  return map[id] || (() => false);
}

const AGENTS = Object.entries(REGISTRY).map(([id, def]) => ({
  id,
  label: def.label,
  role: def.role,
  canHandle(input) {
    return matchers(id)(String(input || '').toLowerCase());
  },
  health: () => ({ ok: true, status: 'healthy' }),
  priority: () => (def.cadence != null ? def.cadence : 10),
  suggestions: () => [],
  handoff: () => null
}));

function byId(id) {
  return AGENTS.find(a => a.id === id) || null;
}

function select(input, { exclude = [], max = 3 } = {}) {
  return AGENTS
    .filter(a => !exclude.includes(a.id) && a.health().ok && a.canHandle(input))
    .sort((a, b) => a.priority() - b.priority() || a.id.localeCompare(b.id))
    .slice(0, max);
}

function orchestrator(input) {
  const picks = select(input);
  if (!picks.length) return null;
  return {
    primary: picks[0],
    alternatives: picks.slice(1),
    handoff: () => picks[1] || null
  };
}

module.exports = { AGENTS, REGISTRY, byId, select, orchestrator };
