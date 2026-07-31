const { classifyObjection } = require('./objection');

function generateResponse(objection) {
  const type = classifyObjection(objection);

  const responses = {
    price: `We offer flexible tiers (Solo $99/mo, Growth $249/mo, Corporate $799/mo). Which fits your budget?`,
    timing: `Understood. We can start with a pilot first. When works for you?`,
    fit: `Sentinel Shield works for: code audits, smart contract review, CI/CD security. Does that apply?`,
    authority: `Perfect. We can schedule a call with your team to align on needs.`,
    trust: `We have case studies on GitHub. Happy to share references.`,
    general: `Thanks for the feedback. How can we address your concerns?`
  };

  return {
    objection_type: type,
    response: responses[type],
    suggested_action: type === 'price' ? 'compare_tiers' : type === 'timing' ? 'pilot_offer' : 'escalate_to_demo'
  };
}

module.exports = { generateResponse };
