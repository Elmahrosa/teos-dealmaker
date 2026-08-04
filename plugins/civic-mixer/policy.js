'use strict';
module.exports = {
  rules: [
    (request) => (request.toolId === 'civic.vote.create' && !(request.payload && request.payload.ballotId)
      ? { allowed: false, reason: 'civic_ballot_required' }
      : null),
    (request) => (request.toolId === 'civic.issue.create' && !(request.payload && request.payload.title)
      ? { allowed: false, reason: 'civic_title_required' }
      : null)
  ]
};
