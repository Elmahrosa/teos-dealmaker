# TEOS Civic Mixer — plugin

First official TEOS DealMaker plugin. Provides the MCP JSON-RPC gateway
**transport** (registered as the platform fallback adapter) plus civic
capabilities for lookup, identity, voting, and public issues.

## Capabilities

| Tool                  | Purpose                              |
|-----------------------|--------------------------------------|
| `civic.lookup`        | Look up a civic entity by id         |
| `civic.identity.verify` | Verify a civic identity            |
| `civic.vote.create`   | Create a ballot for a civic vote     |
| `civic.issue.create`  | Open a public issue in the civic arena |
| `civic.issue.list`    | List public issues in the civic arena |

Because the manifest declares `"fallback": true`, this plugin's adapter is used
for every gateway server without a dedicated adapter — exactly the role the old
built-in civic-mixer adapter played, now as a leaf plugin.

## Configuration (environment-driven)

No hardcoded URLs or credentials. The adapter reads (uppercase):

| Variable                 | Falls back to | Meaning            |
|--------------------------|---------------|--------------------|
| `CIVIC_MIXER_ENDPOINT`   | `MCP_ENDPOINT` | gateway base URL  |
| `CIVIC_MIXER_API_KEY`    | `MCP_API_KEY`  | bearer token       |
| `CIVIC_MIXER_TIMEOUT`    | `MCP_TIMEOUT`  | request timeout ms |

With no endpoint configured the adapter serves simulated responses, so the
plugin stays fully exercisable in dry mode.

## Governance

`policy.js` enforces two rules before any adapter I/O: `civic.vote.create`
requires `payload.ballotId` (`civic_ballot_required`) and `civic.issue.create`
requires `payload.title` (`civic_title_required`). `schema.js` declares the
per-tool JSON Schemas.

## Tests

Run with the aggregate suite (`npm test`) or directly:

```bash
node plugins/civic-mixer/tests/test.js
```
