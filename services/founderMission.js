// services/founderMission.js
// v1.1 Customer #0 auto-start. The founder bootstrap already provisions the
// "Sell TEOS DealMaker" mission (Customer #0 = Elmahrosa International). This
// module starts that mission automatically after boot — resuming it through
// the governed runtime only when it has not yet been executed, so completed /
// paused / awaiting-approval missions are never re-run by accident.
'use strict';

const { forWorkspace } = require('../db/repos');
const runtime = require('./workforce/runtime');

const MISSION_TITLE = 'Sell TEOS DealMaker';
const STARTABLE_STATUSES = ['planned', 'running'];

async function autoStartFounderMission(adapter, workspaceId) {
  const wf = forWorkspace(adapter, workspaceId);
  const plans = await wf.plans.list();
  const mission = plans.find((p) => p.title === MISSION_TITLE);
  if (!mission) return { started: false, reason: 'no_mission' };
  if (!STARTABLE_STATUSES.includes(mission.status)) {
    return { started: false, reason: 'status_' + mission.status };
  }
  const result = await runtime.resume(adapter, workspaceId, mission.id);
  return {
    started: true,
    planId: mission.id,
    status: result.status,
    steps: result.steps.length,
    pendingApprovals: (result.pendingApprovals || []).length
  };
}

module.exports = { autoStartFounderMission, MISSION_TITLE };
