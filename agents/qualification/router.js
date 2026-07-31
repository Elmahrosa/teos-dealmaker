function route(classification) {
  const { sentiment, fit } = classification;

  let action, targetAgent, reason;

  if (sentiment === 'uninterested' || fit.label === 'low') {
    action = 'archive';
    targetAgent = null;
    reason = sentiment === 'uninterested' ? 'Uninterested response' : 'Low fit score';
  } else if (sentiment === 'interested' && fit.label === 'high') {
    action = 'escalate';
    targetAgent = 'sales';
    reason = 'High fit + interested — route to Sales';
  } else if (sentiment === 'interested' && fit.label === 'neutral') {
    action = 'follow_up';
    targetAgent = 'qualification';
    reason = 'Interested but neutral fit — schedule follow-up';
  } else if (sentiment === 'neutral' && fit.label === 'high') {
    action = 'follow_up';
    targetAgent = 'qualification';
    reason = 'Neutral response but high fit — nurture';
  } else {
    action = 'follow_up';
    targetAgent = 'qualification';
    reason = 'Default — monitor and follow up';
  }

  return {
    response_id: classification.response_id,
    action,
    target_agent: targetAgent,
    reason,
    routed_at: new Date().toISOString()
  };
}

module.exports = { route };
