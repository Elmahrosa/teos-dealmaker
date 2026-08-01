const { forWorkspace } = require('../../db/repos');
const { emit, EVENT_NAMES } = require('./events');

const APPROVAL_GATES = [
  { action: 'send_proposal', label: 'Send Proposal', match: /^\s*send[^.!?\n]*(proposal|offer)/i },
  { action: 'send_email', label: 'Send Email', match: /^\s*send[^.!?\n]*(email|message|outreach|follow.?up)/i },
  { action: 'create_invoice', label: 'Create Invoice', match: /^\s*create[^.!?\n]*(invoice|billing|checkout)/i },
  { action: 'issue_refund', label: 'Issue Refund', match: /^\s*issue[^.!?\n]*refund/i },
  { action: 'delete_workspace', label: 'Delete Workspace', match: /^\s*delete[^.!?\n]*workspace/i },
  { action: 'change_subscription', label: 'Change Subscription', match: /^\s*change[^.!?\n]*subscription/i },
  { action: 'enable_live', label: 'Enable LIVE Mode', match: /^\s*(enable live|turn on live)/i },
  { action: 'present_strategy', label: 'Present Strategy', match: /^\s*(present|deliver|approve)[^.!?\n]*(strategy|plan)/i }
];

function gatesFor(step) {
  const text = String(step.task || '');
  return APPROVAL_GATES.filter(g => g.match.test(text)).map(g => g.action);
}

function requiresApproval(step) {
  return gatesFor(step).length > 0;
}

async function request(adapter, workspaceId, { plan_id, step_id, agent_type, reason }) {
  const repos = forWorkspace(adapter, workspaceId);
  const row = await repos.approvals.create({ plan_id, step_id, agent_type, reason });
  const stored = row.id ? row : await repos.approvals.list('pending').then(rows => rows.find(r => r.step_id === step_id));
  emit(EVENT_NAMES.APPROVAL_REQUESTED, { approvalId: stored.id, stepId: step_id, agentType: agent_type, reason });
  return stored;
}

async function decide(adapter, workspaceId, requestId, decision, userId) {
  const repos = forWorkspace(adapter, workspaceId);
  const existing = await repos.approvals.get(requestId);
  if (!existing) throw new Error(`Approval request ${requestId} not found`);
  if (existing.status !== 'pending') throw new Error(`Approval request ${requestId} already ${existing.status}`);
  const status = decision === 'approve' ? 'approved' : 'rejected';
  await repos.approvals.update(requestId, {
    status,
    decided_at: new Date().toISOString(),
    decided_by: userId || null
  });
  const updated = await repos.approvals.get(requestId);
  emit(EVENT_NAMES.APPROVAL_DECIDED, { approvalId: requestId, status, stepId: updated.step_id });
  return updated;
}

async function pendingForStep(adapter, workspaceId, stepId) {
  const repos = forWorkspace(adapter, workspaceId);
  const rows = await repos.approvals.list('pending');
  return rows.find(r => r.step_id === stepId) || null;
}

module.exports = { APPROVAL_GATES, gatesFor, requiresApproval, request, decide, pendingForStep };
