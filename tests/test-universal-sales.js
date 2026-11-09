'use strict';

const assert = require('assert');
const planner = require('../services/workforce/planner');
const { REGISTRY } = require('../services/workforce/registry');

const goal = 'Sell Acme Cloud Backup subscriptions to mid-market IT directors in Germany';
const planned = planner.planGoal(goal);

assert.strictEqual(planned.intent, 'sell', 'sell request selects the universal sales intent');
assert.ok(planned.steps.length >= 10, 'sales mission composes a complete multi-specialist workflow');
assert.deepStrictEqual(
  planned.steps.map(step => step.step_key),
  ['commercial_brief', 'market_map', 'positioning', 'prospects', 'qualify', 'personalize', 'offer', 'policy_review', 'outreach_drafts', 'checkout_ready', 'objection_playbook', 'close_plan'],
  'sales mission follows the governed commercial lifecycle'
);
for (const type of ['revenue_strategist', 'market_intelligence', 'strategist', 'prospecting', 'qualification', 'marketer', 'negotiator', 'gatekeeper', 'outreach', 'treasurer', 'sales', 'closing']) {
  assert.ok(REGISTRY[type], 'sales mission uses registered specialist: ' + type);
}
const outreach = planned.steps.find(step => step.step_key === 'outreach_drafts');
assert.match(outreach.task, /Sending requires explicit channel authorization and approval/i, 'outbound sending remains approval-gated');
const checkout = planned.steps.find(step => step.step_key === 'checkout_ready');
assert.match(checkout.task, /Do not charge, invoice or make a financial commitment without explicit approval/i, 'financial actions remain approval-gated');
const close = planned.steps.find(step => step.step_key === 'close_plan');
assert.match(close.task, /verified buyer acceptance and payment evidence/i, 'revenue is not claimed without verification');
assert.ok(!planned.steps.some(step => /Elmahrosa|TEOS/i.test(step.task)), 'workflow is not hardcoded to Elmahrosa products');

assert.strictEqual(Object.keys(REGISTRY).length, 13, 'the workforce currently contains thirteen registered agents');

console.log('✓ universal sales mission planner — lifecycle, permissions, generic product and 13-agent registry');
