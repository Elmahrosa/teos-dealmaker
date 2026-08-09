const design = require('../design');
const i18n = require('../i18n');
const { PRODUCT } = require('../../config/product.config');

function buildPlayground(userId) {
  const t = key => i18n.t(userId, key);
  const demoUrl = PRODUCT.siteUrl + (PRODUCT.demo && PRODUCT.demo.anchor || '#playground');
  const text = design.compose([
    design.b(t('pg_title')),
    design.it(t('pg_sub')),
    design.divider(),
    t('pg_brief'),
    t('pg_stakeholders'),
    t('pg_simulation'),
    t('pg_controller'),
    t('pg_gov'),
    t('pg_report'),
    design.divider(),
    design.it(PRODUCT.demo.label)
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.urlButton(t('pg_cta_open'), demoUrl)],
      [design.urlButton(t('pg_cta_website'), PRODUCT.siteUrl)],
      [design.textButton(t('btn_back_home'), 'cc_home')]
    ])
  };
}

module.exports = { buildPlayground };
