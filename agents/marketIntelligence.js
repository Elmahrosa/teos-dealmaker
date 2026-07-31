const audit = require('../utils/auditLogger');

/**
 * Market Intelligence Agent
 * Analyzes prospect data to determine Fit Score and Priority Ranking.
 */
function analyzeProspect(prospectData) {
  audit.writeEntry('MARKET_INTELLIGENCE_ANALYSIS_STARTED', prospectData.id, 'in_progress', {
    prospectId: prospectData.id,
    company: prospectData.company
  });

  let fitScore = 50;
  let priority = 'Medium';
  let reasons = [];

  if (prospectData.industry === 'Technology' || prospectData.industry === 'Finance') {
    fitScore += 30;
    reasons.push('High-value industry match.');
  }

  if (prospectData.employeeCount > 50) {
    fitScore += 15;
    reasons.push('Scale indicates budget capacity.');
  } else {
    fitScore -= 10;
    reasons.push('Small team; potential budget constraints.');
  }

  if (fitScore >= 80) priority = 'High';
  else if (fitScore < 50) priority = 'Low';

  const result = { fitScore, priority, reasons };

  audit.writeEntry('MARKET_INTELLIGENCE_ANALYSIS_COMPLETED', prospectData.id, 'success', {
    prospectId: prospectData.id,
    result
  });

  return result;
}

module.exports = { analyzeProspect };
