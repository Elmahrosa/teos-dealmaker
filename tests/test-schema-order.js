// tests/test-schema-order.js
// Linter: db/schema.sql must declare every referenced table BEFORE the
// statement that references it (CREATE TABLE / ALTER TABLE). Postgres resolves
// FK targets eagerly, so ordering bugs like `workspaces -> users` (users defined
// later) or an `ALTER agent_runs ... REFERENCES plans` before plans exists would
// break a fresh `db:migrate`. This test guards the forward-only ordering contract.
'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA = path.join(__dirname, '..', 'db', 'schema.sql');
const sql = fs.readFileSync(SCHEMA, 'utf8');
const lines = sql.split(/\r?\n/);

let passed = 0;
const failures = [];

const created = new Map();
const reCreate = /CREATE TABLE IF NOT EXISTS (\w+)/;
const reAlter = /ALTER TABLE (\w+)/;
const reRef = /REFERENCES (\w+)\s*\(/;
const reIndex = /CREATE INDEX IF NOT EXISTS \w+ ON (\w+)/;
const reTriggerOn = /TRIGGER \w+ ON (\w+)/;

function fail(lineNo, msg) {
  failures.push(`schema.sql:${lineNo}: ${msg}`);
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const lineNo = i + 1;

  const create = line.match(reCreate);
  if (create) {
    const name = create[1];
    created.set(name, lineNo);
    passed += 1;
    continue;
  }

  const alter = line.match(reAlter);
  if (alter) {
    const name = alter[1];
    if (!created.has(name)) {
      fail(lineNo, `ALTER TABLE targets '${name}' before it is created`);
    } else {
      passed += 1;
    }
  }

  const ref = line.match(reRef);
  if (ref) {
    const target = ref[1];
    if (!created.has(target)) {
      fail(lineNo, `REFERENCES '${target}' before it is created`);
    } else {
      passed += 1;
    }
  }

  const idx = line.match(reIndex);
  if (idx) {
    const table = idx[1];
    if (!created.has(table)) {
      fail(lineNo, `INDEX on '${table}' before it is created`);
    } else {
      passed += 1;
    }
  }

  const trig = line.match(reTriggerOn);
  if (trig) {
    const table = trig[1];
    if (!created.has(table)) {
      fail(lineNo, `TRIGGER on '${table}' before it is created`);
    } else {
      passed += 1;
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  console.error(
    `\u2717 schema FK ordering invalid (${failures.length} violation${failures.length === 1 ? '' : 's'})`,
  );
  process.exit(1);
}

console.log(`\u2713 schema FK ordering valid (${passed} ordering checks passed)`);
