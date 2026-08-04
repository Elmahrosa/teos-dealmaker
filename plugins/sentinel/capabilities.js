// plugins/sentinel/capabilities.js
// Optional capability catalog helper for the sentinel plugin.
'use strict';

const CAPABILITIES = ['sentinel', 'sentinel.scan', 'sentinel.audit', 'sentinel.policy', 'sentinel.rules', 'governance'];
const TOOLS = ['sentinel.scan', 'sentinel.audit', 'sentinel.policy.check', 'sentinel.rules.list', 'sentinel.health'];

function catalog() {
  return {
    id: 'sentinel',
    version: require('./manifest.json').version,
    capabilities: CAPABILITIES,
    tools: TOOLS
  };
}

module.exports = { CAPABILITIES, TOOLS, catalog };
