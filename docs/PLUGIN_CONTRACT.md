# TEOS DealMaker — Plugin Platform Contract

Status: **apiVersion 1** — active, additive-only.

The plugin system is a **platform contract**, not a directory scanner. It is a
stable interface that plugin authors build against and that core guarantees for
as long as a manifest's `apiVersion` matches the platform's `API_VERSION` and
its `engine` range covers the running engine version.

The platform is **transport-agnostic by design**. The generic runtime lives in
`services/plugin-manager/` and knows nothing about MCP, HTTP, gRPC, CLI, or any
other transport. MCP is one consumer of it; future transports (local SDKs,
gRPC, CLI, WebSocket) can be added without touching the platform. The
machine-readable half of the contract is
`services/plugin-manager/manifest.schema.json`; the human spec is this file.

A plugin is a self-contained package under `plugins/<id>/`. Adding a plugin
requires **no edits to core**.

---

## 1. Package layout

```text
plugins/
├── civic-mixer/          # first-party example plugin (roadmap)
│   ├── manifest.json     # plugin metadata + declared tools (contract)
│   ├── adapter.js        # transport: config()/call()/health()/discover() + lifecycle
│   ├── capabilities.js   # optional: capability catalog helper
│   ├── policy.js         # optional: { rules: [fn] } governance
│   ├── schema.js         # optional: { toolId: JSON Schema } input contracts
│   ├── audit.js          # optional: plugin-side audit writer
│   ├── index.js          # optional: install hook (permission wiring, event subscriptions)
│   ├── README.md         # author's on-ramp for that plugin
│   └── tests/            # plugin-local tests (run with the suite)
└── sentinel/             # first-party governance plugin (roadmap)
```

The loader auto-detects `adapter.js`, `policy.js`, `schema.js`, `audit.js`, and
`index.js` when `manifest.entries` is absent.

## 2. Manifest contract (`manifest.json`)

Validated by `validateManifest(manifest, dir)` /
`register(dir)` in `services/plugin-manager/loader.js`. A manifest that fails
validation is rejected with a `plugin contract violation` error listing every
problem; the loader records the failure and continues.

| Field             | Type    | Required | Rule                                                      |
|-------------------|---------|----------|-----------------------------------------------------------|
| `id`              | string  | yes      | `^[a-z0-9][a-z0-9._-]*$`, unique                          |
| `name`            | string  | yes      | non-empty                                                 |
| `version`         | string  | yes      | semver `x.y.z`                                            |
| `apiVersion`      | number  | yes      | must equal `1` (the platform's `API_VERSION`)             |
| `engine`          | string  | yes      | semver range, e.g. `^0.10.0`; checked against the running engine |
| `description`     | string  | yes      | non-empty                                                 |
| `server`          | string  | if entry | server key the adapter is registered under                |
| `fallback`        | boolean | no       | register the adapter as the transport fallback            |
| `enabledByDefault`| boolean | no       | initial lifecycle state (default `true`)                  |
| `capabilities`    | array   | no       | plugin-level capability declarations                      |
| `permissions`     | object  | no       | capability-based permission grants, merged over defaults  |
| `requires`        | array   | no       | plugin ids that must load first; missing → disabled (`missing_dependency`) |
| `optional`        | array   | no       | plugin ids that are nice to have; absence is a warning    |
| `tools`           | array   | no       | declared tools (see below)                                |
| `entries`         | object  | no       | explicit entry-point paths                                |

`apiVersion` is the **contract gate** and `engine` is the **version gate**: a
plugin whose contract or engine range the running platform cannot satisfy is
refused at load, never guessed at.

Each tool entry:

```json
{
  "toolId": "civic.issue.create",
  "server": "civic-mixer",
  "category": "civic",
  "description": "Create a public issue in the civic arena.",
  "version": "1.0.0",
  "capabilities": ["civic", "issues", "write"],
  "operations": ["create"],
  "permissions": ["network"]
}
```

Tool rules: `toolId` is namespaced (`<id>.<name>` recommended); a tool that
collides with a builtin or an already-loaded plugin tool is **skipped, never
shadowed**. `permissions` lists the permission keys the tool requires to
execute — a request is denied with `plugin_permission_denied` before any
adapter is reached if the owning plugin has lost one of them.

## 3. Permission model

Permissions are **capability-based, structured grants**, not a flat set. A
plugin declares its grants in the manifest; they are merged over a fixed
default set. The key space is extensible by design — new keys
(`allowShell`, `allowDocker`, ...) need no loader change.

```js
// platform defaults (services/plugin-manager/permissions.js)
{ network: false, filesystem: false, database: false, workspace: true,
  secrets: false, outboundHttp: false, databaseWrite: false, shell: false,
  git: false, docker: false, memoryRead: false, memoryWrite: false }
```

- `permissions(id)` / `has(id, key)` — query; `grant(id, key)` / `revoke(id, key)` — mutate.
- Enforcement is a platform rule: a request for a tool whose plugin has lost a
  tool-required permission is denied before any adapter is reached.

## 4. Entry-point contracts

### `adapter.js`
Exports either a factory `createAdapter()` returning an adapter object, or the
adapter object itself. Must provide:

```js
config()      -> { endpoint, ... }            // transport configuration
call(req)     -> Promise<Result>              // tool invocation
health()      -> Promise<{ ok, status }>      // health probe (lifecycle onHealth)
discover()    -> Promise<{ ok, tools: [] }>   // capability discovery
```

Optional lifecycle hooks (bound onto the plugin record):

```js
initialize()  -> Promise<{ ok }>              // async startup (onInitialize)
shutdown()    -> Promise<void>                // async teardown (onShutdown)
```

`req = { toolId, payload, requester, id }`.
`Result` is `{ ok: true, data, simulated? }` or `{ ok: false, error, message }`.
`error` is one of `http | rpc | tool | timeout | transport`.

An adapter missing `call` is rejected at load (`plugin entry contract violation`).

### `policy.js`
Exports `{ rules: [fn] }` or a single rule function. Each rule receives the
request (`{ toolId, payload, requester, workspaceId }`) and may return
`{ allowed: false, reason }` or `null`. Rules are enforced by the platform
before any adapter is reached; MCP and every future transport surface the same
gate.

### `schema.js`
Exports `{ toolId: JSONSchema }` for each declared tool. Keys must match
declared tools (unknown keys are rejected at load).

### `audit.js`
Optional. Exports a function `(event, actor, outcome, meta)` or
`{ write(...) }`. Wired onto the plugin record as `record.audit`.

### `index.js`
Optional **install hook**: exports `(ctx) => any`. `ctx` exposes the scoped
plugin API — `config()`, `subscribe(name, handler)`, `emit(name, payload)`,
`log(message)`. A plugin uses this to subscribe to domain events and, in
future, to declare permissions. The hook runs after validation and before the
record enters the registry.

## 5. Lifecycle

```text
loaded ──► initialize() ──► healthy
                │                │
                ▼                ▼
             degraded         disabled ◄── disable(id)
                                   │
                                   ▼ enable(id)
                               healthy / degraded
```

- `loadPlugins(dir)` — scan a directory, `register` every subdirectory with a
  `manifest.json`, initialize each, then run dependency resolution. Returns
  `{ base, loaded[], failed[], deps }` (`deps`: `{ ok[], blocked[], warnings[] }`).
  Defaults to the repo `plugins/` directory. Idempotent.
- `register(dir)` — validate manifest + entry points, run the install hook,
  register tools, adapter, policy rules, and permissions. Throws on violation.
- `initialize(id)` / `healthCheck(id)` — drive state between loaded/healthy/degraded.
- `enable(id)` / `disable(id)` — flip availability. Disabling swaps the
  plugin's adapter for a **denial adapter**: every tool it owns returns
  `{ ok: false, error: 'plugin_disabled' }` before any transport is reached.
- `shutdown(id)` — async teardown; never throws into the platform.
- `status(id)` / `isEnabled(id)` — query lifecycle state. States:
  `loaded | healthy | degraded | disabled | failed`.
- `discover()` — list loaded plugins with metadata, tools, and state.
- `capabilities()` / `tools()` — union of the capability and tool surface.

## 6. Dependency resolution

`requires` are resolved after loading: a plugin whose required plugin id is not
present is disabled with `missing_dependency: <id>` recorded as its reason.
`optional` dependencies that are missing produce a warning, never a block.

## 7. Event hooks

The platform owns a small event bus
(`services/plugin-manager/events.js`). Core emits domain events; plugins
subscribe through the scoped install-hook API — **nothing is required to
listen and no emitter depends on a subscriber**.

```js
plugin.subscribe('mission.started', ({ missionId }) => { ... });
plugin.emit('payment.completed', { amount: 100 });  // only for core/own flows
```

Registered event names: `mission.started`, `mission.finished`, `mission.failed`,
`workspace.created`, `workspace.deleted`, `lead.created`, `payment.completed`,
`payment.failed`, `capability.executed`, `sentinel.scan.completed`.

## 8. Isolation & safety guarantees

- **No core imports.** A plugin must not `require` anything under `services/`
  or `bot/`. Plugins are leaf packages.
- **Pure at load.** Requiring a plugin must not do network I/O, mutate the
  environment, or start timers.
- **Failure isolation.** `loadPlugins` wraps each plugin in its own try/catch.
  A manifest violation, entry violation, or throw at load produces a recorded
  `failed[]` entry and never aborts the scan or affects other plugins.
- **Disabled = denied.** The denial adapter is the only path a disabled plugin
  exposes.
- **No shadowing.** Plugin tools can never replace builtin or sibling tools.

## 9. Configuration contract

Core reserves the `MCP_*` environment namespace. Plugins read their own
configuration from environment variables (recommended namespace
`PLUGIN_<ID>_*`, uppercase) inside `config()`. Core passes no config into
plugins; the loader instantiates a factory with no arguments.

## 10. Compatibility promise

- Contract changes are **additive-only** within an `apiVersion`.
- A breaking change bumps `apiVersion`; the loader rejects unsupported
  manifests instead of guessing.
- A plugin pins an `engine` range it was built against; the loader refuses a
  plugin the running engine cannot satisfy.
- Public facade (`services/mcp`): `loadPlugins, registerPlugin, validatePlugin,
  enablePlugin, disablePlugin, discoverPlugins, pluginCapabilities,
  pluginStatus, isPluginEnabled, grantPluginPermission, revokePluginPermission,
  hasPluginPermission, pluginPermissions`.
- Generic platform (`services/plugin-manager`): `loadPlugins, register,
  validateManifest, enable, disable, isEnabled, status, discover, capabilities,
  tools, transportAdapter, permissions.{grant,revoke,has,list,check},
  healthCheck, shutdown, subscribe, emit`.

## 11. First-party roadmap

- **civic-mixer** — transport adapter (fallback for the builtin gateway tools)
  plus civic capabilities: `civic.identity.lookup`, `civic.vote.create`,
  `civic.vote.cast`, `civic.issue.create`, `civic.issue.list`.
- **sentinel** — governance capabilities: `sentinel.scan`, `sentinel.audit`,
  `sentinel.policyCheck`, each backed by policy + audit entries.

Future candidates: GitHub, Slack, Notion, Jira, Google Drive, Salesforce, SAP,
Oracle — each a leaf plugin under this contract, none touching core.
