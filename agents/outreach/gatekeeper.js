function reviewMessage(message) {
  const redactions = [
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    /(credit card|password|key|secret)/gi
  ];

  let body = message.body;
  let redacted = false;

  redactions.forEach(regex => {
    if (regex.test(body)) {
      body = body.replace(regex, '[REDACTED]');
      redacted = true;
    }
  });

  const isValid = message.to && message.body && message.subject;

  return {
    message_id: message.target + '_' + Date.now(),
    original: message,
    redacted_body: body,
    was_redacted: redacted,
    status: isValid ? 'APPROVED' : 'REJECTED',
    reason: isValid ? null : 'Missing required fields',
    reviewed_at: new Date().toISOString()
  };
}

module.exports = { reviewMessage };
