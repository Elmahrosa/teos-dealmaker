// scripts/check-syntax.js
// Build gate: runs `node --check` on every .js file in the repo (excluding
// node_modules, data, .git, .opencode). Run via `npm run build`.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const EXCLUDED = new Set(['node_modules', '.git', '.opencode', 'data']);

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED.has(entry.name)) continue;
      walk(path.join(dir, entry.name), files);
    } else if (entry.name.endsWith('.js')) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

const files = walk(root, []).sort();
const failed = [];

for (const file of files) {
  const res = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    failed.push({ file, stderr: (res.stderr || '').trim() });
  }
}

if (failed.length) {
  for (const { file, stderr } of failed) {
    console.error(`\u2717 syntax error in ${path.relative(root, file)}`);
    if (stderr) console.error(`    ${stderr.split('\n').join('\n    ')}`);
  }
  console.error(`\n\u2717 build failed: ${failed.length}/${files.length} files have syntax errors`);
  process.exit(1);
}

console.log(`\u2713 build ok: ${files.length} JS files pass node --check`);
