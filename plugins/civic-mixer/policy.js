// plugins/civic-mixer/policy.js
// Governance gate (Elmahrosa Law over Code). Enforced by the platform before
// any adapter I/O and again by the MCP facade. Read-only capabilities are
// ungated; state-affecting capabilities (vote/issue write) additionally
// require a valid ICBC Authorization Stamp — the exclusive admissible proof
// that the action received explicit human institutional approval.
'use strict';

const { verifyStamp } = require('./authority');

const WRITE_ACTIONS = {
  'civic.vote.create': 'CIVIC_BALLOT_CREATE',
  'civic.issue.create': 'CIVIC_ISSUE_CREATE'
};

module.exports = {
  rules: [
    (request) => (request.toolId === 'civic.issue.create' && !(request.payload && request.payload.title)
      ? { allowed: false, reason: 'civic_title_required' }
      : null),
    (request) => (request.toolId === 'civic.vote.create' && !(request.payload && request.payload.ballotId)
      ? { allowed: false, reason: 'civic_ballot_required' }
      : null),
    (request) => {
      const actionType = WRITE_ACTIONS[request.toolId];
      if (!actionType) return null;
      const payload = request.payload || {};
      const stamp = payload.authorizationStamp || payload.authorization_stamp || null;
      const verdict = verifyStamp(stamp, { actionType });
      if (!verdict.ok) return { allowed: false, reason: verdict.reason, detail: verdict.detail || null };
      return null;
    }
  ]
};
