// plugins/civic-mixer/capabilities.js
// Optional capability catalog helper for the civic-mixer plugin.
'use strict';

const CAPABILITIES = ['civic', 'civic.identity', 'civic.vote', 'civic.issue', 'governance', 'authorization', 'gateway'];
const TOOLS = ['civic.lookup', 'civic.identity.verify', 'civic.vote.create', 'civic.issue.create', 'civic.issue.list'];

function catalog() {
  return {
    id: 'civic-mixer',
    version: require('./manifest.json').version,
    capabilities: CAPABILITIES,
    tools: TOOLS
  };
}

module.exports = { CAPABILITIES, TOOLS, catalog };
