# Replica Workbench MCP Plugin

Replica Workbench is exposed as a local Model Context Protocol (MCP) server for Codex, Claude Code, and other MCP-capable agent hosts.

## Which package should users download?

The tested release is `replica-workbench-mcp-win-x64-v0.1.1.zip` for Windows x64. It contains the MCP server, Node.js, Python, unbranded Chromium, npm dependencies, Workbench, static analyzer, CDP runtime, host manifests, provenance, and bundled runtime license files. Check the adjacent `.sha256` file before extracting.

Native runtimes are platform and architecture specific. The repository includes a native `build.sh` for future macOS/Linux builds, but those packages are not part of this tested release.

After extraction, the package does not require a separate Node.js, Python, npm, pip package, or Chrome/Chromium installation. The Agent host remains a prerequisite: Codex, Claude Code, DSH, or another MCP host must be installed and must support local stdio MCP servers.

## Register with a host

The archive contains two host manifests:

- `mcp.json` is the portable local stdio manifest using `${PLUGIN_ROOT}`.
- `.mcp.json` and `.claude-plugin/plugin.json` are the Claude Code plugin files using `${CLAUDE_PLUGIN_ROOT}`.

For a host with a plugin installer, install the extracted directory as a plugin. For a CLI host, run the bundled registration script from the extracted directory. The PowerShell switch is `-Agent`:

```powershell
.\install-host.ps1 -Agent codex
.\install-host.ps1 -Agent claude
```

On macOS/Linux:

```bash
./install-host.sh codex
./install-host.sh claude
```

The scripts call the host's own CLI and do not download packages. Restart the host and inspect its MCP server list after registration. If a host does not expand its plugin-root placeholder, replace `${PLUGIN_ROOT}` or `${CLAUDE_PLUGIN_ROOT}` in the matching manifest with the extracted directory's absolute path.

Codex CLI form:

```text
codex mcp add replica-workbench -- /absolute/path/replica-workbench-mcp-win-x64-v0.1.1/runtime/node.exe /absolute/path/replica-workbench-mcp-win-x64-v0.1.1/server/index.mjs
```

Claude Code form:

```text
claude mcp add --scope user --transport stdio replica-workbench -- /absolute/path/replica-workbench-mcp-win-x64-v0.1.1/runtime/node.exe /absolute/path/replica-workbench-mcp-win-x64-v0.1.1/server/index.mjs
```

DSH and other MCP hosts can use the same structured stdio entry: executable, argument array, working directory, and optional environment mapping. The host's own plugin manifest rules still apply.

## What the installed plugin can do

An agent can list capabilities, create and inspect authorized cases, run static inventories, collect bounded CDP browser evidence, append evidence, create an independent rebuild scaffold, replay deterministic scenarios, run verification, and generate Markdown reports.

The native Workbench remains the security boundary. An operator must authorize a case before scoped analysis or capture can run. Case paths and browser endpoints are allowlisted, and the agent cannot self-grant authorization. The plugin does not provide arbitrary shell execution, authorization bypass, or remote browser access.

## Verify after installation

From the extracted directory:

```powershell
& .\runtime\node.exe .\server\doctor.mjs
```

The command must print JSON with `"ready": true` and exit with code `0`. It checks the bundled Workbench and Python/Node/browser path used by the MCP bridge. A host may still show a separate approval or trust state after the local doctor passes.

## Build and release

The source checkout is for developers. It requires the development runtimes and the sibling `replica-workbench/` and `own-reverse-platform/` directories. The Windows build pins and verifies unbranded ungoogled Chromium `155.0.8059.79-1.1` and the upstream archive SHA-256 in `browser-lock.json`:

```powershell
cd replica-mcp-plugin
.\build.ps1 -Clean
```

This produces a versioned directory, a ZIP archive, and a SHA-256 file under `dist/`. Set `-PythonHome` only when the portable Python input is not discoverable; the pinned browser archive is downloaded or read from `verification/ungoogled-chromium-155.0.8059.79-1.1-win64.zip`.

The source-mode installer remains available for contributors, but it expects the development environment and does not create a self-contained release:

```powershell
.\install.ps1
npm run doctor
```

## Release contract

The release package is self-contained for its declared operating system and CPU architecture. It is “download, extract, register with an installed Agent host, and use.” It is not a standalone Agent application and cannot run without a host that launches MCP servers.

Version 0.1.1 replaces the earlier snapshot with an unbranded ungoogled Chromium distribution. The build exports all 770 components from this exact browser's generated `chrome://credits/` into offline HTML and plain text under `licenses/`, retains the original export, and records content hashes and the component inventory. Empty, sample, missing-license, or unexpected component counts stop packaging. Root Chromium and ungoogled Chromium license texts and pinned source/build references are included. The adjacent Chromium source companion and patch archives accompany the GitHub release; see `licenses/SOURCE_CODE.md`.

This fixes the earlier missing-notice defect. The generated inventory describes the upstream browser build; it is not an independent legal certification. Preserve the notices and corresponding source companions when redistributing.

The macOS/Linux build is not validated by this Windows release and requires `BROWSER_LOCK` for its own verified browser version and exact generated component count. It also rejects missing runtime licenses.
