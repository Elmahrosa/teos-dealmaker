const PRICING = [
  {
    tier: '🚀 Solo Operator',
    monthly: { price: '$99.00', url: 'https://dodo.pe/vap1' },
    annual: { price: '$950.00', url: 'https://dodo.pe/tv-s-y-1613' },
    productIds: {
      monthly: 'pdt_0Njj3JiKzgajfE9xNK06s',
      annual: 'pdt_0Njj3Jk7JkiYb8JYwIHSL'
    }
  },
  {
    tier: '⚡ Growth Team',
    monthly: { price: '$249.00', url: 'https://dodo.pe/vap2' },
    annual: { price: '$2,390.00', url: 'https://dodo.pe/vap4' },
    productIds: {
      monthly: 'pdt_0Njj3KBL1xS9i4JwCtisU',
      annual: 'pdt_0Njj3KBrXLbWzQqIunBYU'
    }
  },
  {
    tier: '👑 Corporate',
    monthly: { price: '$799.00', url: 'https://dodo.pe/vap5' },
    annual: { price: '$7,600.00', url: 'https://dodo.pe/vap6' },
    productIds: {
      monthly: 'pdt_0Njj3KVc9HwWimc2jFygi',
      annual: 'pdt_0Njj3KWeLPuaTxLGOE9N7'
    }
  }
];

function formatPricingText() {
  return [
    '💳 <b>Pricing</b>',
    '',
    ...PRICING.flatMap(t => [
      t.tier,
      `  Monthly ${t.monthly.price} — ${t.monthly.url}`,
      `  Annual ${t.annual.price} — ${t.annual.url}`,
      ''
    ])
  ].join('\n');
}

function pricingButtons() {
  return {
    inline_keyboard: PRICING.flatMap(t => [
      [
        { text: `${t.tier} Monthly ${t.monthly.price}`, url: t.monthly.url },
        { text: `${t.tier} Annual ${t.annual.price}`, url: t.annual.url }
      ]
    ])
  };
}

module.exports = PRICING;
module.exports.formatPricingText = formatPricingText;
module.exports.pricingButtons = pricingButtons;
