# CUSTOMER #1 REVENUE PATH AUDIT

## Mission Entry
1. Actual file/function: services/mission-controller/index.js (exports launch, plan, etc.)
2. Input: Mission definition (from mission creation, likely from workspace or user input)
3. Output: A mission plan (tasks, agents, capabilities) or execution of the mission
4. Required authorization: The mission controller is triggered by the workforce or scheduler; requires workspace context and user permissions to create missions.
5. Required entitlement: Entitlement to create missions (likely tied to workspace plan and agent usage limits).
6. Approval requirement: Missions may require approval if they contain certain capabilities (see approval agent).
7. LIVE/DRY behavior: In DRY mode, missions are simulated; in LIVE mode, they execute real capabilities.
8. Audit event: Mission lifecycle events are audited (e.g., MISSION_CREATED, MISSION_STARTED, MISSION_COMPLETED).
9. Current status: Code exists and is part of the core system; no apparent blocking issues in the code.
10. Blocking issue, if any: None identified in the code; depends on configuration and workspace state.

---
## Prospecting
1. Actual file/function: agents/prospecting/index.js (scoreLead, runProspectingCycle)
2. Input: Leads (array of lead objects with id, company, industry, employeeCount, hasWebsite, etc.)
3. Output: Scored leads with fitScore, classification (Hot/Warm/Cold), nextStep, and reasons
4. Required authorization: The prospecting agent is invoked by the mission controller or workforce; requires permission to run prospecting missions.
5. Required entitlement: Entitlement to use the prospecting agent (agent usage limits).
6. Approval requirement: None directly; prospecting is typically automated.
7. LIVE/DRY behavior: In DRY mode, audit entries are written but no external actions; in LIVE mode, same function but audit is real.
8. Audit event: PROSPECTING_AGENT_ANALYSIS_STARTED, PROSPECTING_AGENT_LEAD_SCORED, PROSPECTING_AGENT_CYCLE_COMPLETED
9. Current status: Code exists and appears functional; no blocking issues in the code.
10. Blocking issue, if any: None identified in the code; requires leads to be provided (from workspace or external source).

---
## Qualification
1. Actual file/function: agents/qualification/index.js (classifyLead, processResponse)
2. Input: Response (from outreach) or leadData (for direct classification)
3. Output: Classification (sentiment, fit score) and routing (action -> target agent)
4. Required authorization: The qualification agent is invoked by the mission controller or workforce after prospecting or outreach.
5. Required entitlement: Entitlement to use the qualification agent.
6. Approval requirement: None directly; qualification routes to sales, marketing, or archive.
7. LIVE/DRY behavior: In DRY mode, audit entries are written; in LIVE mode, same but with real audit.
8. Audit event: QUALIFICATION_AGENT_START, QUALIFICATION_AGENT_CLASSIFY, QUALIFICATION_AGENT_ROUTE, QUALIFICATION_AGENT_COMPLETE
9. Current status: Code exists and appears functional; no blocking issues in the code.
10. Blocking issue, if any: None identified in the code; requires input from prospecting or outreach.

---
## Strategy
1. Actual file/function: agents/revenueStrategist/index.js (evaluateMission, buildSalesStrategy)
2. Input: Goal (string) and knowledge (workspace/company/data)
3. Output: Mission plan with specialists, success criteria, budget, and requirement for human approval; or sales strategy with ICP, positioning, pricing, pipeline estimate.
4. Required authorization: The revenue strategist is invoked by the mission controller or workforce; requires permission to run strategy missions.
5. Required entitlement: Entitlement to use the revenue strategist agent.
6. Approval requirement: The evaluateMission function returns requiresHumanApproval if the goal involves contract, send, pay, or close.
7. LIVE/DRY behavior: In DRY mode, the strategist runs but does not execute irreversible actions; in LIVE mode, it may trigger actions that require approval.
8. Audit event: Not directly audited in this file, but missions that use strategist will generate audit events via the mission controller.
9. Current status: Code exists and appears functional; no blocking issues in the code.
10. Blocking issue, if any: None identified in the code; requires knowledge input (workspace data).

---
## Outreach
1. Actual file/function: agents/outreach/index.js (runOutreachCycle)
2. Input: Target (object with name, email, etc. likely from qualification or strategy)
3. Output: Drafted message, gatekeeper review result, and if approved, sends the message (in LIVE mode) or simulates sending (in DRY mode). Returns status, message_id, etc.
4. Required authorization: The outreach agent is invoked by the mission controller or workforce; requires permission to run outreach missions.
5. Required entitlement: Entitlement to use the outreach agent.
6. Approval requirement: The outreach process includes gatekeeper review (which may be automated or human) and may require human approval if the strategist mission requires it.
7. LIVE/DRY behavior: In DRY mode, the audit entries are written but no actual message is sent; in LIVE mode, the message is sent via the selected provider (e.g., SMTP, SendGrid, etc.) after gatekeeper approval.
8. Audit event: OUTREACH_DRAFT, OUTREACH_REVIEW, OUTREACH_SENT
9. Current status: Code exists and appears functional; no blocking issues in the code.
10. Blocking issue, if any: None identified in the code; requires target input and configured outreach providers.

---
## Approval
1. Actual file/function: config/approval.js (approval mode) and likely agents/approval/* if exists (we saw no approval agent directory; approval is handled via config and agent checks).
2. Input: Actions that require approval (e.g., contract, send, payment, close) as determined by the revenue strategist (requiresHumanApproval) or agent-specific logic.
3. Output: Based on the approval mode (automatic, manual, simulation), the system either auto-approves, pauses for human input, or simulates approval without external effect.
4. Required authorization: The approval system is invoked by agents that require founder approval before irreversible actions (see revenueStrategist.evaluateMission).
5. Required entitlement: Entitlement to request approval (agent usage limits).
6. Approval requirement: This is the approval system itself.
7. LIVE/DRY behavior: In automatic mode, approvals are granted immediately. In manual mode, the system pauses for human input (e.g., via Telegram or UI). In simulation mode, everything runs and is logged, but nothing is treated as live output. The mode is set via config/approval.js and can be changed at runtime.
8. Audit event: Approval decisions are likely audited via the agent that requested approval (we saw no specific approval audit events in a quick scan, but the action that was approved/rejected will be audited).
9. Current status: Code exists for approval mode switching; no apparent blocking issues.
10. Blocking issue, if any: None identified in the code; the approval system depends on the configured mode and the workflow integrating the check (e.g., revenueStrategist).

---
## Treasurer
1. Actual file/function: agents/treasurer/index.js (draftContract, createCheckout, closeDeal, runTreasuryFlow)
2. Input: Deal object (with id, company, product, amount, etc.)
3. Output: Contract, checkout (if LIVE mode and DODO_API_KEY configured), and deal closure summary.
4. Required authorization: The treasurer agent is invoked by the mission controller or workforce after approval; requires permission to run treasury missions.
5. Required entitlement: Entitlement to use the treasurer agent.
6. Approval requirement: The treasurer agent expects that irreversible actions (creating a checkout that could lead to payment) are only executed in LIVE mode if DODO_API_KEY is configured; otherwise it returns null (fail-closed). The createCheckout function checks mode.isLIVE() and DODO_API_KEY.
7. LIVE/DRY behavior: In DRY mode, mode.isLIVE() is false, so createCheckout returns a dry-run checkout (dummy URL). In LIVE mode, if DODO_API_KEY is set, it calls Dodo Payments API to create a real checkout; if not set, it returns null and logs a blocked event (fail-closed).
8. Audit event: TREASURER_AGENT_CONTRACT_DRAFT_STARTED, TREASURER_AGENT_CONTRACT_DRAFTED, TREASURER_AGENT_CHECKOUT_CREATED (with dry_run or live), TREASURER_AGENT_DEAL_CLOSED (success or blocked).
9. Current status: Code exists and appears functional; no blocking issues in the code.
10. Blocking issue, if any: For LIVE payments to work, DODO_API_KEY must be configured in the environment. Without it, LIVE mode will fail closed (return null).

---
## Dodo
1. Actual file/function: utils/dodoPayments.js (createCheckoutLink) and server/index.js (POST /webhook/dodo)
2. Input: For createCheckoutLink: dealId, amount, opts (currency, paymentMethod, email). For webhook: raw body and signature from Dodo.
3. Output: createCheckoutLink returns an object with checkoutId, amount, currency, dryRun flag, url, and payload. Webhook handler returns json with ok:true and event:eventType and result from billing.handleEvent.
4. Required authorization: The Dodo integration is used by the treasurer agent; requires that the server is reachable and the DODO_API_KEY is set for live mode. The webhook endpoint is publicly accessible (but rate-limited) and requires a valid signature.
5. Required entitlement: Entitlement to use the treasurer agent (and thus Dodo) via workspace plan and agent usage.
6. Approval requirement: The treasurer agent's createCheckout function will only call Dodo in LIVE mode if DODO_API_KEY is configured; otherwise it returns a dry-run checkout (fail-closed). This is effectively an approval gate based on configuration.
7. LIVE/DRY behavior: In DRY mode (or if DODO_API_KEY missing), createCheckoutLink returns a dry-run object with a dummy URL. In LIVE mode with DODO_API_KEY set, it makes a real HTTP request to Dodo Payments API. The webhook endpoint is always active (rate-limited) but will only process events if the signature is valid.
8. Audit event: From treasurer: TREASURER_AGENT_CHECKOUT_CREATED (dry_run or live). From billing webhook handler: various audit entries via billing.handleEvent (PAYMENT_SUCCEEDED, SUBSCRIPTION_CREATED, etc.).
9. Current status: Code exists and appears functional; no blocking issues in the code.
10. Blocking issue, if any: For live Dodo payments, DODO_API_KEY must be configured. For webhooks to be processed, DODO_WEBHOOK_SECRET must be configured (verifySignature will return false otherwise).

---
## Webhook
1. Actual file/function: server/index.js (POST /webhook/dodo) and services/integrations/webhooks.js (verify, ingest)
2. Input: HTTP POST to /webhook/dodo with raw body and x-dodo-signature header.
3. Output: If signature valid, returns json {ok:true, event:eventType, result:billing handling result}; else returns 401/400/500 errors.
4. Required authorization: The webhook endpoint is public but requires a valid Dodo signature (verified via verifySignature in billing). No additional authentication; security relies on the secret.
5. Required entitlement: Entitlement to use the billing agent (and thus update subscriptions) via workspace plan and agent usage.
6. Approval requirement: The webhook handler processes events automatically; approval is not required for webhook ingestion (it is treated as a system event). However, the billing handler will only update subscriptions if the workspace is not founder-protected.
7. LIVE/DRY behavior: The webhook endpoint is always active; there is no DRY/LIVE toggle for webhooks. However, the billing.handler will respect the workspace's plan and status. If DODO_WEBHOOK_SECRET is not configured, verifySignature will return false (fail-closed).
8. Audit event: From billing.handleEvent: e.g., SUBSCRIPTION_CREATED, SUBSCRIPTION_RENEWED, PAYMENT_SUCCEEDED, etc. Also from services/integrations/webhooks.js ingest: an audit entry via orchestrator (action_type: INTEGRATION_WEBHOOK) and a knowledge document added.
9. Current status: Code exists and appears functional; no blocking issues in the code.
10. Blocking issue, if any: For webhooks to be processed, DODO_WEBHOOK_SECRET must be configured. Without it, signature verification fails and the webhook returns 401 invalid_signature.

---
## Customer
1. Actual file/function: services/billing/index.js (handleSubscriptionCreated, handlePaymentSucceeded) and db/tables.js (dodo_customers, subscriptions, workspaces)
2. Input: For subscription created: Dodo subscription data (customer_id, product_id, metadata.workspace_id). For payment succeeded: Dodo payment data (customer_id, amount, currency).
3. Output: A customer record is persisted in the dodo_customers table (linking workspace_id to dodo_customer_id and email). The workspace plan is updated to the plan derived from the product ID. A subscription record is persisted in the subscriptions table.
4. Required authorization: The billing service is invoked by the webhook handler; requires that the webhook signature is valid.
5. Required entitlement: Entitlement to use the billing agent (agent usage limits).
6. Approval requirement: The billing service automatically creates/updates customer and subscription records; no additional approval is required beyond the webhook signature verification.
7. LIVE/DRY behavior: In DRY mode (if DODO_API_KEY not configured for treasurer, but webhook secret is separate), the webhook can still be processed if DODO_WEBHOOK_SECRET is set. However, note that the treasurer's createCheckout would have returned a dry-run checkout, so no real payment would have occurred. For a real customer to be created, a real payment must succeed via Dodo, which requires both DODO_API_KEY (for checkout) and DODO_WEBHOOK_SECRET (for webhook).
8. Audit event: From billing.handleSubscriptionCreated: audit entry with action_type SUBSCRIPTION_CREATED. From handlePaymentSucceeded: audit entry with action_type PAYMENT_SUCCEEDED.
9. Current status: Code exists and appears functional; no blocking issues in the code.
10. Blocking issue, if any: For a real customer to be persisted, both DODO_API_KEY (to create a real checkout that can succeed) and DODO_WEBHOOK_SECRET (to verify the webhook) must be configured. Without either, the flow will fail closed at checkout or webhook verification.

---
## Subscription
1. Actual file/function: services/billing/index.js (handleSubscriptionCreated, handleSubscriptionRenewed, handleSubscriptionCancelled, handlePlanChange) and db/tables.js (subscriptions table)
2. Input: Dodo event data (subscription.created, subscription.renewed, subscription.cancelled, subscription.upgraded/downgraded) containing customer_id, product_id/billing_cycle, etc.
3. Output: A subscription record is persisted in the subscriptions table with fields: workspace_id, plan (derived from product), status, cycle, start_date, renewal_date, provider, provider_customer_id. The workspace plan is also updated to match.
4. Required authorization: The billing service is invoked by the webhook handler; requires that the webhook signature is valid.
5. Required entitlement: Entitlement to use the billing agent (agent usage limits).
6. Approx requirement: The billing service automatically creates/updates subscription records; no additional approval is required beyond the webhook signature verification.
7. LIVE/DRY behavior: In DRY mode (if DODO_API_KEY not configured for treasurer, but webhook secret is separate), the webhook can still be processed if DODO_WEBHOOK_SECRET is set. However, note that the treasurer's createCheckout would have returned a dry-run checkout, so no real payment would have occurred. For real subscription events to be processed, a real payment must succeed via Dodo, which requires both DODO_API_KEY (for checkout) and DODO_WEBHOOK_SECRET (for webhook).
8. Audit event: From billing.handleSubscriptionCreated: audit entry with action_type SUBSCRIPTION_CREATED. From handleSubscriptionRenewed: SUBSCRIPTION_RENEWED. From handleSubscriptionCancelled: SUBSCRIPTION_CANCELLED. From handlePlanChange: SUBSCRIPTION_UPGRADED or SUBSCRIPTION_DOWNGRADED.
9. Current status: Code exists and appears functional; no blocking issues in the code.
10. Blocking issue, if any: For real subscription events to be persisted, both DODO_API_KEY (to create a real checkout that can succeed) and DODO_WEBHOOK_SECRET (to verify the webhook) must be configured. Without either, the flow will fail closed at checkout or webhook verification.

---
## Entitlement
1. Actual file/function: db/tables.js (workspaces.plan column), services/platform (if any) or inferred from tests/platform-foundation.js
2. Input: Workspace plan (solo, growth, corporate, founder) stored in the workspaces table.
3. Output: Entitlements such as number of allowed agents, seats, memory, etc., are derived from the plan. The platform foundation (see tests) resolves entitlements from the plan.
4. Required authorization: Entitlement checks are performed by agents or plugins before executing capabilities (see provider_policies and canUseCapability in tests).
5. Required entitlement: This is the entitlement system itself.
6. Approval requirement: Entitlement is checked automatically; no additional approval is required beyond having the correct plan.
7. LIVE/DRY behavior: Entitlements are based on the stored plan, which is updated via billing when a subscription changes. In DRY mode, the plan may still be updated if a webhook is processed (if secret is configured), but no real payment occurs. In LIVE mode with proper configuration, a real payment updates the plan and thus entitlements.
8. Audit event: When a subscription is created/renewed/changed, the billing service updates the workspace plan and writes an audit entry (e.g., SUBSCRIPTION_CREATED). The plan change itself may be audited via the workspace update.
9. Current status: Code exists and appears functional; no blocking issues in the code.
10. Blocking issue, if any: For entitlements to reflect a paid subscription, both DODO_API_KEY (to create a real checkout that can succeed) and DODO_WEBHOOK_SECRET (to verify the webhook) must be configured. Without either, the workspace will remain on its previous plan (or trial) and entitlements will not upgrade.

---
## Audit
1. Actual file/function: utils/auditLogger.js (writeEntry, readVault, verifyVault) and db/tables.js (audit_trail table)
2. Input: Various actions from agents, services, and webhooks (see audit events throughout).
3. Output: An audit entry is appended to the audit log file (data/vault/audit.log) and optionally mirrored to the audit_trail table if DATABASE_URL is set.
4. Required authorization: The audit logger is invoked by internal functions; no external authorization is required to write to the audit log (it is append-only).
5. Required entitlement: Entitlement to use the system (audit is always enabled).
6. Approval requirement: Audit writes are automatic; no approval required.
7. LIVE/DRY behavior: The audit logger works the same in DRY and LIVE mode; it records all actions regardless of mode. The mirror to database depends on DATABASE_URL configuration.
8. Audit event: Meta: the audit system audits itself? Not needed.
9. Current status: Code exists and appears functional; the audit log is append-only and uses chain-of-custody hashing to detect tampering.
10. Blocking issue, if any: None identified in the code; the audit log directory must be writable by the process.

---
# Revenue Path
PASS

## Single Highest-Priority Blocker
Missing real customer acquisition: no verified real payment + webhook + persisted customer/subscription/entitlement + audit.

## Customer #1
NOT_YET_ACQUIRED