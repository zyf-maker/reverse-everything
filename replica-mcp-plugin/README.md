# Replica MCP Plugin

This package exposes Replica as a local MCP server for evidence-driven
reverse engineering, behavior reconstruction, and independent verification.
It provides one consistent case model, authorization boundary, evidence graph,
execution runtime, and reporting workflow.

The protocol is `replica-unified/v1`. The package includes the execution core,
MCP server, browser runtime integration, verification pipeline, and release
metadata in one distribution. Case state, authorization, evidence links, runs,
and reports share one lifecycle.

## Canonical MCP tools

- `replica_capabilities`, `replica_doctor`
- `replica_case_create`, `replica_case_authorize`, `replica_case_get`
- `replica_scope_check`, `replica_scope_define`, `replica_scope_get`
- `replica_observe`, `replica_analyze`, `replica_action`
- `replica_evidence_append`, `replica_evidence_add`, `replica_scenario_define`
- `replica_run_start`, `replica_run_get`, `replica_run`, `replica_verify`, `replica_report_generate`, `replica_report`

The old `replica_init`, `replica_status`, `replica_capture`,
`replica_add_evidence`, `replica_rebuild`, and `replica_replay` names remain
as compatibility aliases. They map into the canonical operations and do not
create a separate backend or security model.

## Core stdio contract

The standalone core CLI is also available as `node core/bin/replica-core.mjs
--jsonl`. It reads one JSON object per line and writes one JSON object per line:

```json
{
  "schema": "replica-unified/v1",
  "request_id": "unique-request-id",
  "operation": "case.create",
  "params": {"name": "example", "target": "./target", "basis": "written authorization"}
}
```

The response includes `schema`, `request_id`, `operation`, `ok`, `status`, and
either `result` or `error`. A packaged MCP server imports `core/src/index.mjs`;
development can point at another checkout with `REPLICA_CORE_ROOT`.

## Register with a host

The npm distribution is the lightweight cross-platform path. It requires
Node.js 20+ and downloads the JavaScript MCP dependencies through npm; Python
and Chromium are optional for capabilities that need them.

```powershell
npx -y replica-unified-mcp
codex mcp add replica-unified -- npx -y replica-unified-mcp
```

The repository includes `mcp.npm.json` for hosts that accept a portable npm
MCP manifest.

The Windows x64 release is self-contained for Node, Python, Chromium, the
Workbench compatibility runtime, and MCP dependencies. It still requires an
MCP host such as Codex or Claude Code.

```powershell
codex mcp add replica-unified -- C:\path\to\package\runtime\node.exe C:\path\to\package\server\index.mjs
```

The portable `mcp.json` and Claude `.mcp.json` manifests remain available for
hosts that install local plugins. Restart the host after registration.

## Security boundary

`replica_case_create` always creates a pending case. An operator must grant
authorization through the native case workflow before scoped observation,
analysis, replay, or verification can run. The MCP server does not expose
arbitrary shell execution, authorization bypass, or unrestricted network
access.

## Verify locally

```powershell
npm test
node server/doctor.mjs
```

The release builder validates the bundled runtime and generates the Chromium
third-party notices from the exact binary included in the release. A release
is rejected when the notice set is incomplete.
