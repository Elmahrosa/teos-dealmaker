'use strict';
module.exports = {
  'sentinel.scan': {
    type: 'object',
    properties: { scope: { type: 'string' } },
    additionalProperties: true
  },
  'sentinel.audit': {
    type: 'object',
    properties: { since: { type: 'string' }, limit: { type: 'number' } },
    additionalProperties: true
  },
  'sentinel.policy.check': {
    type: 'object',
    properties: { toolId: { type: 'string' }, workspaceId: { type: 'string' } },
    required: ['toolId'],
    additionalProperties: true
  },
  'sentinel.rules.list': {
    type: 'object',
    properties: { scope: { type: 'string' } },
    additionalProperties: true
  },
  'sentinel.health': {
    type: 'object',
    additionalProperties: true
  }
};
