# Replica Workbench

Replica Workbench is a local toolset for authorized behavioral reconstruction. It combines a Python case/evidence CLI with the repository's JavaScript static analyzer and Chrome DevTools Protocol runtime, then verifies an independent implementation through deterministic browser replay.

## Install

Requirements: Python 3.10+, Node.js 18+, npm, and a local Chrome, Chromium, or Edge browser for browser verification. From PowerShell:

```powershell
.\install.ps1
```

The installer creates `.venv`, installs the Python package, and installs the runtime's pinned npm dependency tree. It does not install a browser or container engine. `doctor` reports optional capabilities; `verify` needs a supported local browser.

On Linux or macOS, run `bash ./install.sh` from this directory. Browser
verification uses an already installed Chrome, Chromium, or Edge; installation
does not download a browser or container engine.

## Workflow

1. Create a case for the target. New cases remain `pending` until explicit authorization and an expiry are recorded; a pending case cannot run scoped analysis.
2. Run the built-in static inventory and authorized local browser capture.
3. Record observations and write an independent rebuild in a separate directory.
4. Define a deterministic scenario for the behaviors to compare.
5. Run fresh verification and inspect its evidence and report.

The checked-in 2048 example can be verified from the repository root:

```powershell
$env:PYTHONPATH = (Join-Path (Get-Location) 'replica-workbench/src')
# Add --authorize and --authorization-expires-at only after confirming the target scope is authorized.
python -m replica_platform.cli init --name sample --target .\target --type web --basis "documented authorization" `
  --authorize --authorization-expires-at 2026-10-18T00:00:00Z --cdp-endpoint http://127.0.0.1:9227
python -m replica_platform.cli verify `
  --case replica-workbench/work/e2e-2048-20261017-final `
  --rebuild replica-workbench/work/own-2048-platform-rebuild `
  --scenario replica-workbench/scenarios/2048-comprehensive.json
```

The generated evidence lives in `work/<case>/evidence/`; the report is `work/<case>/report/report.md`. See [docs/E2E.md](docs/E2E.md) for the complete procedure and the exact meaning of `READY`.

## Agent integration

Any agent runtime can drive the same operations without a product-specific
connector. Send one JSON request to `replica agent`, or newline-delimited JSON
with `replica agent --jsonl`; the versioned protocol and request examples are
documented in [docs/AGENT_PROTOCOL.md](docs/AGENT_PROTOCOL.md). Responses are
machine-readable and preserve the case authorization, path allowlists, and
loopback endpoint checks used by the native CLI.

Run `node verification/agent-protocol-smoke.mjs` from the repository root to
test the interface from an independent Node.js process without an agent SDK.

## Components

- `src/replica_platform`: case lifecycle, scope checks, adapters, verification and reports.
- `../own-reverse-platform/static-analyzer`: original JavaScript structural inventory tool.
- `../own-reverse-platform/runtime`: original CDP capture, comparison and bounded replay tool. It uses the open `ws` package for its WebSocket transport and a locally installed browser for the browser engine.
- `scenarios/`: deterministic action and expected-state definitions.
- `work/`: authorized target fixtures, generated cases and independent rebuilds.

Direct CDP capture/replay requires each exact numeric-loopback endpoint to be recorded with `--cdp-endpoint`; a loopback host alone is not an allowlist. `verify` launches isolated browser processes itself and validates their generated loopback endpoints internally. Authorization entries are operator records, not proof of legal authority; reports are editable files, not tamper-proof audit records.

The project is a source-code bundle, not a self-contained browser distribution: Python, Node/npm and a supported browser remain environment prerequisites. It does not bundle or rebrand those products.

## Scope

Only analyze targets covered by the case's declared authorization. `READY` certifies the checks that actually ran and the selected scenario checkpoints; it is not proof of exhaustive parity, authorship, accessibility, cross-browser coverage, or legal clearance. Preserve each target's license and attribution, and assess rights separately before distributing a reconstruction.

## Agent plugin

The sibling `../replica-mcp-plugin` package exposes this workbench as a local
stdio MCP server for Codex, Claude Code, and other MCP-capable agent hosts. Run
its installer after downloading the complete repository, then register its
`mcp.json` with the host. The plugin uses this workbench's existing agent
protocol and authorization checks; it does not grant authorization on behalf of
an operator or bundle a browser.
