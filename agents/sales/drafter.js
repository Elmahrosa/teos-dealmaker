const { classifyObjection } = require('./objection');
const audit = require('../../utils/auditLogger');

const SYSTEM_PROMPT = 'You are an expert SaaS sales engineer. Respond with a concise, professional draft reply to the prospect. Never promise unverifiable claims.';

const DRAFT_TEMPLATES = {
  price: 'I understand the price is a concern. Let me show you the ROI calculation for your specific use case — our tiers start at Solo $99/mo.',
  timing: 'Understood on timing. We can start with a low-commitment pilot — when would work best for you?',
  fit: 'Sentinel Shield applies to code audits, smart contract review, and CI/CD security. Would a short walkthrough help confirm the fit?',
  authority: 'Absolutely — happy to schedule a call with your team to align on needs and answer their questions.',
  trust: 'We have published case studies on GitHub plus reference customers. I would be glad to share them.',
  general: 'Thanks for the feedback. Could you tell me more so I can find the right path forward?'
};

function draftResponse(prompt, userId) {
  const target = String(userId || 'unknown');
  audit.writeEntry('SALES_AGENT_START_DRAFT', target, 'in_progress', { input: prompt });

  const objectionType = classifyObjection(prompt || '');
  const result = {
    userId,
    input: prompt,
    prompt: SYSTEM_PROMPT,
    objectionType,
    draft: DRAFT_TEMPLATES[objectionType]
  };

  audit.writeEntry('SALES_AGENT_DRAFT_COMPLETED', target, 'success', result);
  return result;
}

module.exports = { draftResponse };
