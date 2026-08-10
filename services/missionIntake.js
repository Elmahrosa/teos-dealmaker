'use strict';

// Mission intake: the one-shot customer funnel behind the /start web page.
// The customer answers a short set of questions; the answers are stored as
// the mission context for a governed AI Revenue Team. Submission only records
// the intake with status 'received' — it never claims execution happened.
//
// Contact is optional: when the customer provides none, the canonical
// fallback string is stored so the founder console always shows a clear
// channel state. Nothing here logs or returns secrets; the page is served by
// server/index.js and the founder reviews intakes through the audit-gated
// /intakes console.

const CONTACT_FALLBACK = 'Contact channel not yet established';
const ANSWER_KEYS = ['outcome', 'target_customer', 'market', 'budget', 'timeline', 'capabilities'];

function normalize(payload) {
  const src = (payload && typeof payload === 'object') ? payload : {};
  const errors = [];

  const str = (v) => String(v == null ? '' : v).trim();

  const title = str(src.mission || src.title);
  const objective = str(src.objective || src.business);
  // When the customer provides no email or phone number, store the canonical
  // fallback instead of an empty string so the channel state is explicit.
  const contact = str(src.contact) || CONTACT_FALLBACK;

  if (!title) errors.push('mission');
  if (!objective) errors.push('objective');
  if (contact.length > 500) errors.push('contact');
  if (title.length > 300) errors.push('mission');
  if (objective.length > 5000) errors.push('objective');

  const answers = {};
  for (const key of ANSWER_KEYS) {
    const v = str(src[key]);
    if (v) answers[key] = v;
  }

  const row = {
    title,
    objective,
    outcome: str(src.outcome),
    target_customer: str(src.target_customer),
    market: str(src.market),
    budget: str(src.budget),
    timeline: str(src.timeline),
    capabilities: str(src.capabilities),
    contact,
    status: 'received',
    answers
  };

  return { ok: errors.length === 0, errors, row };
}

// Shared in-process memory fallback for the intake routes when no
// DATABASE_URL is configured (dev/demo). Real deployments use Postgres via
// db.getAdapter(); this only keeps the funnel working without a database.
let shared = null;
function sharedAdapter() {
  if (!shared) shared = require('../db').createMemoryAdapter();
  return shared;
}

module.exports = { normalize, CONTACT_FALLBACK, ANSWER_KEYS, sharedAdapter };
