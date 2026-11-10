const i18n = require('./i18n');

const sessions = new Map();

const P = (userId, step) => i18n.t(userId, step.prompt);

const STEPS = [
  { key: 'assetType', prompt: 'di_assetType', required: true },
  { key: 'description', prompt: 'di_description', required: true },
  { key: 'askingPrice', prompt: 'di_askingPrice', numeric: true },
  { key: 'currency', prompt: 'di_currency' },
  { key: 'sellerTarget', prompt: 'di_sellerTarget', numeric: true },
  { key: 'buyerBudget', prompt: 'di_buyerBudget', numeric: true },
  { key: 'sourceUrl', prompt: 'di_sourceUrl' }
];

function begin(userId) {
  sessions.set(String(userId), { index: 0, data: {} });
  return P(userId, STEPS[0]);
}

function pending(userId) {
  return sessions.has(String(userId));
}

function clear(userId) {
  sessions.delete(String(userId));
}

function handle(userId, rawText) {
  const session = sessions.get(String(userId));
  if (!session) return { done: false, prompt: i18n.t(userId, 'di_no_active') };

  const step = STEPS[session.index];
  // Accept Arabic-Indic digits and the Arabic decimal/thousands separators.
  const value = String(rawText || '').trim()
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/\u066B/g, '.').replace(/\u066C/g, ',');
  const skipped = value.toLowerCase() === '/skip';

  if (step.required && (!value || skipped)) {
    return { done: false, prompt: i18n.t(userId, 'di_required') + '\n' + P(userId, step) };
  }

  if (step.numeric && !skipped) {
    const amount = Number(value.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      return { done: false, prompt: i18n.t(userId, 'di_bad_number') + '\n' + P(userId, step) };
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
        return { done: false, prompt: i18n.t(userId, 'di_bad_choice') + '\n' + P(userId, step) };
      }
      session.data[step.key] = normalized;
    } else if (step.key === 'sourceUrl') {
      let url;
      try {
        url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
      } catch (_) {
        return { done: false, prompt: i18n.t(userId, 'di_bad_url') + '\n' + P(userId, step) };
      }
      session.data[step.key] = url.toString();
    } else {
      session.data[step.key] = value;
    }
  }

  session.index += 1;
  if (session.index < STEPS.length) {
    return { done: false, prompt: P(userId, STEPS[session.index]) };
  }

  const data = { ...session.data };
  clear(userId);
  return { done: true, data };
}

module.exports = { begin, pending, handle, clear };
