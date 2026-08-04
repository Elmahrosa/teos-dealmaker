// services/plugin-manager/permissions.js
// Capability-based permission model. A plugin declares its permission grants
// in the manifest (merged over a fixed default set). Tools may declare the
// permissions they require to execute. The set is extensible by design — new
// permission keys (allowShell, allowDocker, ...) need no loader changes.
'use strict';

const DEFAULT_PERMISSIONS = {
  network: false,
  filesystem: false,
  database: false,
  workspace: true,
  secrets: false,
  outboundHttp: false,
  databaseWrite: false,
  shell: false,
  git: false,
  docker: false,
  memoryRead: false,
  memoryWrite: false
};

function createPermissions(declared) {
  const permissions = Object.assign({}, DEFAULT_PERMISSIONS);
  if (declared && typeof declared === 'object' && !Array.isArray(declared)) {
    for (const key of Object.keys(declared)) {
      permissions[key] = declared[key] === true;
    }
  }
  return permissions;
}

function grant(permissions, key) {
  permissions[key] = true;
  return permissions;
}

function revoke(permissions, key) {
  permissions[key] = false;
  return permissions;
}

function has(permissions, key) {
  return permissions[key] === true;
}

function granted(permissions) {
  return Object.keys(permissions).filter((key) => permissions[key] === true).sort();
}

module.exports = { DEFAULT_PERMISSIONS, createPermissions, grant, revoke, has, granted };
