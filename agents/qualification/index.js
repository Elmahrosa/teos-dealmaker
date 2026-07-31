const { classify } = require('./classifier');
const { route } = require('./router');
const audit = require('../../utils/auditLogger');

function processResponse(response) {
  console.log(`[Qualification] Processing response from ${response.from}`);

  const classification = classify(response);
  console.log(`[Qualification] Sentiment: ${classification.sentiment}, Fit: ${classification.fit.label} (${classification.fit.score})`);
  audit.writeEntry('QUALIFICATION_CLASSIFY', response.from, classification.sentiment, classification);

  const routing = route(classification);
  console.log(`[Qualification] Action: ${routing.action} -> ${routing.target_agent || 'archive'}`);
  audit.writeEntry('QUALIFICATION_ROUTE', response.from, routing.action, routing);

  return { classification, routing };
}

module.exports = { processResponse };
