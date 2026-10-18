# Unified Replica Platform Migration

The old `replica-workbench-mcp` v0.1.x release is a Workbench-first preview.
It contains the Python Workbench, a JavaScript analyzer, a CDP runtime, and a
Chromium snapshot. It does **not** constitute the complete rewrite requested
for the combined reverse-skill, REA, and PentAGI capability set. In particular,
the old package has separate case formats and separate provider boundaries.
Do not describe that release as the unified platform.

The rewrite uses one execution kernel and one durable evidence graph. Static
analysis, browser/runtime observation, native/mobile inspection, rebuild,
replay, verification, and authorized security checks all write the same five
record types:

| Record | Purpose |
| --- | --- |
| `case` | Target identity, lifecycle, and operator authorization. |
| `scope` | Actions, path/origin allowlists, and network policy. |
| `evidence` | A content-addressed fact with state, authority, provenance, and limits. |
| `run` | A bounded phase execution with policy snapshot and evidence links. |
| `report` | A coverage-aware verdict derived from runs and evidence. |

The record schemas and a mock-only end-to-end contract test live under
`verification/unified-platform`. Run them offline with:

```powershell
node verification/unified-platform/contract-test.mjs
```

The test covers MCP `initialize`, `tools/list`, and `tools/call`, pending-case
denial, operator-attestation enforcement, scope checks, evidence provenance,
run policy snapshots, and report generation. A rewritten server can be tested
without changing the assertions by setting `REPLICA_UNIFIED_COMMAND_JSON` to a
JSON array containing its executable and arguments.

## Migrating existing cases

Existing Workbench cases under `replica-workbench/work/*` remain readable for
historical verification. They are not silently treated as unified cases.
Migration must create a new `replica-unified/case/v1` record and explicitly map:

1. the original target to `target.kind` and `target.locator`;
2. the old action list and endpoint/path checks to `scope.actions`,
   `scope.targets`, and `scope.network`;
3. each observation or static result to a content-addressed `evidence` record;
4. each replay or verification invocation to a `run` with the captured policy;
5. the previous report to a new report with its original limitations preserved.

Pending or expired authorizations never migrate to `granted`. An operator must
attest to the new case explicitly. A legacy `READY` result is historical
evidence; it is not a unified-platform verdict until a new run is executed.

The same rule applies to REA and PentAGI exports. Their findings can be
imported as evidence with a source/provider field, but provider output cannot
change the unified authorization, scope, or verdict rules.

## Package contract

The release artifact is a host-launched MCP package, not a standalone agent.
The tested Windows x64 package must contain:

```text
server/index.mjs                 MCP stdio entry point
runtime/node.exe                 pinned Node runtime
runtime/python/                  pinned Python runtime, if used by a provider
runtime/chromium/                pinned browser for isolated verification
replica-core/                    unified kernel and schema migrations
providers/                       built-in adapters and capability manifests
licenses/                        complete notices and source references
manifest.json                    package, schema, and runtime hashes
mcp.json                         portable host registration
```

The package must pass the offline contract test, MCP handshake smoke test, and
the release notice verifier before it is tagged. Chromium credits must be
exported from the exact binary included in the archive; sample or missing
credits fail packaging. Every bundled runtime needs a license entry and a
corresponding source/provenance reference.

The machine-checkable package shape is illustrated by
`verification/unified-platform/package-manifest.example.json`. After
extraction, run `node verification/unified-platform/package-contract-test.mjs
<directory>` before registering the package with Codex. This check intentionally
fails against the legacy v0.1.x archive because that archive has no unified
kernel or `replica-unified/package/v1` manifest.

The unified kernel has no runtime dependency on an installed REA or PentAGI
process. Optional provider manifests may advertise additional engines, but the
core remains usable and testable when those providers are absent. A package
that requires an external provider to create a case, append evidence, or emit a
report is incomplete and must be labeled as a development profile.

## Compatibility and versioning

The public contract identifier is `replica-unified/v1`. MCP tool names are
stable within that version. New record fields are additive; changing
authorization semantics, evidence authority values, run status values, or
report verdict meaning requires a new schema version and a migration note.

The legacy `replica_*` Workbench tools may remain as a compatibility shim during
migration, but they must translate into unified records before execution. They
must not maintain a second evidence store or a second authorization model.
