# TEOS Sentinel Shield — plugin

Second official TEOS DealMaker plugin. A governance shield that scans
workspaces, pulls audit trails, checks policy decisions, and lists rules —
delivered as a fully isolated leaf package with no changes to agents or bot
logic.

## Capabilities

| Tool                  | Purpose                                            |
|-----------------------|----------------------------------------------------|
| `sentinel.scan`       | Scan a workspace for policy violations             |
| `sentinel.audit`      | Pull the audit trail for a workspace               |
| `sentinel.policy.check` | Check a policy decision without executing a tool |
| `sentinel.rules.list` | List active governance rules                       |
| `sentinel.health`     | Report sentinel status and latency                 |

The plugin declares `"fallback": false`, so it never shadows the civic-mixer
transport; it exposes its own `sentinel` server.

## Configuration (environment-driven)

No hardcoded URLs or credentials. The adapter reads (uppercase):

| Variable               | Meaning            |
|------------------------|--------------------|
| `SENTINEL_ENDPOINT`    | sentinel base URL  |
| `SENTINEL_API_KEY`     | bearer token       |
| `SENTINEL_TIMEOUT`     | request timeout ms |

With no endpoint configured the adapter serves simulated responses, so the
shield stays fully exercisable in dry mode.

## Governance

`policy.js` enforces three rules before any adapter I/O: `sentinel.scan` and
`sentinel.audit` require a `workspaceId` (`sentinel_workspace_required`);
`sentinel.policy.check` requires `payload.toolId` (`sentinel_tool_required`).
`audit.js` is a plugin-side audit writer wired onto the plugin record.
`schema.js` declares the per-tool JSON Schemas.

## Tests

Run with the aggregate suite (`npm test`) or directly:

```bash
node plugins/sentinel/tests/test.js
```
