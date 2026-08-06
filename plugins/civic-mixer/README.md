# TEOS Civic Mixer — plugin

First official TEOS DealMaker plugin. Provides the MCP JSON-RPC gateway
**transport** (registered as the platform fallback adapter) plus civic
capabilities for lookup, identity, voting, and public issues.

## Capabilities

| Tool                  | Purpose                              | Gate                                    |
|-----------------------|--------------------------------------|-----------------------------------------|
| `civic.lookup`        | Look up a civic entity by id         | read-only                               |
| `civic.identity.verify` | Verify a civic identity            | read-only                               |
| `civic.vote.create`   | Create a ballot for a civic vote     | **Authorization Stamp** required        |
| `civic.issue.create`  | Open a public issue in the civic arena | **Authorization Stamp** required      |
| `civic.issue.list`    | List public issues in the civic arena | read-only                              |

Because the manifest declares `"fallback": true`, this plugin's adapter is used
for every gateway server without a dedicated adapter — exactly the role the old
built-in civic-mixer adapter played, now as a leaf plugin.

## Elmahrosa Law over Code — ICBC compliance

This plugin enforces the International Civic Blockchain Constitution
(`Article IX — Cryptographic Enforcement of Authority`) and
`docs/09_AUTHORIZATION_STAMP_SPEC.md`:

- **State-affecting capabilities require a valid Authorization Stamp.** A
  `civic.vote.create` / `civic.issue.create` request must carry a stamp in
  `payload.authorizationStamp` proving it traversed the Sovereign Authority
  Chain and received explicit human institutional approval. Missing, malformed,
  expired, scope-exceeding, or self-authorizing stamps are rejected before any
  adapter I/O (`authorization_stamp_required`,
  `invalid_authorization_stamp`, `authorization_stamp_expired`,
  `authorization_scope_exceeded`).
- **No self-authorization.** The plugin is a read-only verifier
  (`plugins/civic-mixer/authority.js`); it never issues or signs stamps. Stamp
  issuance is exclusively the Governance / Safety (AI Guard) layers' role.
- **Audit evidence before execution.** Every state-changing attempt is written
  to the plugin audit trail (`plugins/civic-mixer/audit.js`) before the adapter
  executes, per the mandatory "immutable logging prior to execution" lifecycle.
- **Read-only capabilities are ungated** (`civic.lookup`, `civic.issue.list`,
  `civic.identity.verify`) in line with the stamp spec's read-only exemption.

The plugin's `policy.js` rules are enforced by the platform policy engine
before any transport; `schema.js` requires the stamp for write tools as the
input contract.

## Configuration (environment-driven)

No hardcoded URLs or credentials. The adapter reads (uppercase):

| Variable                 | Falls back to | Meaning            |
|--------------------------|---------------|--------------------|
| `CIVIC_MIXER_ENDPOINT`   | `MCP_ENDPOINT` | gateway base URL  |
| `CIVIC_MIXER_API_KEY`    | `MCP_API_KEY`  | bearer token       |
| `CIVIC_MIXER_TIMEOUT`    | `MCP_TIMEOUT`  | request timeout ms |

The API key is used only in the outbound `Authorization` header and is never
exposed through `config()` (redacted as `***redacted***`). With no endpoint
configured the adapter serves simulated responses, so the plugin stays fully
exercisable in dry mode.

## Governance

`policy.js` enforces the law gate (see above) plus two structural rules before
any adapter I/O: `civic.vote.create` requires `payload.ballotId`
(`civic_ballot_required`) and `civic.issue.create` requires `payload.title`
(`civic_title_required`). `schema.js` declares the per-tool JSON Schemas.
`authority.js` implements the canonical Authorization Stamp verification
(`AUTH-1.0`).

## Tests

Run with the aggregate suite (`npm test`) or directly:

```bash
node plugins/civic-mixer/tests/test.js
```
