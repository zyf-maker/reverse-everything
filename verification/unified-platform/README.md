# Unified Replica Platform Contract Tests

This directory is a dependency-free contract fixture for the complete Replica
platform rewrite. It tests the platform as one execution system rather than as
a router around the old Workbench, REA, or PentAGI products.

The contract has five durable records:

- `case`: target identity, authorization, and lifecycle.
- `scope`: actions, filesystem targets, origins, and network policy.
- `evidence`: observed, inferred, tested, or rejected facts with provenance.
- `run`: one bounded execution and its input/output evidence links.
- `report`: a verdict derived from completed runs and coverage limits.

The MCP surface is intentionally small and uses the same records for every
target class (web, JavaScript, desktop, native, mobile, and security tests):

`replica_capabilities`, `replica_doctor`, `replica_case_create`,
`replica_case_authorize`, `replica_case_get`, `replica_scope_check`,
`replica_evidence_append`, `replica_run_start`, `replica_run_get`, and
`replica_report_generate`.

Run the mock-only contract test from the repository root:

```powershell
node verification/unified-platform/contract-test.mjs
```

The test does not contact a network, launch a browser, execute a target, or
require REA/PentAGI/Workbench installations. It starts
`mock-mcp-server.mjs`, performs the full lifecycle, and checks the authorization
and provenance invariants. To run the same assertions against the rewritten
MCP server, set `REPLICA_UNIFIED_COMMAND_JSON` to a JSON array containing the
executable and arguments, for example:

```powershell
$env:REPLICA_UNIFIED_COMMAND_JSON = '["node","replica-core/mcp/index.mjs"]'
node verification/unified-platform/contract-test.mjs
```

The real server is expected to expose MCP over stdio using the MCP
newline-delimited JSON binding. The mock is deliberately strict so that a passing result means the
MCP transport and the core lifecycle agree on the same contract.

Fixtures are synthetic and contain no third-party target bytes. They are safe
to use in CI and in offline packaging checks.
