// services/plugin-manager/compatibility.js
// Version compatibility for the plugin platform. The manifest records the
// contract apiVersion and the engine range it was built against; the loader
// refuses to register a plugin whose declared contract or engine range the
// running platform cannot satisfy. This is the version gate that keeps an
// incompatible plugin from ever being loaded.
'use strict';

const API_VERSION = 1;

function parse(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(String(version).trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compare(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

function satisfies(version, range) {
  const v = parse(version);
  if (!v) return false;
  const r = String(range || '*').trim();
  if (r === '*' || r === '' || r === 'latest') return true;
  if (r.startsWith('^')) {
    const bound = parse(r.slice(1));
    if (!bound) return false;
    if (bound.major === 0) {
      return v.major === 0 && v.minor === bound.minor && v.patch >= bound.patch;
    }
    return v.major === bound.major && (v.minor > bound.minor || (v.minor === bound.minor && v.patch >= bound.patch));
  }
  if (r.startsWith('~')) {
    const bound = parse(r.slice(1));
    if (!bound) return false;
    return v.major === bound.major && v.minor === bound.minor && v.patch >= bound.patch;
  }
  if (r.startsWith('>=')) {
    const bound = parse(r.slice(2));
    if (!bound) return false;
    return compare(v, bound) >= 0;
  }
  const exact = parse(r);
  return exact ? compare(v, exact) === 0 : false;
}

function checkEngine(engineRange, engineVersion) {
  return satisfies(engineVersion, engineRange);
}

function checkApiVersion(apiVersion) {
  return Number(apiVersion) === API_VERSION;
}

module.exports = { API_VERSION, parse, compare, satisfies, checkEngine, checkApiVersion };
