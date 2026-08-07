'use strict';

const { createRepos } = require('../../db/repos');
const embedder = require('./embedder');
const searchSvc = require('./search');
const rankingSvc = require('./ranking');
const loaderSvc = require('./loader');
const memorySvc = require('./memory');

function createKnowledgeBase(adapter, { embedFn } = {}) {
  const emb = embedFn || embedder.embed;

  async function index(workspaceId, { force = false } = {}) {
    let docs = memorySvc.get(workspaceId);
    if (!docs || force) {
      docs = await loaderSvc.load(adapter, workspaceId, { embedFn: emb });
      memorySvc.set(workspaceId, docs);
    }
    return docs;
  }

  async function search(workspaceId, query, opts = {}) {
    const docs = await index(workspaceId);
    const hits = await searchSvc.search(docs, query, { embed: emb, ...opts });
    return rankingSvc.rerank(hits, opts);
  }

  async function add(workspaceId, doc) {
    const repos = createRepos(adapter);
    await repos.intelligence.add({
      workspace_id: workspaceId,
      title: doc.title,
      source_type: doc.source_type || 'documents',
      content: doc.content,
      metadata: doc.metadata || null
    });
    memorySvc.invalidate(workspaceId);
    return index(workspaceId, { force: true });
  }

  function invalidate(workspaceId) {
    memorySvc.invalidate(workspaceId);
  }

  return { index, search, add, invalidate, memory: memorySvc };
}

module.exports = { createKnowledgeBase, embedder, search: searchSvc, ranking: rankingSvc, loader: loaderSvc, memory: memorySvc };
