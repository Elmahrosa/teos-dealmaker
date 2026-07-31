const FIT_KEYWORDS = {
  high: ['partnership', 'collaborate', 'interested', 'explore', 'meet', 'demo', 'pilot', 'integration'],
  low: ['not interested', 'unsubscribe', 'no budget', 'wrong fit', 'not now', 'stop']
};

const SENTIMENT_KEYWORDS = {
  interested: ['yes', 'interested', 'great', 'awesome', 'tell me more', 'schedule', 'let\'s talk', 'sounds good'],
  uninterested: ['no', 'not interested', 'stop', 'unsubscribe', 'leave me alone', 'spam', 'waste of time'],
  neutral: ['maybe', 'busy', 'later', 'forward', 'cc', 'not sure', 'considering']
};

function extractSentiment(text) {
  const lower = text.toLowerCase();

  for (const word of SENTIMENT_KEYWORDS.uninterested) {
    if (lower.includes(word)) return 'uninterested';
  }

  for (const word of SENTIMENT_KEYWORDS.interested) {
    if (lower.includes(word) && !lower.includes('not ' + word)) return 'interested';
  }

  return 'neutral';
}

function scoreFit(text, targetIndustry) {
  const lower = text.toLowerCase();
  let score = 50;

  for (const word of FIT_KEYWORDS.high) {
    if (lower.includes(word)) score += 10;
  }

  for (const word of FIT_KEYWORDS.low) {
    if (lower.includes(word)) score -= 15;
  }

  if (targetIndustry && lower.includes(targetIndustry.toLowerCase())) {
    score += 20;
  }

  score = Math.max(0, Math.min(100, score));

  if (score >= 70) return { score, label: 'high' };
  if (score >= 40) return { score, label: 'neutral' };
  return { score, label: 'low' };
}

function classify(response) {
  const sentiment = extractSentiment(response.body || response.text || '');
  const fit = scoreFit(response.body || response.text || '', response.industry);

  return {
    response_id: response.id || `${response.from}_${Date.now()}`,
    from: response.from,
    sentiment,
    fit,
    classified_at: new Date().toISOString()
  };
}

module.exports = { classify, extractSentiment, scoreFit };
