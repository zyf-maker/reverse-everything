# Agent Protocol

Replica Workbench exposes a small, platform-neutral JSON protocol. An agent
does not need a specific host application: a process, orchestration service,
or human operator can invoke the same protocol over stdin/stdout.

## Transport

Run one request:

```powershell
Set-Location .\replica-workbench
$request = '{"schema":"replica-agent/v1","request_id":"r-1","operation":"capabilities","params":{}}'
$request | .\run.ps1 agent
```

Run newline-delimited JSON (JSONL), preserving one response per non-empty input
line:

```powershell
Get-Content .\requests.jsonl | .\run.ps1 agent --jsonl
```

The same line protocol is available on POSIX shells:

```sh
cd replica-workbench
printf '%s\n' '{"schema":"replica-agent/v1","request_id":"r-1","operation":"capabilities","params":{}}' | ./run.sh agent
cat requests.jsonl | ./run.sh agent --jsonl
```

Run the launcher with the workbench directory as the process working directory.
Relative case paths such as `work/example` are resolved from that directory.

An agent written in any language can send the same UTF-8 JSON bytes to the
process stdin and parse one JSON response per line from stdout. No agent SDK,
connector, or host-specific protocol is required.

Responses are JSON objects with `schema`, `request_id`, `operation`, `ok`, and
`status`. Successful requests contain `result`; failed requests contain an
`error` object with a type and message. A failed request exits with code `1`.

## Request shape

```json
{
  "schema": "replica-agent/v1",
  "request_id": "verify-1",
  "operation": "status",
  "params": {"case": "work/example"}
}
```

The `capabilities` operation returns the current operation list and transport
metadata. Operations are named rather than arbitrary shell commands:

`doctor`, `init`, `status`, `evidence.add`, `analyze`, `capture`, `rebuild`,
`replay`, `verify`, and `report`.

## Operation parameters

All parameters are in `params`; `*` marks required values. Paths for cases and
rebuild outputs must be under `work/`. Scenario paths must be under
`scenarios/` or `work/`.

| Operation | Parameters |
| --- | --- |
| `capabilities` | none |
| `doctor` | `cdp` (optional endpoint), `require_docker` (optional boolean) |
| `init` | `name*`, `target*`, `basis*`; `type` (`web`, `javascript`, `desktop`, `mobile`, `binary`), `version`, `profile` (`lite`, `standard`, `full`), `cdp_endpoints` (array) optional. Always creates a pending case. |
| `status`, `report` | `case*` |
| `evidence.add` | `case*`, `kind*` (`observation`, `inference`, `test`, `network`, `visual`, `limitation`), `title*`, `data*` (any JSON value), `source` optional |
| `analyze` | `case*`, `target*`, `engine` (`inventory` or `own-static`) optional |
| `capture` | `case*`; with `endpoint*`: `page_url*`, `navigate`, `duration` optional. Without `endpoint`: `title*`, `data*`, `kind` optional. |
| `rebuild` | `case*`, `output*` (new directory under `work/`) |
| `replay` | `case*`, `reference_endpoint*`, `replica_endpoint*`, `reference_page_url*`, `replica_page_url*`, `scenario*` |
| `verify` | `case*`, `rebuild*`, `scenario*` |

`init` cannot grant authorization. If an agent created a pending case, the
operator must create a separate authorized case through the native CLI; there
is currently no operation to promote an existing pending case. Confirm the
target and permitted actions first. For example, from the repository root in
PowerShell:

```powershell
Set-Location .\replica-workbench
$env:PYTHONPATH = (Join-Path (Get-Location) 'src')
$expiry = (Get-Date).ToUniversalTime().AddHours(2).ToString("yyyy-MM-ddTHH:mm:ssZ")
python -m replica_platform.cli init --name approved-target --target ..\target-2048 `
  --type web --basis "operator-confirmed scope" --authorize --authorization-expires-at $expiry
```

The expiry must match the approved work window. Add only exact numeric-loopback
CDP endpoints with `--cdp-endpoint` only when direct capture or replay needs
them. This creates `replica-workbench/work/approved-target`; pass `work/approved-target`
in agent requests.

## Security and portability

The protocol calls the same case and scope validators as the native CLI. Cases
must live under the workbench `work/` directory, a pending or expired case is
rejected for scoped operations, local targets must be inside the case path
allowlist, and browser endpoints must be exact numeric loopback entries. Agent
requests cannot grant authorization or write rebuild scaffolds outside `work/`.
The protocol does not expand network access or execute an agent-supplied shell
command. Runtime capture and replay require an exact page URL; allowed origins
come from the already validated case scope.

Agents should treat `READY` as the bounded result of the selected verification
scenario. It does not imply exhaustive parity, cross-browser coverage,
authorship, or legal clearance. The protocol is intentionally independent of
any particular agent, model, orchestration product, or connector.
