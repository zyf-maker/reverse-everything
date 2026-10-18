# Reverse Everything

Reverse Everything is an evidence-driven platform for understanding software,
reconstructing behavior, and verifying bounded equivalence through one MCP
protocol. The repository contains the unified execution core, MCP server,
browser/CDP runtime, analysis tools, verification fixtures, and release
builders.

## MCP with Codex

The package entry point is `replica-unified-mcp` and exposes the
`replica-unified/v1` stdio protocol.

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

The short command `npx -y replica-unified-mcp` will work after the package's
first npm staged release is created and approved by its npm maintainer. Later
releases use GitHub Actions Trusted Publishing without a saved npm token.

To claim the package once, a maintainer with npm publish permission runs from
`replica-mcp-plugin`:

```powershell
npx -y npm@11.5.1 stage publish --access public --registry=https://registry.npmjs.org
```

The maintainer then approves the staged `0.2.1` version in npm and adds a
GitHub Actions trusted publisher for `zyf-maker/reverse-everything`, workflow
`publish-npm.yml`. This one-time registry ownership and approval cannot be
performed without the npm maintainer's account and 2FA. After that, publish a
new package version by running the `Publish npm package` workflow in GitHub.

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
