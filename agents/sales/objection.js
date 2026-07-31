function classifyObjection(response) {
  const text = response.toLowerCase();

  const types = {
    price: /price|cost|expensive|afford|budget/i,
    authority: /approve|team|decision|check|ask|manager/i,
    timing: /\bnow\b|later|soon|timeline|ready|\bplan\b/i,
    trust: /proof|case study|reference|risk|security|trust|works\?/i,
    fit: /relevant|need|use|apply|match|fit/i
  };

  for (const [type, regex] of Object.entries(types)) {
    if (regex.test(text)) {
      return type;
    }
  }

  return 'general';
}

module.exports = { classifyObjection };
