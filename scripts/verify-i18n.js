// Quick headless verification of the landing page i18n script (no jsdom).
// Verifies: AR dict applied, dir/lang set, pricing card translated, switcher toggles.
const fs = require('fs');

const html = fs.readFileSync('hostinger/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function makeEl(tag, attrs = {}) {
  const node = {
    tagName: tag,
    attrs,
    textContent: '',
    children: [],
    parent: null,
    getAttribute(k) { return attrs[k] !== undefined ? attrs[k] : null; },
    setAttribute(k, v) { attrs[k] = String(v); },
    querySelector(sel) {
      const all = this.querySelectorAll(sel);
      return all[0] || null;
    },
    querySelectorAll(sel) {
      const out = [];
      const parts = sel.split(' ').filter(Boolean);
      const matchOne = (n, s) =>
        n.tagName === s ||
        (s.startsWith('.') && n.attrs.class && n.attrs.class.includes(s.slice(1))) ||
        (s.startsWith('#') && n.attrs.id === s.slice(1)) ||
        (n.attrs && n.attrs['data-i18n'] === s);
      const walk = (n, depth) => {
        for (const c of n.children) {
          if (matchOne(c, parts[depth])) {
            if (depth === parts.length - 1) out.push(c);
            else walk(c, depth + 1);
          }
          walk(c, depth);
        }
      };
      walk(this, 0);
      return out;
    },
    addEventListener() {}
  };
  return node;
}

const pricingGrid = makeEl('div');
const priceCard = makeEl('div', { class: 'price-card' });
const h3 = makeEl('h3'); h3.textContent = '🚀 Solo';
const tag = makeEl('p', { class: 'tagline' }); tag.textContent = 'For founders and solo teams';
const ul = makeEl('ul'); const li1 = makeEl('li'); li1.textContent = '1 workspace'; const li2 = makeEl('li'); li2.textContent = 'Core agent capabilities'; ul.children.push(li1, li2);
const row1 = makeEl('div', { class: 'price-row' }); const c1 = makeEl('span', { class: 'cycle' }); c1.textContent = 'Monthly'; row1.children.push(c1);
const buy = makeEl('a', { class: 'buy', href: 'https://dodo.pe/teos-dealmaker-solo-monthly-13644952' }); buy.textContent = 'Start 🚀 Solo Monthly';
priceCard.children.push(h3, tag, ul, row1, buy);
pricingGrid.children.push(priceCard);

const addonGrid = makeEl('div');
const addonCard = makeEl('div', { class: 'card' });
const ah3 = makeEl('h3'); ah3.textContent = 'Sentinel Governance';
const ap = makeEl('p'); ap.textContent = 'Policy enforcement...';
addonCard.children.push(ah3, ap); addonGrid.children.push(addonCard);

const translated = [];
const i18nEl = makeEl('span'); i18nEl.attrs['data-i18n'] = 'hero_t2'; i18nEl.textContent = 'AI-Governed.';
translated.push(i18nEl);

const switcher = makeEl('a', { id: 'lang-switch' });
const docEl = {};
let listener = null;
switcher.addEventListener = (ev, fn) => { listener = fn; };

global.document = {
  documentElement: docEl,
  querySelectorAll(sel) {
    if (sel === '[data-i18n]') return translated;
    if (sel === '.price-card') return pricingGrid.querySelectorAll('.price-card');
    if (sel === '.card') return addonGrid.querySelectorAll('.card');
    return [];
  },
  querySelector(sel) {
    if (sel === '[data-i18n-pricing]') return pricingGrid;
    if (sel === '[data-i18n-addons]') return addonGrid;
    return null;
  },
  getElementById(id) { return id === 'lang-switch' ? switcher : null; }
};
global.window = {
  location: { search: '' },
  addEventListener() {},
  localStorage: { _v: null, getItem() { return null; }, setItem(k, v) { this._v = v; } }
};
global.localStorage = global.window.localStorage;

eval(script);

console.log('1) default lang:', docEl.lang, 'dir:', docEl.dir, '(expect en/ltr)');
console.log('2) hero translated after AR toggle:');

// simulate click: listener toggles en->ar and re-applies
listener({ preventDefault() {} });
console.log('   lang after click:', docEl.lang, 'dir:', docEl.dir, '(expect ar/rtl)');
console.log('   i18n el text:', JSON.stringify(i18nEl.textContent), '(expect Arabic hero_t2)');
console.log('   switch label:', JSON.stringify(switcher.textContent), '(expect English "English")');
console.log('3) pricing card after AR:');
console.log('   tagline:', JSON.stringify(tag.textContent));
console.log('   li1:', JSON.stringify(li1.textContent));
console.log('   cycle:', JSON.stringify(c1.textContent));
console.log('   buy:', JSON.stringify(buy.textContent));
console.log('4) addon after AR:', JSON.stringify(ah3.textContent), '|', JSON.stringify(ap.textContent));
console.log('5) persisted lang:', global.window.localStorage._v);

const pass =
  docEl.lang === 'ar' && docEl.dir === 'rtl' &&
  /بإشراف/.test(translated[0].textContent || '') &&
  tag.textContent !== 'For founders and solo teams' &&
  /شهرياً/.test(c1.textContent) &&
  /شهرياً/.test(buy.textContent) &&
  global.window.localStorage._v === 'ar';
console.log('\nRESULT:', pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
