'use strict';
module.exports = {
  'civic.lookup': {
    type: 'object',
    properties: { civicId: { type: 'string' } },
    required: ['civicId'],
    additionalProperties: true
  },
  'civic.identity.verify': {
    type: 'object',
    properties: { identityId: { type: 'string' }, method: { type: 'string' } },
    required: ['identityId'],
    additionalProperties: true
  },
  'civic.vote.create': {
    type: 'object',
    properties: {
      ballotId: { type: 'string' },
      choice: { type: 'string' },
      authorizationStamp: { type: 'object' }
    },
    required: ['ballotId', 'authorizationStamp'],
    additionalProperties: true
  },
  'civic.issue.create': {
    type: 'object',
    properties: {
      title: { type: 'string' },
      body: { type: 'string' },
      category: { type: 'string' },
      authorizationStamp: { type: 'object' }
    },
    required: ['title', 'authorizationStamp'],
    additionalProperties: true
  },
  'civic.issue.list': {
    type: 'object',
    properties: { status: { type: 'string' }, limit: { type: 'number' } },
    additionalProperties: true
  }
};
