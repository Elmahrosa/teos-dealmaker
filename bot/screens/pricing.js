const design = require('../design');
const i18n = require('../i18n');
const { formatPricingText, pricingButtons } = require('../../config/pricing.config');

function buildPricing(userId) {
  const lang = i18n.getLang(userId);
  return {
    text: formatPricingText(lang),
    keyboard: design.keyboard([
      ...pricingButtons(lang).inline_keyboard,
      [design.textButton(i18n.t(userId, 'btn_back_home'), 'cc_home')]
    ])
  };
}

module.exports = { buildPricing };
