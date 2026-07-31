const audit = require('../../utils/auditLogger');

const BLOCK_RULES = [
  { type: 'profanity', pattern: /(f\*ck|shit|damn|bastard|idiot)/i },
  { type: 'spam', pattern: /(buy now|free money|click here|act now|!!!|win a prize)/i },
  { type: 'unsafe_link', pattern: /https?:\/\/\S+/i },
  { type: 'personal_data', pattern: /\b\d{16}\b/i }
];

function reviewDraft(draft, source) {
  const target = source || 'sales-draft';
  audit.writeEntry('GATEKEEPER_START_REVIEW', target, 'in_progress', { draft });

  const reasons = [];
  const text = draft || '';

  for (const rule of BLOCK_RULES) {
    if (rule.pattern.test(text)) reasons.push(rule.type);
  }

  const decision = reasons.length === 0 ? 'APPROVE' : 'REJECT';
  const result = { draft, reasons, decision };

  audit.writeEntry('GATEKEEPER_REVIEW_COMPLETED', target, decision, result);
  return result;
}

module.exports = { reviewDraft };
