'use strict';

const fs = require('fs');
const path = require('path');

const publicIndex = path.join(__dirname, '..', 'public', 'dashboard', 'index.html');
const html = fs.readFileSync(publicIndex, 'utf8');

if (html.includes('pdt_')) {
  console.error('FAIL: public/dashboard/index.html contains public Dodo product IDs (pdt_)');
  process.exit(1);
}

console.log('PASS: public/dashboard/index.html contains no public pdt_ product IDs');
