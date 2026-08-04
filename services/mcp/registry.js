const TOOLS = {
  'github.createIssue': {
    toolId: 'github.createIssue',
    server: 'github',
    category: 'source',
    description: 'Create an issue on a GitHub repository.',
    version: '1.0.0',
    capabilities: ['github', 'issues', 'write'],
    operations: ['create']
  },
  'github.createIssueComment': {
    toolId: 'github.createIssueComment',
    server: 'github',
    category: 'source',
    description: 'Add a comment to an existing GitHub issue or pull request.',
    version: '1.0.0',
    capabilities: ['github', 'issues', 'write'],
    operations: ['create', 'comment']
  },
  'github.listRepositories': {
    toolId: 'github.listRepositories',
    server: 'github',
    category: 'source',
    description: 'List repositories visible to the configured GitHub token.',
    version: '1.0.0',
    capabilities: ['github', 'repositories', 'read'],
    operations: ['list']
  },
  'filesystem.readFile': {
    toolId: 'filesystem.readFile',
    server: 'filesystem',
    category: 'local',
    description: 'Read a file from a permitted path on the gateway host.',
    version: '1.0.0',
    capabilities: ['filesystem', 'read'],
    operations: ['read']
  },
  'filesystem.writeFile': {
    toolId: 'filesystem.writeFile',
    server: 'filesystem',
    category: 'local',
    description: 'Write a file to a permitted path on the gateway host.',
    version: '1.0.0',
    capabilities: ['filesystem', 'write'],
    operations: ['write']
  },
  'postgres.query': {
    toolId: 'postgres.query',
    server: 'postgres',
    category: 'data',
    description: 'Execute a read-only or parameterized query against a gateway-managed PostgreSQL database.',
    version: '1.0.0',
    capabilities: ['postgres', 'sql', 'query'],
    operations: ['query', 'select']
  },
  'redis.set': {
    toolId: 'redis.set',
    server: 'redis',
    category: 'data',
    description: 'Set a key in a gateway-managed Redis instance.',
    version: '1.0.0',
    capabilities: ['redis', 'cache', 'write'],
    operations: ['set']
  },
  'redis.get': {
    toolId: 'redis.get',
    server: 'redis',
    category: 'data',
    description: 'Read a key from a gateway-managed Redis instance.',
    version: '1.0.0',
    capabilities: ['redis', 'cache', 'read'],
    operations: ['get']
  },
  'docker.runContainer': {
    toolId: 'docker.runContainer',
    server: 'docker',
    category: 'infrastructure',
    description: 'Start a container on the gateway Docker host.',
    version: '1.0.0',
    capabilities: ['docker', 'containers', 'write'],
    operations: ['run']
  },
  'docker.listContainers': {
    toolId: 'docker.listContainers',
    server: 'docker',
    category: 'infrastructure',
    description: 'List containers on the gateway Docker host.',
    version: '1.0.0',
    capabilities: ['docker', 'containers', 'read'],
    operations: ['list']
  },
  'playwright.navigate': {
    toolId: 'playwright.navigate',
    server: 'playwright',
    category: 'browser',
    description: 'Open a page in a gateway-controlled browser session.',
    version: '1.0.0',
    capabilities: ['playwright', 'browser', 'web'],
    operations: ['navigate']
  },
  'playwright.screenshot': {
    toolId: 'playwright.screenshot',
    server: 'playwright',
    category: 'browser',
    description: 'Capture a screenshot of the current browser page.',
    version: '1.0.0',
    capabilities: ['playwright', 'browser', 'web'],
    operations: ['screenshot']
  },
  'browser.open': {
    toolId: 'browser.open',
    server: 'playwright',
    category: 'browser',
    description: 'Open a URL in a gateway-controlled browser.',
    version: '1.0.0',
    capabilities: ['browser', 'web'],
    operations: ['open']
  },
  'supabase.select': {
    toolId: 'supabase.select',
    server: 'supabase',
    category: 'data',
    description: 'Select rows from a Supabase table via the gateway.',
    version: '1.0.0',
    capabilities: ['supabase', 'database', 'read'],
    operations: ['select']
  },
  'supabase.insert': {
    toolId: 'supabase.insert',
    server: 'supabase',
    category: 'data',
    description: 'Insert rows into a Supabase table via the gateway.',
    version: '1.0.0',
    capabilities: ['supabase', 'database', 'write'],
    operations: ['insert']
  },
  'stripe.createCharge': {
    toolId: 'stripe.createCharge',
    server: 'stripe',
    category: 'payments',
    description: 'Create a payment charge through the gateway Stripe account.',
    version: '1.0.0',
    capabilities: ['stripe', 'payments', 'write'],
    operations: ['create', 'charge']
  },
  'stripe.listCustomers': {
    toolId: 'stripe.listCustomers',
    server: 'stripe',
    category: 'payments',
    description: 'List customers in the gateway Stripe account.',
    version: '1.0.0',
    capabilities: ['stripe', 'payments', 'read'],
    operations: ['list']
  },
  'slack.postMessage': {
    toolId: 'slack.postMessage',
    server: 'slack',
    category: 'communication',
    description: 'Post a message to a Slack channel through the gateway.',
    version: '1.0.0',
    capabilities: ['slack', 'communication', 'write'],
    operations: ['post']
  },
  'notion.appendBlock': {
    toolId: 'notion.appendBlock',
    server: 'notion',
    category: 'knowledge',
    description: 'Append a block to a Notion page through the gateway.',
    version: '1.0.0',
    capabilities: ['notion', 'knowledge', 'write'],
    operations: ['append']
  },
  'crm.searchContacts': {
    toolId: 'crm.searchContacts',
    server: 'crm',
    category: 'crm',
    description: 'Search contacts in the gateway-managed CRM.',
    version: '1.0.0',
    capabilities: ['crm', 'contacts', 'read'],
    operations: ['search']
  }
};

const catalog = new Map(Object.entries(TOOLS));

function register(def) {
  if (!def || !def.toolId) throw new Error('MCP tool registration requires a toolId');
  if (catalog.has(def.toolId)) throw new Error(`MCP tool already registered: ${def.toolId}`);
  const tool = {
    toolId: def.toolId,
    server: def.server || 'custom',
    category: def.category || 'custom',
    description: def.description || '',
    version: def.version || '1.0.0',
    capabilities: Array.isArray(def.capabilities) ? def.capabilities : [],
    operations: Array.isArray(def.operations) ? def.operations : []
  };
  catalog.set(tool.toolId, tool);
  return tool;
}

function get(toolId) {
  return catalog.get(toolId) || null;
}

function isKnown(toolId) {
  return catalog.has(toolId);
}

function list(filter) {
  const entries = Array.from(catalog.values());
  if (!filter) return entries;
  return entries.filter(tool => {
    if (filter.server && tool.server !== filter.server) return false;
    if (filter.category && tool.category !== filter.category) return false;
    if (filter.capability && !tool.capabilities.includes(filter.capability)) return false;
    return true;
  });
}

function versionOf(toolId) {
  const tool = catalog.get(toolId);
  return tool ? tool.version : null;
}

function unregister(toolId) {
  if (!catalog.has(toolId)) return { removed: false, reason: 'unknown_tool' };
  if (Object.prototype.hasOwnProperty.call(TOOLS, toolId)) return { removed: false, reason: 'builtin_tool' };
  catalog.delete(toolId);
  return { removed: true };
}

function servers() {
  const unique = new Set(Array.from(catalog.values()).map(t => t.server));
  return Array.from(unique).sort();
}

function capabilities() {
  const unique = new Set();
  for (const tool of catalog.values()) {
    for (const cap of tool.capabilities) unique.add(cap);
  }
  return Array.from(unique).sort();
}

module.exports = { register, unregister, get, isKnown, list, versionOf, servers, capabilities };
