const APPROVAL_THRESHOLD = 0.55;

function evaluate({ review, simulated, retries = 0, attempts = 1 }) {
  let confidence = 0.55;
  const reasons = [];

  if (review && typeof review.score === 'number') {
    confidence += (review.score / 100) * 0.25;
    reasons.push(`reviewer scored ${review.score}/100 (${review.decision})`);
  }
  if (simulated) {
    confidence -= 0.05;
    reasons.push('provider simulated (no live key)');
  } else {
    confidence += 0.15;
    reasons.push('live provider response');
  }
  if (retries > 0) {
    confidence -= 0.1 * retries;
    reasons.push(`retried ${retries} time${retries > 1 ? 's' : ''}`);
  }
  if (attempts > 1) {
    confidence -= 0.05 * (attempts - 1);
    reasons.push(`${attempts} attempts`);
  }

  confidence = Math.max(0.05, Math.min(0.98, confidence));
  const label = confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low';
  return { confidence, label, reasons };
}

function needsApproval(confidence, threshold) {
  return confidence < (threshold === undefined ? APPROVAL_THRESHOLD : threshold);
}

module.exports = { APPROVAL_THRESHOLD, evaluate, needsApproval };
