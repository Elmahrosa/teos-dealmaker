// scripts/build-static.js
// Renders the production static bundle (Hostinger) from the same render
// helpers used by the Express server (server/render.js), so the deployed
// site always matches `npm run server` output.
//
// Usage:
//   node scripts/build-static.js             # writes to hostinger/
//   node scripts/build-static.js --out dist  # custom output directory
//   node scripts/build-static.js --zip       # also writes hostinger.zip (deploy artifact)
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

require('dotenv').config();

const root = path.join(__dirname, '..');
const SERVER_DIR = path.join(root, 'server');
const render = require(path.join(SERVER_DIR, 'render.js'));

const argOut = process.argv.indexOf('--out');
const OUT_DIR = argOut !== -1
  ? path.resolve(process.argv[argOut + 1])
  : path.join(root, 'hostinger');

const ASSETS = ['favicon.svg', 'og-image.svg'];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Minimal ZIP writer (forward-slash entries) so the Hostinger upload artifact
// can be produced without external tools on any platform.
function writeZip(zipPath, entries) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const comp = zlib.deflateRawSync(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);            // version needed
    localHeader.writeUInt16LE(0x0800, 6);        // flags: UTF-8 names
    localHeader.writeUInt16LE(8, 8);             // method: deflate
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(comp.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(comp.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt32LE(offset, 42);

    local.push(localHeader, nameBuf, comp);
    central.push(centralHeader, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);

  fs.writeFileSync(zipPath, Buffer.concat([...local, centralBuf, eocd]));
}

function buildBundle() {
  fs.mkdirSync(path.join(OUT_DIR, 'dashboard'), { recursive: true });

  const landing = fs.readFileSync(path.join(SERVER_DIR, 'landing.html'), 'utf8');
  const dashboard = fs.readFileSync(path.join(SERVER_DIR, 'sentinel.html'), 'utf8');

  const files = {
    'index.html': render.renderLanding(landing),
    'dashboard/index.html': render.renderDashboard(dashboard),
    'robots.txt': render.robotsTxt(),
    'sitemap.xml': render.sitemapXml()
  };

  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT_DIR, name), content, 'utf8');
  }

  for (const asset of ASSETS) {
    const src = path.join(SERVER_DIR, asset);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(OUT_DIR, asset));
    }
  }

  console.log(`\u2713 static build written to ${OUT_DIR}`);
  for (const name of [...Object.keys(files), ...ASSETS]) {
    console.log(`  - ${name}`);
  }

  if (process.argv.includes('--zip')) {
    const entries = [
      ...Object.entries(files).map(([name, content]) => ({ name, data: Buffer.from(content, 'utf8') })),
      ...ASSETS.map(name => ({ name, data: fs.readFileSync(path.join(OUT_DIR, name)) }))
    ];
    const zipPath = path.join(root, 'hostinger.zip');
    writeZip(zipPath, entries);
    console.log(`\u2713 upload artifact written to ${zipPath}`);
  }
}

buildBundle();
