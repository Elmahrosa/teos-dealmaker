const sessions = new Map();

const STEPS = [
  { key: 'assetType', prompt: 'What are you selling?\n1. Product\n2. Land / Real Estate\n3. Boat\n4. Service\n5. Other Asset', required: true },
  { key: 'description', prompt: 'Describe the asset, its condition, location or key specifications:', required: true },
  { key: 'askingPrice', prompt: 'Seller asking/list price? Enter a number, or /skip if unknown:', numeric: true },
  { key: 'currency', prompt: 'Currency (USD, EUR, EGP, SAR, etc.). Use /skip if not specified:' },
  { key: 'sellerTarget', prompt: 'Seller minimum acceptable price / target? Enter a number, or /skip:', numeric: true },
  { key: 'buyerBudget', prompt: 'Buyer budget, if known? Enter a number, or /skip:', numeric: true },
  { key: 'sourceUrl', prompt: 'Optional listing/source URL. Send the link or /skip:' }
];

function begin(userId) {
  sessions.set(String(userId), { index: 0, data: {} });
  return STEPS[0].prompt;
}

function pending(userId) {
  return sessions.has(String(userId));
}

function clear(userId) {
  sessions.delete(String(userId));
}

function handle(userId, rawText) {
  const session = sessions.get(String(userId));
  if (!session) return { done: false, prompt: 'No active deal input.' };

  const step = STEPS[session.index];
  const value = String(rawText || '').trim();
  const skipped = value.toLowerCase() === '/skip';

  if (step.required && (!value || skipped)) {
    return { done: false, prompt: 'This field is required.\n' + step.prompt };
  }

  if (step.numeric && !skipped) {
    const amount = Number(value.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      return { done: false, prompt: 'Enter a valid positive number, or /skip.\n' + step.prompt };
    }
    session.data[step.key] = amount;
  } else if (!skipped) {
    if (step.key === 'assetType') {
      const types = {
        '1': 'product',
        '2': 'real_estate',
        '3': 'boat',
        '4': 'service',
        '5': 'other_asset'
      };
      const normalized = types[value] || value.toLowerCase().replace(/[\s/-]+/g, '_');
      if (!['product', 'real_estate', 'boat', 'service', 'other_asset'].includes(normalized)) {
        return { done: false, prompt: 'Choose 1, 2, 3, 4, or 5.\n' + step.prompt };
      }
      session.data[step.key] = normalized;
    } else if (step.key === 'sourceUrl') {
      let url;
      try {
        url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
      } catch (_) {
        return { done: false, prompt: 'Enter a valid http/https URL, or /skip.\n' + step.prompt };
      }
      session.data[step.key] = url.toString();
    } else {
      session.data[step.key] = value;
    }
  }

  session.index += 1;
  if (session.index < STEPS.length) {
    return { done: false, prompt: STEPS[session.index].prompt };
  }

  const data = { ...session.data };
  clear(userId);
  return { done: true, data };
}

module.exports = { begin, pending, handle, clear };
