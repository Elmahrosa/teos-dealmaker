const DODO_API_KEY = process.env.DODO_API_KEY;

function buildPayload(dealId, amount, opts) {
  return {
    amount,
    currency: opts.currency || 'USD',
    description: `TEOS DealMaker - ${dealId}`,
    customer: { email: opts.email || 'buyer@example.com' },
    metadata: { dealId }
  };
}

async function createCheckoutLink(dealId, amount, opts = {}) {
  if (!DODO_API_KEY) {
    return {
      checkoutId: `CHK-${dealId}`,
      amount,
      currency: opts.currency || 'USD',
      dryRun: true,
      url: `https://dodo.example/checkout/${dealId}`,
      payload: buildPayload(dealId, amount, opts)
    };
  }

  const res = await fetch('https://api.dodopayments.com/payments/buy', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DODO_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildPayload(dealId, amount, opts))
  });

  if (!res.ok) {
    throw new Error(`Dodo Payments error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return {
    checkoutId: data.payment_id,
    amount,
    currency: opts.currency || 'USD',
    dryRun: false,
    url: data.checkout_url
  };
}

module.exports = { createCheckoutLink };
