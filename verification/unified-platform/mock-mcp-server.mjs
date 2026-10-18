import crypto from 'node:crypto';

const tools = [
  'replica_capabilities', 'replica_doctor', 'replica_case_create',
  'replica_case_authorize', 'replica_case_get', 'replica_scope_check',
  'replica_evidence_append', 'replica_run_start', 'replica_run_get',
  'replica_report_generate'
];

let nextId = 1;
let currentCase = null;
const evidence = new Map();
const runs = new Map();

function id(prefix, value = String(nextId++)) {
  return `${prefix}_${value}`;
}

function textResult(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

function error(message, code = 'invalid_request') {
  return { ok: false, error: { code, message } };
}

function requireCase() {
  if (!currentCase) throw new Error('case has not been created');
  return currentCase;
}

function requireAuthorized(action) {
  const c = requireCase();
  if (c.authorization.status !== 'granted') throw new Error('case authorization is not granted');
  if (action && !c.scope.actions.includes(action)) throw new Error(`action outside scope: ${action}`);
  return c;
}

function dispatch(name, args = {}) {
  if (name === 'replica_capabilities') return {
    ok: true, schema: 'replica-unified/v1', transport: 'stdio', version: '0.2.0-contract',
    tools, targets: ['web', 'javascript', 'desktop', 'native', 'mobile', 'security'],
    records: ['case', 'scope', 'evidence', 'run', 'report']
  };
  if (name === 'replica_doctor') return { ok: true, ready: true, mode: 'mock', dependencies: { node: true, python: false, browser: false } };
  if (name === 'replica_case_create') {
    if (currentCase) throw new Error('contract mock supports one case per process');
    if (!args.target?.kind || !args.target?.locator) throw new Error('target.kind and target.locator are required');
    if (!args.scope?.actions?.length) throw new Error('scope.actions is required');
    currentCase = {
      schema: 'replica-unified/case/v1', id: id('case'), name: args.name || 'contract-case',
      target: args.target, scope: args.scope,
      authorization: { status: 'pending' }, lifecycle: 'pending'
    };
    return { ok: true, case: currentCase };
  }
  if (name === 'replica_case_authorize') {
    const c = requireCase();
    if (c.authorization.status !== 'pending') throw new Error('case is not pending');
    if (typeof args.operator_attestation !== 'string' || args.operator_attestation.length < 8) {
      throw new Error('operator_attestation is required');
    }
    c.authorization = {
      status: 'granted', basis: args.basis || 'explicit operator attestation',
      issuer: args.issuer || 'contract-test', expires_at: args.expires_at || '2099-01-01T00:00:00Z'
    };
    c.lifecycle = 'active';
    return { ok: true, case: c };
  }
  if (name === 'replica_case_get') return { ok: true, case: requireCase() };
  if (name === 'replica_scope_check') {
    const c = requireAuthorized(args.action);
    return { ok: true, case_id: c.id, action: args.action, target: args.target || c.target.locator, decision: 'allow', policy: c.scope };
  }
  if (name === 'replica_evidence_append') {
    const c = requireAuthorized(args.action || 'runtime');
    const input = args.evidence || {};
    if (!input.kind || !input.state || !input.authority || !input.content_sha256) throw new Error('evidence kind/state/authority/content_sha256 are required');
    const record = { ...input, schema: 'replica-unified/evidence/v1', id: id('evidence'), case_id: c.id,
      provenance: input.provenance || { source: 'contract-test', captured_at: '2026-01-01T00:00:00Z' } };
    evidence.set(record.id, record);
    return { ok: true, evidence: record };
  }
  if (name === 'replica_run_start') {
    const c = requireAuthorized(args.phase === 'security' ? 'security' : (args.phase || 'verify'));
    const inputIds = args.input_evidence_ids || [];
    for (const ref of inputIds) if (!evidence.has(ref)) throw new Error(`unknown input evidence: ${ref}`);
    const run = { schema: 'replica-unified/run/v1', id: id('run'), case_id: c.id,
      phase: args.phase || 'verify', status: 'succeeded', input_evidence_ids: inputIds,
      output_evidence_ids: inputIds, policy_snapshot: { scope: c.scope, authorization: c.authorization },
      scenario_id: args.scenario_id || null, started_at: '2026-01-01T00:00:00Z', finished_at: '2026-01-01T00:00:01Z' };
    runs.set(run.id, run);
    return { ok: true, run };
  }
  if (name === 'replica_run_get') {
    const run = runs.get(args.run_id);
    if (!run) throw new Error('unknown run');
    return { ok: true, run };
  }
  if (name === 'replica_report_generate') {
    const c = requireAuthorized('report');
    const selected = (args.run_ids || [...runs.keys()]).map(runId => runs.get(runId));
    if (!selected.length || selected.some(run => !run || run.case_id !== c.id)) throw new Error('report requires runs belonging to the case');
    const passed = selected.filter(run => run.status === 'succeeded').length;
    const report = { schema: 'replica-unified/report/v1', case_id: c.id,
      verdict: passed === selected.length ? 'READY' : 'PARTIAL', run_ids: selected.map(run => run.id),
      evidence_ids: [...new Set(selected.flatMap(run => run.output_evidence_ids))],
      coverage: { scenarios: selected.length, passed, failed: selected.length - passed },
      limitations: ['Contract fixture only; the verdict does not certify exhaustive parity.'],
      generated_at: '2026-01-01T00:00:02Z' };
    return { ok: true, report };
  }
  throw new Error(`unknown tool: ${name}`);
}

let input = Buffer.alloc(0);
process.stdin.on('data', chunk => {
  input = Buffer.concat([input, chunk]);
  while (true) {
    const lineEnd = input.indexOf(0x0a);
    if (lineEnd < 0) return;
    const line = input.subarray(0, lineEnd).toString('utf8').replace(/\r$/, '');
    input = input.subarray(lineEnd + 1);
    if (!line.trim()) continue;
    const body = JSON.parse(line);
    const response = handle(body);
    if (response) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  }
});

function handle(request) {
  if (request.method === 'notifications/initialized' || request.method?.startsWith('notifications/')) return null;
  if (!request.id) return null;
  if (request.method === 'initialize') return { jsonrpc: '2.0', id: request.id, result: {
    protocolVersion: request.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} },
    serverInfo: { name: 'replica-unified-contract-mock', version: '0.2.0' }
  }};
  try {
    if (request.method === 'tools/list') return { jsonrpc: '2.0', id: request.id, result: { tools: tools.map(name => ({ name, description: `Unified Replica ${name}`, inputSchema: { type: 'object' } })) } };
    if (request.method === 'tools/call') {
      const result = dispatch(request.params?.name, request.params?.arguments || {});
      return { jsonrpc: '2.0', id: request.id, result: textResult(result) };
    }
    return { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `method not found: ${request.method}` } };
  } catch (err) {
    return { jsonrpc: '2.0', id: request.id, result: textResult(error(err.message), true) };
  }
}

