const design = require('../design');
const { formatPricingText, pricingButtons } = require('../../config/pricing.config');

function buildPricing() {
  return {
    text: formatPricingText(),
    keyboard: design.keyboard([
      ...pricingButtons().inline_keyboard,
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

module.exports = { buildPricing };
