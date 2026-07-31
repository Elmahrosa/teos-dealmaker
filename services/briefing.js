const { createRepos } = require('../db/repos');

function dayOf(iso) {
  return String(iso || '').slice(0, 10);
}

async function executiveBriefing(adapter, workspaceId) {
  const repos = createRepos(adapter);
  const [runs, deals] = await Promise.all([
    repos.agentRuns.list(workspaceId),
    repos.deals.list(workspaceId, {})
  ]);
  const today = dayOf(new Date().toISOString());
  const yesterday = dayOf(new Date(Date.now() - 86400000).toISOString());

  const countBy = (agents, onDay) => runs.filter(r =>
    agents.includes(r.agent_name) && dayOf(r.started_at) === onDay && r.status === 'completed'
  ).length;

  const openDeals = deals.filter(d => d.status === 'open');
  const pipelineValue = openDeals.reduce((acc, d) => acc + (d.deal_value || 0), 0);
  const revenueForecast = Math.round(pipelineValue * 0.2);

  const needMeetings = openDeals.filter(d => ['research', 'qualification'].includes(d.stage)).length;

  const now = Date.now();
  const highRisk = openDeals
    .map(d => ({ id: d.id, company: d.company_name, stage: d.stage, days: Math.floor((now - new Date(d.created_at).getTime()) / 86400000) }))
    .filter(d => d.days > 14)
    .sort((a, b) => b.days - a.days);

  return {
    date: today,
    yesterday: {
      prospects: countBy(['prospecting', 'market_intelligence'], yesterday),
      qualified: countBy(['qualification'], yesterday),
      emails: countBy(['outreach'], yesterday),
      proposals: countBy(['strategist', 'marketer'], yesterday)
    },
    today_opportunities: countBy(['prospecting', 'market_intelligence'], today),
    pipeline_value_cents: pipelineValue,
    open_deals: openDeals.length,
    meetings_needed: needMeetings,
    revenue_forecast_cents: revenueForecast,
    high_risk_deals: highRisk,
    recommended_action: highRisk.length
      ? `Review high risk: ${highRisk[0].company} stalled in ${highRisk[0].stage} (${highRisk[0].days} days).`
      : (needMeetings > 0 ? `Book ${needMeetings} meeting${needMeetings === 1 ? '' : 's'} to keep qualified leads moving.` : 'Import new leads to keep the pipeline full.')
  };
}

module.exports = { executiveBriefing };
