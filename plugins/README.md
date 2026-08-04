# TEOS DealMaker — Plugin Platform

`plugins/` is the home of TEOS DealMaker plugins.

Each subdirectory is an isolated plugin package that implements the TEOS
DealMaker plugin platform contract. The runtime (loader, lifecycle,
permissions, dependency resolution, events) is a generic, transport-agnostic
platform in `services/plugin-manager/`; the machine-readable manifest schema is
`services/plugin-manager/manifest.schema.json`; the human spec is
`docs/PLUGIN_CONTRACT.md`.

Plugins load automatically when the MCP facade is required. A plugin that
violates the contract is skipped with a recorded failure — it can never take
down core or its siblings.

First-party plugins (civic-mixer, sentinel) land in staged commits; each is a
leaf package with its own manifest, adapter, and tests.
