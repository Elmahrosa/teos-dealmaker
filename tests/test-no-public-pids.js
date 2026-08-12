const fs = require('fs');
const path = require('path');

const publicIndex = path.join(
  __dirname,
  '..',
  'public',
  'dashboard',
  'index.html'
);

const html = fs.readFileSync(publicIndex, 'utf8');

if (html.includes('pdt_')) {
  console.error(
    'FAIL: public/dashboard/index.html contains pdt_ product IDs'
  );
  process.exit(1);
}

console.log('PASS: no pdt_ product IDs in public dashboard');

