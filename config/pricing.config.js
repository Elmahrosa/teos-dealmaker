'use strict';

// DealMaker pricing is intentionally unpublished.
// No commercial tiers, prices, checkout links, or payment provider are active.
// Preserve this module's interface for the bot and Railway server.

const PRICING = [];
const ADDONS = [];
const SENTINEL_URL = 'https://sentinel.teosegypt.com';

function pricingWords(lang) {
  return lang === 'ar'
    ? { unavailable: 'الأسعار غير منشورة حالياً. التفعيل يتطلب موافقة المؤسس.' }
    : { unavailable: 'Pricing is not published. Activation requires founder approval.' };
}

function formatPricingText(lang) {
  return pricingWords(lang).unavailable;
}

function pricingButtons() {
  return { inline_keyboard: [] };
}

module.exports = PRICING;
module.exports.formatPricingText = formatPricingText;
module.exports.pricingButtons = pricingButtons;
module.exports.ADDONS = ADDONS;
module.exports.SENTINEL_URL = SENTINEL_URL;
