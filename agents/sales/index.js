const { generateResponse } = require('./responder');
const { route } = require('../router');
const audit = require('../../utils/auditLogger');
const { getMode } = require('../../config/mode');

function runSalesCycle(userResponse) {
  console.log(`[Sales] Processing objection: "${userResponse.substring(0, 50)}..."`);

  const response = generateResponse(userResponse);
  console.log(`[Sales] Objection type: ${response.objection_type}`);
  audit.writeEntry('SALES_CLASSIFY', response.objection_type, 'success', response);

  const messageToSend = {
    id: 'sales_' + Date.now(),
    body: response.response,
    action: response.suggested_action
  };

  const routed = route(messageToSend, 'customer');
  console.log(`[Sales] Routed (${getMode()}): ${routed.status}`);
  audit.writeEntry('SALES_ROUTE', response.objection_type, routed.status, routed);

  return {
    objection_type: response.objection_type,
    response: response.response,
    suggested_action: response.suggested_action,
    mode: getMode(),
    status: routed.status
  };
}

module.exports = { runSalesCycle };
