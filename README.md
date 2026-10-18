# Reverse Everything

Reverse Everything is an evidence-driven platform for understanding software,
reconstructing behavior, and verifying bounded equivalence through one MCP
protocol. The repository contains the unified execution core, MCP server,
browser/CDP runtime, analysis tools, verification fixtures, and release
builders.

## MCP with Codex

The public GitHub release exposes the `replica-unified/v1` stdio protocol and
can be launched directly with `npx`. No npm account or npm package claim is
needed for this installation path.

```powershell
codex mcp add replica-unified -- npx -y https://github.com/zyf-maker/reverse-everything/releases/download/v0.2.1/replica-unified-mcp-0.2.1.tgz
```

The npx path uses the public GitHub release tarball and requires Node.js 20 or
newer. The source checkout can also be used immediately:

```powershell
cd replica-mcp-plugin
npm ci
codex mcp add replica-unified -- node "$PWD/server/index.mjs"
```

The shorter `npx -y replica-unified-mcp` command is an optional future npm
distribution. The GitHub release tarball above is the supported public path and
does not depend on npm account registration.

The Windows self-contained release includes its own Node, Python, Chromium,
and MCP dependencies. Run `replica-mcp-plugin/install-host.ps1 -Agent codex`
from an extracted release to register it.

After registration, restart Codex and call `replica_capabilities` followed by
`replica_doctor` to inspect the available runtime capabilities.

## Platform model

All operations share one case, authorization, scope, evidence, run, and report
model. The core can run JavaScript analysis, reconstruction planning,
deterministic replay, verification, reporting, scenario management, and worker
coordination without a separate provider process. Browser/CDP, native, mobile,
and active security capabilities report their real environment state.

The MCP server provides canonical operations such as
`replica_case_create`, `replica_case_authorize`, `replica_observe`,
`replica_analyze`, `replica_run_start`, `replica_verify`, and
`replica_report_generate`. Older tool names remain aliases for compatibility.

## Verification

```powershell
cd replica-core
npm test
cd ..\replica-mcp-plugin
npm test
cd ..
$env:REPLICA_UNIFIED_COMMAND_JSON='["node","replica-mcp-plugin/server/index.mjs"]'
node verification/unified-platform/contract-test.mjs
```

Release builds validate the exact bundled Chromium notices and refuse an
incomplete notice set. See [`replica-mcp-plugin/README.md`](replica-mcp-plugin/README.md)
for package details and [`docs/unified-platform-architecture.md`](docs/unified-platform-architecture.md)
for the protocol model.
