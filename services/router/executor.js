// services/router/executor.js
// v1.1 execution layer. Dispatches an accepted intent to the real services
// (workforce runtime, approvals, planner, repos). Any raw 400/500/Unknown
// error is converted by selfRepair into diagnostics + suggested next actions —
// the founder/customer never sees a crash, they see a repair plan.
'use strict';

const runtime = require('../workforce/runtime');
const approvals = require('../workforce/approvals');
const planner = require('../workforce/planner');
const { forWorkspace } = require('../../db/repos');
const { createKnowledgeBase } = require('../knowledge');

async function latestPlan(adapter, workspaceId) {
  const plans = await forWorkspace(adapter, workspaceId).plans.list();
  return plans && plans.length ? plans[0] : null;
}

async function latestSteps(adapter, workspaceId, plan) {
  if (!plan) return [];
  return forWorkspace(adapter, workspaceId).planSteps.list(plan.id);
}

async function dispatch(adapter, step, ctx, session) {
  const wsId = ctx.workspaceId;
  const wf = forWorkspace(adapter, wsId);
  const lang = step.language || ctx.language;

  switch (step.intent) {
    case 'greeting':
      return { action: 'greeting', data: { language: lang } };

    case 'help':
      return { action: 'help', data: { language: lang, isFounder: ctx.isFounder } };

    case 'status': {
      const plan = await latestPlan(adapter, wsId);
      const steps = plan ? await latestSteps(adapter, wsId, plan) : [];
      return { action: 'status', data: { plan, steps, isFounder: ctx.isFounder } };
    }

    case 'analytics': {
      const plans = await wf.plans.list();
      const openDeals = (await wf.deals.list({ status: 'open' })) || [];
      const pending = (await wf.approvals.list('pending')) || [];
      const agentRuns = (await adapter.find('agent_runs', { workspace_id: wsId })) || [];
      return {
        action: 'analytics',
        data: { plans, openDeals, pending, agentRuns, isFounder: ctx.isFounder }
      };
    }

    case 'run_sales':
    case 'campaign': {
      const plan = await latestPlan(adapter, wsId);
      if (!plan) return { action: 'need_plan', data: { language: lang } };
      const result = await runtime.resume(adapter, wsId, plan.id);
      session.currentMission = { planId: plan.id, title: plan.title };
      session.lastMission = { planId: plan.id, title: plan.title };
      return { action: 'run_sales', data: { plan: result.plan, steps: result.steps, pendingApprovals: result.pendingApprovals, language: lang } };
    }

    case 'create_mission': {
      const goal = step.params.goal;
      if (!goal) {
        session.missingInformation.push('goal');
        session.lastQuestion = 'goal';
        return { action: 'need_goal', data: { language: lang } };
      }
      const steps = planner.buildSteps(goal, planner.intentOf(goal));
      const plan = await wf.plans.create({
        title: `Mission: ${goal}`,
        goal,
        status: 'planned',
        metrics: { total_steps: steps.length, source: 'router' }
      });
      for (const s of steps) {
        await wf.planSteps.create({
          plan_id: plan.id,
          step_key: s.step_key,
          agent_type: s.agent_type,
          step_group: s.step_group,
          depends_on: s.depends_on,
          task: s.task,
          priority: s.priority
        });
      }
      const result = await runtime.resume(adapter, wsId, plan.id);
      session.currentMission = { planId: plan.id, title: plan.title };
      session.lastMission = { planId: plan.id, title: plan.title };
      return { action: 'create_mission', data: { plan: result.plan, steps: result.steps, language: lang } };
    }

    case 'new_customer': {
      const name = step.params.name;
      if (!name) {
        session.missingInformation.push('customer_name');
        session.lastQuestion = 'customer_name';
        return { action: 'need_customer_name', data: { language: lang } };
      }
      const deal = await wf.deals.create({ company_name: name, stage: 'lead', status: 'open', current_agent: 'prospecting' });
      session.customer = { dealId: deal.id, name };
      return { action: 'new_customer', data: { deal, language: lang } };
    }

    case 'find_customers':
    case 'deals': {
      const deals = await wf.deals.list({ status: 'open' });
      return { action: 'deals', data: { deals: deals || [], language: lang } };
    }

    case 'knowledge': {
      const query = step.params.query;
      if (!query) return { action: 'need_knowledge_query', data: { language: lang } };
      const kb = createKnowledgeBase(adapter);
      const hits = (await kb.search(wsId, query, { topK: 6 }))
        .filter(h => h.sharedTokens >= 1 && (h.rawScore == null ? h.score : h.rawScore) >= 0.05)
        .slice(0, 3);
      return { action: 'knowledge', data: { query, hits, language: lang } };
    }

    case 'revenue': {
      const plans = await wf.plans.list();
      const openDeals = (await wf.deals.list({ status: 'open' })) || [];
      const latest = plans && plans.length ? plans[0] : null;
      return { action: 'revenue', data: { plans, openDeals, latest, language: lang } };
    }

    case 'talk_to_agent': {
      let agent = step.params.agent;
      let entry = agent && ctx.agentRegistry[agent] ? ctx.agentRegistry[agent] : null;
      if (!entry && ctx.universalAgents) {
        const picked = ctx.universalAgents.orchestrator(step.text || (agent || ''));
        if (picked && picked.primary) {
          agent = picked.primary.id;
          entry = picked.primary;
        }
      }
      if (entry) {
        session.currentAgent = agent;
        session.lastAgent = agent;
      }
      return { action: 'talk_to_agent', data: { agent: agent || null, entry, language: lang } };
    }

    case 'approve':
    case 'cancel': {
      const decision = step.intent === 'approve' ? 'approved' : 'rejected';
      let requestId = step.params.requestId || (session.approvalState && session.approvalState.requestId);
      if (!requestId) {
        const pending = await wf.approvals.list('pending');
        if (pending && pending.length === 1) requestId = pending[0].id;
        else if (pending && pending.length > 1) {
          session.lastQuestion = 'approval_choice';
          return { action: 'need_approval_choice', data: { pending, language: lang } };
        }
      }
      if (!requestId) return { action: 'no_pending_approvals', data: { language: lang } };
      const updated = await approvals.decide(adapter, wsId, requestId, decision, ctx.userId);
      session.approvalState = null;
      let resumed = null;
      if (updated.step_id) {
        const plan = await latestPlan(adapter, wsId);
        if (plan) {
          resumed = await runtime.resume(adapter, wsId, plan.id);
          session.currentMission = { planId: plan.id, title: plan.title };
          session.lastMission = { planId: plan.id, title: plan.title };
        }
      }
      return { action: step.intent, data: { updated, resumed, language: lang } };
    }

    case 'continue': {
      const plan = await latestPlan(adapter, wsId);
      if (!plan) return { action: 'need_plan', data: { language: lang } };
      const result = await runtime.resume(adapter, wsId, plan.id);
      session.currentMission = { planId: plan.id, title: plan.title };
      session.lastMission = { planId: plan.id, title: plan.title };
      return { action: 'continue', data: { plan: result.plan, steps: result.steps, language: lang } };
    }

    case 'error_report': {
      const plans = await wf.plans.list();
      const pending = await wf.approvals.list('pending');
      return { action: 'diagnostics', data: { plans, pending, language: lang, isFounder: ctx.isFounder } };
    }

    case 'settings': {
      const language = step.params.language || (step.language === 'ar' ? 'ar' : 'en');
      await require('../workspace').setWorkspaceLang(adapter, wsId, language);
      session.language = language;
      return { action: 'settings', data: { language } };
    }

    case 'pricing': {
      if (ctx.isFounder) return { action: 'no_pricing', data: { language: lang } };
      return { action: 'pricing', data: { language: lang } };
    }

    default:
      return { action: 'unknown', data: { language: lang, isFounder: ctx.isFounder } };
  }
}

function selfRepair(step, ctx, err) {
  return {
    action: 'diagnostics',
    error: err && err.message ? String(err.message) : 'Unknown execution error',
    data: {
      language: step.language || (ctx && ctx.language) || 'en',
      isFounder: ctx ? ctx.isFounder : false,
      repair: true
    }
  };
}

async function execute(adapter, step, ctx, session) {
  try {
    return await dispatch(adapter, step, ctx, session);
  } catch (err) {
    return selfRepair(step, ctx, err);
  }
}

module.exports = { execute, dispatch, selfRepair };
