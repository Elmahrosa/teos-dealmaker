'use strict';

const { createRepos } = require('../../db/repos');
const learning = require('../learning');
const { embed } = require('./embedder');

async function load(adapter, workspaceId, { embedFn = embed } = {}) {
  const repos = createRepos(adapter);
  const rows = (await repos.intelligence.list(workspaceId)) || [];
  const docs = rows.map(row => ({
    id: row.id,
    title: row.title,
    content: row.content,
    source_type: row.source_type,
    metadata: row.metadata,
    created_at: row.created_at,
    updated_at: row.updated_at
  }));

  try {
    const knowledge = await learning.getKnowledge(adapter, workspaceId);
    const company = knowledge && (knowledge.company || knowledge);
    if (company) {
      docs.unshift({
        id: 'company_profile',
        title: company.company_name || 'Company profile',
        content: JSON.stringify(company),
        source_type: 'company',
        metadata: { kind: 'company_profile' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
  } catch (_) {
    // company knowledge is optional
  }

  return docs.map(doc => ({
    ...doc,
    embedding: embedFn((doc.content || '') + ' ' + (doc.title || ''))
  }));
}

module.exports = { load };
