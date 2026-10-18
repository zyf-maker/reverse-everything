# Reverse Everything Architecture

This document defines the platform architecture. Reverse Everything uses one
domain model, one authorization boundary, one evidence format, and one
execution protocol across its analysis and verification capabilities.

## Core model

Every operation belongs to a `replica-unified/v1` case:

- `Case` identifies the target, version, owner, and lifecycle.
- `Scope` records allowed paths, origins, endpoints, actions, and expiry.
- `Observation` records a raw measurement and its environment.
- `Evidence` links observations to sources, hashes, limitations, and confidence.
- `Finding` records an interpreted claim and the evidence supporting it.
- `Action` records an allowed analysis, capture, reconstruction, or security step.
- `Scenario` describes deterministic input and expected checkpoints.
- `Run` records execution state, events, outputs, and failures.
- `Verification` records bounded parity and security results.
- `Report` renders the complete provenance graph for a case.

The model must preserve raw provider output while exposing a normalized result.
An unavailable capability is a typed result with a reason and remediation, not
an implicit success or an external tool exception.

## Internal execution domains

The platform owns these domains behind one capability registry:

- source and bundle structure analysis;
- browser and CDP observation;
- process, desktop, native, and mobile inspection;
- controlled action execution and replay;
- independent reconstruction and parity verification;
- bounded security checks and worker isolation;
- evidence normalization, provenance, and reporting.

Each domain can use an implementation provider, but providers are internal
modules behind the platform contract. The MCP layer does not expose provider
identity as the primary user workflow.

## Host contract

The MCP server exposes the unified operations and keeps compatibility aliases
for the previous `replica_*` tools during migration. The canonical operations
are case creation/authorization, scope checking, observation, analysis,
action execution, scenario/run management, evidence, verification, reporting,
capabilities, and doctor.

## Completion criteria

The rewrite is complete only when:

1. the core protocol works without importing the old Workbench protocol;
2. every canonical object has schema validation and round-trip tests;
3. browser/JavaScript reconstruction has a real end-to-end run;
4. native/mobile/security domains expose honest capability states and tests;
5. MCP initialize, discovery, calls, errors, and shutdown are tested;
6. the package manifest states which runtimes are bundled and which are optional;
7. reports distinguish observed, inferred, unavailable, and unverified claims.

Passing the old 2048 scenario alone is not sufficient evidence for this
rewrite.
