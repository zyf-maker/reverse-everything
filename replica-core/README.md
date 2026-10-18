# Replica Core

`replica-core` is the unified execution kernel for the reconstruction platform. It is a new domain model and in-process capability system, not a router over separate products. The kernel owns case lifecycle, authorization, scope checks, observations, hash-linked evidence, findings, actions, scenarios, runs, verification and reports.

The public protocol is `replica-unified/v1` and is available over newline-delimited JSON:

```powershell
node .\bin\replica-core.mjs --jsonl
```

Example request:

```json
{"schema":"replica-unified/v1","request_id":"1","operation":"capabilities","params":{}}
```

The capability registry contains internal modules for JavaScript/static analysis, browser runtime, rebuild planning, deterministic replay, contract verification, reporting, native analysis planning, mobile analysis planning, bounded security validation, scenario planning and worker orchestration. Optional toolchains report `degraded` through `capabilities` and `doctor`; the core still owns the data model and execution policy.

Authorization is explicit and operator-attested. A granted authorization requires a basis, issuer, operator attestation and future expiry. Every run stores a policy snapshot, and every evidence item links to the previous evidence hash. Reports state the bounded claim scope and only become `READY` when recorded verification checkpoints pass and the evidence chain is intact.

Run tests with `npm test`.
