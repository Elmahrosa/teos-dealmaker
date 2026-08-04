// services/plugin-manager/loader.js
// Filesystem half of the plugin platform. Scans a plugin directory, validates
// every manifest against the contract (schema rules + apiVersion/engine
// compatibility), loads and validates the entry-point modules, registers the
// plugin with its tool declarations, then resolves inter-plugin dependencies.
//
// A plugin that violates the contract or throws at load is recorded as failed
// and never enters the registry — it cannot take down core or its siblings.
'use strict';

const fs = require('fs');
const path = require('path');

const compat = require('./compatibility');
const perms = require('./permissions');
const lifecycle = require('./lifecycle');

const MANIFEST = 'manifest.json';
const CONTRACT_LINK = 'docs/PLUGIN_CONTRACT.md';

function createLoader(deps) {
  const registry = deps.registry;
  const bus = deps.bus;
  const engineVersion = deps.engineVersion;
  const defaultDir = deps.defaultDir;

  function entryFile(dir, name) {
    return path.join(dir, name);
  }

  function hasFile(dir, name) {
    return fs.existsSync(entryFile(dir, name));
  }

  // --------------------------------------------------------- validation

  function validateManifest(manifest, dir) {
    const errors = [];
    const add = (msg) => errors.push(msg);

    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      return { valid: false, errors: ['manifest must be a JSON object'] };
    }
    if (typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(manifest.id)) {
      add('manifest.id must match ^[a-z0-9][a-z0-9._-]*$');
    }
    if (typeof manifest.name !== 'string' || !manifest.name.trim()) add('manifest.name is required');
    if (typeof manifest.description !== 'string' || !manifest.description.trim()) {
      add('manifest.description is required');
    }
    if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
      add('manifest.version must be semver (x.y.z)');
    }
    if (!compat.checkApiVersion(manifest.apiVersion)) {
      add(`manifest.apiVersion must be ${compat.API_VERSION}`);
    }
    if (typeof manifest.engine !== 'string' || !manifest.engine.trim()) {
      add('manifest.engine is required (semver range, e.g. "^0.10.0")');
    } else if (!compat.checkEngine(manifest.engine, engineVersion)) {
      add(`manifest.engine "${manifest.engine}" not satisfied by engine v${engineVersion}`);
    }
    if (manifest.fallback !== undefined && typeof manifest.fallback !== 'boolean') {
      add('manifest.fallback must be a boolean');
    }
    if (manifest.enabledByDefault !== undefined && typeof manifest.enabledByDefault !== 'boolean') {
      add('manifest.enabledByDefault must be a boolean');
    }
    if (manifest.permissions !== undefined
      && (typeof manifest.permissions !== 'object' || manifest.permissions === null || Array.isArray(manifest.permissions))) {
      add('manifest.permissions must be an object of boolean grants');
    }
    if (manifest.capabilities !== undefined && !Array.isArray(manifest.capabilities)) {
      add('manifest.capabilities must be an array');
    }
    for (const key of ['requires', 'optional']) {
      if (manifest[key] !== undefined && !Array.isArray(manifest[key])) {
        add(`manifest.${key} must be an array`);
      }
    }
    if (manifest.tools !== undefined && !Array.isArray(manifest.tools)) {
      add('manifest.tools must be an array');
    }
    if (Array.isArray(manifest.tools)) {
      const seen = new Set();
      manifest.tools.forEach((tool, i) => {
        if (!tool || typeof tool.toolId !== 'string' || !tool.toolId.trim()) {
          add(`tools[${i}].toolId is required`);
          return;
        }
        if (seen.has(tool.toolId)) add(`tools[${i}].toolId duplicates ${tool.toolId}`);
        seen.add(tool.toolId);
        if (tool.permissions !== undefined && !Array.isArray(tool.permissions)) {
          add(`tools[${i}].permissions must be an array`);
        }
      });
    }
    if (dir) {
      const entries = manifest.entries && typeof manifest.entries === 'object' ? manifest.entries : {};
      for (const key of ['adapter', 'policy', 'schema', 'audit', 'index']) {
        const rel = entries[key];
        if (rel && typeof rel === 'string' && !hasFile(dir, rel)) {
          add(`entry ${key} not found: ${rel}`);
        }
      }
    }
    return errors.length ? { valid: false, errors } : { valid: true, errors: [] };
  }

  // ------------------------------------------------------- entry loading

  function loadEntries(record, errors) {
    const manifest = record.manifest;
    const entries = manifest.entries && typeof manifest.entries === 'object' ? manifest.entries : {};
    const out = {};

    const relFor = (key) => {
      if (entries[key]) return entries[key];
      return hasFile(record.dir, `${key}.js`) ? `${key}.js` : null;
    };

    const adapterRel = relFor('adapter');
    if (adapterRel) {
      try {
        const mod = require(entryFile(record.dir, adapterRel));
        let candidate = mod;
        if (typeof mod === 'function') candidate = mod();
        if (candidate && typeof candidate === 'object') {
          if (typeof candidate.call !== 'function') {
            errors.push(`adapter.call() is required (see ${CONTRACT_LINK})`);
          } else {
            out.adapter = candidate;
          }
        } else {
          errors.push('adapter entry must export an adapter object or a createAdapter() factory');
        }
      } catch (err) {
        errors.push(`adapter entry failed to load: ${err.message}`);
      }
    }

    const policyRel = relFor('policy');
    if (policyRel) {
      try {
        const mod = require(entryFile(record.dir, policyRel));
        const rules = typeof mod === 'function' ? [mod] : mod && Array.isArray(mod.rules) ? mod.rules : null;
        if (!rules || rules.some((r) => typeof r !== 'function')) {
          errors.push('policy entry must export a rule function or { rules: [...] }');
        } else {
          out.rules = rules;
        }
      } catch (err) {
        errors.push(`policy entry failed to load: ${err.message}`);
      }
    }

    const schemaRel = relFor('schema');
    if (schemaRel) {
      try {
        const mod = require(entryFile(record.dir, schemaRel));
        if (!mod || typeof mod !== 'object' || Array.isArray(mod)) {
          errors.push('schema entry must export an object keyed by toolId');
        } else {
          for (const key of Object.keys(mod)) {
            if (!record.manifestTools.includes(key)) errors.push(`schema declares unknown tool "${key}"`);
          }
          out.schema = mod;
        }
      } catch (err) {
        errors.push(`schema entry failed to load: ${err.message}`);
      }
    }

    const auditRel = relFor('audit');
    if (auditRel) {
      try {
        const mod = require(entryFile(record.dir, auditRel));
        if (typeof mod !== 'function' && !(mod && typeof mod.write === 'function')) {
          errors.push('audit entry must export a function or { write() }');
        } else {
          out.audit = mod;
        }
      } catch (err) {
        errors.push(`audit entry failed to load: ${err.message}`);
      }
    }

    const indexRel = relFor('index');
    if (indexRel) {
      try {
        const mod = require(entryFile(record.dir, indexRel));
        if (typeof mod !== 'function') {
          errors.push('index entry (install hook) must export a function(ctx)');
        } else {
          out.install = mod;
        }
      } catch (err) {
        errors.push(`index entry failed to load: ${err.message}`);
      }
    }

    return out;
  }

  // ---------------------------------------------------------- register

  function register(pluginDir) {
    const dir = path.resolve(pluginDir);
    const manifestPath = entryFile(dir, MANIFEST);
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`no ${MANIFEST} found in ${dir}`);
    }
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      throw new Error(`invalid ${MANIFEST} in ${dir}: ${err.message}`);
    }
    const check = validateManifest(manifest, dir);
    if (!check.valid) {
      throw new Error(`plugin contract violation (${CONTRACT_LINK}): ${check.errors.join('; ')}`);
    }
    if (registry.has(manifest.id)) return registry.get(manifest.id);

    const record = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      apiVersion: manifest.apiVersion,
      engine: manifest.engine,
      description: manifest.description,
      server: manifest.server || null,
      fallback: manifest.fallback === true,
      enabledByDefault: manifest.enabledByDefault !== false,
      requires: Array.isArray(manifest.requires) ? manifest.requires.slice() : [],
      optional: Array.isArray(manifest.optional) ? manifest.optional.slice() : [],
      capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities.slice() : [],
      permissions: perms.createPermissions(manifest.permissions),
      dir,
      manifest,
      manifestTools: Array.isArray(manifest.tools) ? manifest.tools.map((t) => t.toolId) : [],
      tools: Array.isArray(manifest.tools) ? manifest.tools.map((t) => Object.assign({}, t)) : [],
      adapter: null,
      schema: null,
      audit: null,
      policyRules: [],
      installApi: null,
      state: lifecycle.STATES.LOADED,
      lastError: null,
      registeredAt: Date.now()
    };

    const errors = [];
    const entries = loadEntries(record, errors);
    if (errors.length) {
      throw new Error(`plugin entry contract violation (${CONTRACT_LINK}): ${errors.join('; ')}`);
    }

    if (entries.adapter) {
      record.adapter = entries.adapter;
      record.onInitialize = typeof entries.adapter.initialize === 'function' ? entries.adapter.initialize.bind(entries.adapter) : null;
      record.onHealth = typeof entries.adapter.health === 'function' ? entries.adapter.health.bind(entries.adapter) : null;
      record.onShutdown = typeof entries.adapter.shutdown === 'function' ? entries.adapter.shutdown.bind(entries.adapter) : null;
    }
    if (entries.schema) record.schema = entries.schema;
    if (entries.audit) record.audit = entries.audit;
    record.policyRules = (entries.rules || []).slice();

    if (entries.install) {
      const ctx = {
        pluginId: record.id,
        config: () => ({ pluginId: record.id, version: record.version }),
        subscribe: (name, handler) => bus.subscribe(name, handler),
        emit: (name, payload) => bus.emit(name, payload),
        log: (message) => {
          try {
            require('../../utils/auditLogger').writeEntry('PLUGIN_LOG', record.id, 'info', { message });
          } catch (_) {
            /* logging must never block plugin load */
          }
        }
      };
      try {
        record.installApi = entries.install(ctx);
      } catch (err) {
        throw new Error(`plugin install hook failed: ${err.message}`);
      }
    }

    registry.set(record);
    return record;
  }

  // ------------------------------------------------------------ loading

  function loadPlugins(dir) {
    const base = path.resolve(dir || defaultDir);
    if (!fs.existsSync(base)) return { base, loaded: [], failed: [] };
    const loaded = [];
    const failed = [];
    let entries;
    try {
      entries = fs.readdirSync(base);
    } catch (err) {
      return { base, loaded, failed: [{ id: '(scan)', error: err.message }] };
    }
    for (const name of entries) {
      const pluginDir = path.join(base, name);
      let stat;
      try {
        stat = fs.statSync(pluginDir);
      } catch (_) {
        continue;
      }
      if (!stat.isDirectory() || !hasFile(pluginDir, MANIFEST)) continue;
      try {
        const record = register(pluginDir);
        lifecycle.initialize(record);
        loaded.push(record.id);
      } catch (err) {
        failed.push({ id: name, error: err.message });
      }
    }
    return { base, loaded, failed };
  }

  // ------------------------------------------------------ dependencies

  function resolveDependencies() {
    const report = { ok: [], blocked: [], warnings: [] };
    for (const record of registry.list()) {
      if (record.state === lifecycle.STATES.DISABLED) continue;
      const missing = record.requires.filter((id) => !registry.has(id));
      if (missing.length) {
        lifecycle.disable(record);
        record.lastError = `missing_dependency: ${missing.join(', ')}`;
        report.blocked.push({ id: record.id, missing });
      } else {
        report.ok.push(record.id);
      }
      for (const id of record.optional) {
        if (!registry.has(id)) report.warnings.push({ id: record.id, optionalMissing: id });
      }
    }
    return report;
  }

  return { register, loadPlugins, validateManifest, resolveDependencies };
}

module.exports = { createLoader };
