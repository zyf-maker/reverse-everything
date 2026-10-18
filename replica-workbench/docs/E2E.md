# End-to-end verification

This procedure compares an independent local rebuild with the authorized 2048 fixture. It starts isolated loopback HTTP servers and two headless Chrome/Edge instances, runs a deterministic browser scenario, then stores fresh evidence and a Markdown report in the case directory.

## Requirements

- Python 3.10 or later
- Node.js 18 or later and npm
- Chrome, Chromium, or Microsoft Edge installed locally
- The authorized fixture at `target-2048/` and its case file

Install the workbench and runtime dependencies from PowerShell:

```powershell
Set-Location .\replica-workbench
.\install.ps1
Set-Location ..
```

The install script installs Python and Node dependencies. It does not install a browser; `verify` reports `DEGRADED` when no supported browser is available.

## Verify the 2048 rebuild

Run from the repository root:

```powershell
$env:PYTHONPATH = (Join-Path (Get-Location) 'replica-workbench/src')
python -m replica_platform.cli verify `
  --case replica-workbench/work/e2e-2048-20261017-final `
  --rebuild replica-workbench/work/own-2048-platform-rebuild `
  --scenario replica-workbench/scenarios/2048-comprehensive.json
```

The scenario checks initial state; left, up, down and right merges; a no-op move; winning, continuing, losing and retrying; score persistence; reload restoration; and restart. A scaffold or failed check returns `DEGRADED` with a nonzero exit code. A passing run records a unique run ID, per-check results, fresh evidence files, and `report/report.md` under the case.

## Acceptance limits

`READY` means the declared authorization scope passed, the target static scan ran, the rebuild manifest and entry point were present, no identical source files were found, and every checkpoint in this deterministic browser scenario matched on both pages without browser exceptions. It does not establish exhaustive behavioral coverage, pixel-level parity, accessibility conformance, mobile/touch parity, cross-browser parity, independent authorship, or legal clearance. Add scenarios and separate reviews for those claims.

Direct `capture` and `replay` calls require the exact numeric-loopback CDP endpoint to be declared with `--cdp-endpoint` when creating the case. They also require exact page URLs whose origins are allowlisted by the case; the runtime blocks page requests outside those origins. The `verify` command starts and owns its isolated browser processes, so those ephemeral CDP ports and local page origins are bounded by the verifier rather than added to external endpoint allowlists.

The checked-in fixture is the MIT-licensed `gabrielecirulli/2048` project at commit `478b6ec346e3787f589e4af751378d06ded4cbbc`. Keep its license and attribution with the fixture. The rebuild's own README documents its original implementation and source boundary.
