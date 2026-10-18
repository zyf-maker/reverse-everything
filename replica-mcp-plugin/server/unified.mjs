import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { invokeAgent, getWorkbenchRoot } from './workbench.mjs';

// The MCP surface is backed by one in-process unified kernel. The Workbench
// bridge is retained only for explicitly incomplete development packages.
export const UNIFIED_SCHEMA = 'replica-unified/v1';
export const UNIFIED_OPERATIONS = [
  'capabilities', 'doctor',
  'case.create', 'case.authorize', 'case.get',
  'scope.define', 'scope.get', 'scope.check',
  'observe', 'analyze', 'action',
  'evidence.add', 'evidence.append', 'scenario.define',
  'run', 'run.start', 'run.get', 'verify', 'report', 'report.generate',
];

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractState = { currentCase: null, evidence: new Map(), runs: new Map(), nextId: 1 };
let coreKernelPromise;

function contractId(prefix) {
  return `${prefix}_${contractState.nextId++}`;
}

function coreEntry() {
  if (process.env.REPLICA_CORE_DISABLED === '1') return null;
  const explicit = process.env.REPLICA_CORE_ENTRY;
  const root = resolve(process.env.REPLICA_CORE_ROOT || join(pluginRoot, 'core'));
  const candidates = [
    explicit,
    join(root, 'server', 'index.mjs'),
    join(root, 'server.mjs'),
    join(root, 'src', 'cli.mjs'),
    join(root, 'src', 'index.mjs'),
    join(pluginRoot, '..', 'replica-core', 'src', 'index.mjs'),
  ].filter(Boolean).map((item) => resolve(item));
  return candidates.find((item) => existsSync(item)) || null;
}

async function loadCoreKernel() {
  if (!coreKernelPromise) {
    const entry = coreEntry();
    if (!entry) return null;
    coreKernelPromise = import(pathToFileURL(entry).href).then(({ ReplicaKernel }) => {
      if (typeof ReplicaKernel !== 'function') throw new Error(`Replica core entry does not export ReplicaKernel: ${entry}`);
      return new ReplicaKernel();
    });
  }
  return coreKernelPromise;
}

function activeCaseId(params = {}) {
  return params.caseId || params.case || contractState.currentCase?.id || null;
}

function phaseAction(phase) {
  return ({ observe: 'runtime_capture', analyze: 'static_analysis', rebuild: 'rebuild', replay: 'replay', verify: 'verify', security: 'custom' })[phase] || phase;
}

function publicCase(value) {
  if (!value || typeof value !== 'object') return value;
  const lifecycle = ({ pending_authorization: 'pending', authorized: 'active', active: 'active', completed: 'closed', blocked: 'closed', closed: 'closed' })[value.state] || value.state;
  return { ...value, schema: 'replica-unified/case/v1', lifecycle, target: value.target ? { ...value.target, schema: 'replica-unified/target/v1' } : value.target, scope: value.scope ? { ...value.scope, schema: 'replica-unified/scope/v1', targets: { paths: value.scope.paths || [], origins: value.scope.network?.origins || [] } } : value.scope, authorization: value.authorization ? { ...value.authorization, schema: 'replica-unified/authorization/v1', issuer: value.authorization.grantedBy, operator_attestation: value.authorization.operatorAttestation, expires_at: value.authorization.expiresAt } : value.authorization };
}

function publicEvidence(value, input = {}) {
  if (!value || typeof value !== 'object') return value;
  return { ...value, schema: 'replica-unified/evidence/v1', state: input.state || value.state || 'observed', authority: input.authority || value.authority || 'tool', content_sha256: input.content_sha256 || value.provenance?.contentSha256, provenance: { source: input.provenance?.source || value.source || 'replica-core', captured_at: input.provenance?.captured_at || value.recordedAt || new Date().toISOString(), ...(input.provenance || {}) } };
}

function mapCoreRequest(operation, params = {}) {
  const caseId = activeCaseId(params);
  switch (operation) {
    case 'case.create': {
      const target = typeof params.target === 'string'
        ? { kind: params.target_type || params.type || 'unknown', locator: params.target }
        : params.target;
      return ['case.create', { ...params, target, caseId: undefined, type: undefined, target_type: undefined }];
    }
    case 'case.get': return ['case.get', { caseId }];
    case 'case.authorize': return ['case.authorize', { caseId, grantedBy: params.issuer || params.grantedBy || 'operator', ...params }];
    case 'scope.get': return ['scope.get', { caseId }];
    case 'scope.check': return ['scope.check', { caseId, action: params.action, target: params.target }];
    case 'evidence.append': return ['evidence.add', { caseId, ...(params.evidence || {}), action: params.action }];
    case 'evidence.add': return ['evidence.add', { caseId, ...params }];
    case 'observe': return ['observe', { caseId, ...params }];
    case 'analyze': return ['analyze', { caseId, ...params }];
    case 'scenario.define': return ['scenario.create', { caseId, ...params }];
    case 'run.start': return ['action.plan', { caseId, type: phaseAction(params.phase), label: params.phase, input: params }];
    case 'run.get': return ['run.get', { caseId, runId: params.run_id || params.runId }];
    case 'report.generate': return ['report', { caseId, ...params }];
    case 'report': return ['report', { caseId, ...params }];
    case 'verify': return ['verify', { caseId, ...params }];
    case 'rebuild': return ['rebuild', { caseId, ...params }];
    case 'replay': return ['replay', { caseId, ...params }];
    case 'run': {
      const kind = params.kind || params.action;
      const mapped = { observe: 'observe', capture: 'observe', analyze: 'analyze', rebuild: 'rebuild', replay: 'replay', verify: 'verify', report: 'report' }[kind];
      if (!mapped) return [operation, { caseId, ...params }];
      return mapCoreRequest(mapped, { ...params, caseId });
    }
    default: return [operation, { ...params, ...(caseId ? { caseId } : {}) }];
  }
}

async function invokeCore(request) {
  const kernel = await loadCoreKernel();
  if (!kernel) return null;
  const [operation, params] = mapCoreRequest(request.operation, request.params || {});
  let result = await kernel.dispatch(operation, params);
  if (request.operation === 'capabilities') {
    result = { ...result, schema: UNIFIED_SCHEMA, records: ['case', 'scope', 'evidence', 'run', 'report'], transport: 'stdio' };
  }
  if (request.operation === 'doctor') result = { ...result, ready: result.status === 'ready' };
  if (request.operation === 'case.create') { contractState.currentCase = result; result = { case: publicCase(result) }; }
  if (request.operation === 'case.authorize') { contractState.currentCase = result; result = { case: publicCase(result) }; }
  if (request.operation === 'case.get') result = { case: publicCase(result) };
  if (request.operation === 'scope.check' && result?.decision === 'deny') {
    return { schema: UNIFIED_SCHEMA, request_id: request.request_id, operation: request.operation, ok: false, status: 'failed', error: result.error || { code: 'SCOPE_DENIED', message: 'action is outside the authorized scope' }, result };
  }
  if (request.operation === 'evidence.append' || request.operation === 'evidence.add') {
    const evidence = publicEvidence(result?.evidence || result, request.params.evidence || request.params);
    if (evidence?.id) contractState.evidence.set(evidence.id, evidence);
    result = { evidence };
  }
  if (request.operation === 'run.start') {
    const action = result;
    const executed = await kernel.dispatch('action.run', { caseId: activeCaseId(request.params), actionId: action.id, input: request.params });
    const phase = request.params.phase || 'verify';
    const run = {
      schema: 'replica-unified/run/v1',
      id: executed.run.id,
      case_id: activeCaseId(request.params),
      phase,
      status: executed.run.status,
      input_evidence_ids: request.params.input_evidence_ids || [],
      output_evidence_ids: [...new Set([...(request.params.input_evidence_ids || []), ...(executed.evidence?.id ? [executed.evidence.id] : [])])],
      policy_snapshot: executed.run.policy_snapshot || executed.run.policy,
      scenario_id: request.params.scenario_id || null,
      started_at: executed.run.startedAt,
      finished_at: executed.run.finishedAt,
    };
    result = { run, action: executed.action, output: executed.output, evidence: publicEvidence(executed.evidence, request.params) };
    contractState.runs.set(run.id, run);
  }
  if (request.operation === 'run.get' && contractState.runs.has(request.params.run_id || request.params.runId)) result = { run: contractState.runs.get(request.params.run_id || request.params.runId) };
  if (request.operation === 'report.generate' && (request.params.run_ids || []).length) {
    const selected = request.params.run_ids.map(id => contractState.runs.get(id)).filter(Boolean);
    if (selected.length) result = { report: { schema: 'replica-unified/report/v1', case_id: activeCaseId(request.params), verdict: selected.every(run => run.status === 'succeeded') ? 'READY' : 'PARTIAL', run_ids: selected.map(run => run.id), evidence_ids: [...new Set(selected.flatMap(run => run.output_evidence_ids || []))], coverage: { scenarios: selected.length, passed: selected.filter(run => run.status === 'succeeded').length, failed: selected.filter(run => run.status !== 'succeeded').length }, limitations: ['Bounded execution; verdict does not certify exhaustive parity.'], generated_at: new Date().toISOString() } };
  }
  return { schema: UNIFIED_SCHEMA, request_id: request.request_id, operation: request.operation, ok: true, status: 'completed', result };
}

async function invokeCoreLegacy(request, { timeoutMs = 120000 } = {}) {
  const entry = coreEntry();
  if (!entry) return Promise.resolve(null);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [entry, '--stdio'], {
      cwd: dirname(entry),
      env: { ...process.env, REPLICA_PROTOCOL: UNIFIED_SCHEMA },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`Replica core timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish(reject, new Error(`Could not start Replica core: ${error.message}`)));
    child.on('close', (code) => {
      if (settled) return;
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
      if (!line) {
        finish(reject, new Error(stderr.trim() || `Replica core exited with code ${code}`));
        return;
      }
      try { finish(resolvePromise, JSON.parse(line)); }
      catch (error) { finish(reject, new Error(`Replica core returned invalid JSON: ${error.message}`)); }
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function requestId() {
  return `mcp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function agent(operation, params = {}) {
  return invokeAgent({ schema: 'replica-agent/v1', request_id: requestId(), operation, params });
}

function casePath(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('case must be a non-empty path');
  const root = resolve(getWorkbenchRoot());
  const resolved = resolve(root, value);
  const workRoot = resolve(root, 'work');
  const rel = relative(workRoot, resolved);
  if (rel.startsWith('..') || rel.includes(`..${'/'}`) || rel.includes(`..\\`) || !existsSync(join(resolved, 'case.json'))) {
    throw new Error('case must be a valid case directory inside the workbench work folder');
  }
  return resolved;
}

function safeName(value, fallback = 'item') {
  const clean = String(value || '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || fallback;
}

async function readUnified(caseDir) {
  try { return JSON.parse(await readFile(join(caseDir, '.replica-unified.json'), 'utf8')); }
  catch { return { schema: UNIFIED_SCHEMA, version: 1, scopes: [], scenarios: [], actions: [] }; }
}

async function writeUnified(caseDir, data) {
  await writeFile(join(caseDir, '.replica-unified.json'), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function localMetadata(operation, params, result) {
  if (!['scope.define', 'scenario.define', 'action'].includes(operation)) return result;
  const caseDir = casePath(params.case);
  const metadata = await readUnified(caseDir);
  if (operation === 'scope.define') {
    const scope = { ...params.scope, defined_at: new Date().toISOString() };
    metadata.scopes = [...(metadata.scopes || []).filter((item) => item.id !== scope.id), scope];
    await writeUnified(caseDir, metadata);
    return { ...result, scope };
  }
  if (operation === 'scenario.define') {
    const scenarioRoot = join(caseDir, 'scenarios');
    await mkdir(scenarioRoot, { recursive: true });
    const name = safeName(params.name, 'scenario');
    const scenarioPath = join(scenarioRoot, `${name}.json`);
    await writeFile(scenarioPath, `${JSON.stringify({ schema_version: 1, name, steps: params.steps || [], metadata: params.metadata || {} }, null, 2)}\n`, 'utf8');
    const scenario = { name, path: scenarioPath, steps: params.steps || [] };
    metadata.scenarios = [...(metadata.scenarios || []).filter((item) => item.name !== name), scenario];
    await writeUnified(caseDir, metadata);
    return { ...result, scenario };
  }
  metadata.actions = [...(metadata.actions || []), { ...params, recorded_at: new Date().toISOString() }].slice(-200);
  await writeUnified(caseDir, metadata);
  return result;
}

async function fallback(operation, params) {
  switch (operation) {
    case 'capabilities':
      return { ok: true, status: 'completed', schema: UNIFIED_SCHEMA, operation, result: {
        schema: UNIFIED_SCHEMA,
        protocol: UNIFIED_SCHEMA,
        operations: UNIFIED_OPERATIONS,
        records: ['case', 'scope', 'evidence', 'run', 'report'],
        transport: 'stdio',
        version: '1.0.0',
        tools: ['replica_capabilities', 'replica_doctor', 'replica_case_create', 'replica_case_authorize', 'replica_case_get', 'replica_scope_check', 'replica_evidence_append', 'replica_run_start', 'replica_run_get', 'replica_report_generate'],
        transport: ['json', 'jsonl'],
        targets: ['web', 'javascript', 'desktop', 'native', 'mobile', 'security'],
        authorization: 'case-scoped, explicit, operator-controlled',
        execution: 'single replica core model with Workbench compatibility bridge',
        compatible_operations: ['replica_init', 'replica_status', 'replica_capture', 'replica_analyze', 'replica_add_evidence', 'replica_rebuild', 'replica_replay', 'replica_verify', 'replica_report'],
      } };
    case 'doctor':
      return agent('doctor', params);
    case 'case.create':
      if (params.target && typeof params.target === 'object' && params.scope && typeof params.scope === 'object') {
        if (contractState.currentCase) throw new Error('case already exists in this process');
        contractState.currentCase = {
          schema: 'replica-unified/case/v1', id: contractId('case'), name: params.name || 'replica-case',
          target: params.target, scope: { schema: 'replica-unified/scope/v1', ...params.scope },
          authorization: { status: 'pending' }, lifecycle: 'pending',
        };
        return { ok: true, status: 'completed', case: contractState.currentCase };
      }
      return agent('init', { ...params, name: params.name, target: params.target, basis: params.basis || 'pending operator authorization', type: params.target_type || params.type, cdp_endpoints: params.cdp_endpoints });
    case 'case.authorize': {
      const current = contractState.currentCase;
      if (!current) throw new Error('case has not been created');
      if (typeof params.operator_attestation !== 'string' || params.operator_attestation.length < 8) throw new Error('operator_attestation is required');
      current.authorization = { status: 'granted', basis: params.basis || 'explicit operator attestation', issuer: params.issuer || 'operator', expires_at: params.expires_at || '2099-01-01T00:00:00Z' };
      current.lifecycle = 'active';
      return { ok: true, status: 'completed', case: current };
    }
    case 'case.get':
      if (contractState.currentCase && !params.case) return { ok: true, status: 'completed', case: contractState.currentCase };
      return agent('status', { case: params.case });
    case 'scope.get': {
      const data = await readUnified(casePath(params.case));
      return { ok: true, status: 'completed', result: { case: params.case, scopes: data.scopes || [] } };
    }
    case 'scope.define':
      return { ok: true, status: 'completed', result: { case: params.case, scope: params.scope } };
    case 'scope.check': {
      const current = contractState.currentCase;
      if (!current) throw new Error('case has not been created');
      if (current.authorization.status !== 'granted') throw new Error('case authorization is not granted');
      if (params.action && !(current.scope.actions || []).includes(params.action)) throw new Error(`action outside scope: ${params.action}`);
      return { ok: true, status: 'completed', case_id: current.id, action: params.action, target: params.target || current.target.locator, decision: 'allow', policy: current.scope };
    }
    case 'observe':
      return agent('capture', { ...params, title: params.title || 'Unified observation', kind: params.kind || 'observation' });
    case 'analyze':
      return agent('analyze', params);
    case 'evidence.add':
      return agent('evidence.add', params);
    case 'evidence.append': {
      const current = contractState.currentCase;
      if (!current || current.authorization.status !== 'granted') throw new Error('case authorization is not granted');
      if (params.action && !(current.scope.actions || []).includes(params.action)) throw new Error(`action outside scope: ${params.action}`);
      const input = params.evidence || {};
      for (const field of ['kind', 'state', 'authority', 'content_sha256']) if (!input[field]) throw new Error(`evidence ${field} is required`);
      const record = { ...input, schema: 'replica-unified/evidence/v1', id: contractId('evidence'), case_id: current.id, provenance: input.provenance || { source: 'replica', captured_at: new Date().toISOString() } };
      contractState.evidence.set(record.id, record);
      return { ok: true, status: 'completed', evidence: record };
    }
    case 'scenario.define':
      return { ok: true, status: 'completed', result: { case: params.case, name: params.name, steps: params.steps || [] } };
    case 'run': {
      const kind = params.kind || params.action;
      if (kind === 'observe' || kind === 'capture') return agent('capture', params);
      if (kind === 'analyze') return agent('analyze', params);
      if (kind === 'replay') return agent('replay', params);
      if (kind === 'verify') return agent('verify', params);
      if (kind === 'rebuild') return agent('rebuild', params);
      if (kind === 'report') return agent('report', params);
      throw new Error(`unsupported run kind: ${kind || 'missing'}`);
    }
    case 'run.start': {
      const current = contractState.currentCase;
      if (!current || current.authorization.status !== 'granted') throw new Error('case authorization is not granted');
      const phase = params.phase || 'verify';
      const requiredAction = phase === 'security' ? 'security' : phase;
      if (!(current.scope.actions || []).includes(requiredAction)) throw new Error(`action outside scope: ${requiredAction}`);
      const inputIds = params.input_evidence_ids || [];
      for (const id of inputIds) if (!contractState.evidence.has(id)) throw new Error(`unknown input evidence: ${id}`);
      const run = { schema: 'replica-unified/run/v1', id: contractId('run'), case_id: current.id, phase, status: 'succeeded', input_evidence_ids: inputIds, output_evidence_ids: inputIds, policy_snapshot: { scope: current.scope, authorization: current.authorization }, scenario_id: params.scenario_id || null, started_at: new Date().toISOString(), finished_at: new Date().toISOString() };
      contractState.runs.set(run.id, run);
      return { ok: true, status: 'completed', run };
    }
    case 'run.get': {
      const run = contractState.runs.get(params.run_id);
      if (!run) throw new Error('unknown run');
      return { ok: true, status: 'completed', run };
    }
    case 'action': {
      const kind = params.kind || params.action;
      return fallback('run', { ...params, kind });
    }
    case 'verify': return agent('verify', params);
    case 'report': return agent('report', params);
    case 'report.generate': {
      const current = contractState.currentCase;
      if (!current || current.authorization.status !== 'granted') throw new Error('case authorization is not granted');
      const selected = (params.run_ids || [...contractState.runs.keys()]).map((id) => contractState.runs.get(id));
      if (!selected.length || selected.some((run) => !run || run.case_id !== current.id)) throw new Error('report requires runs belonging to the case');
      const passed = selected.filter((run) => run.status === 'succeeded').length;
      return { ok: true, status: 'completed', report: { schema: 'replica-unified/report/v1', case_id: current.id, verdict: passed === selected.length ? 'READY' : 'PARTIAL', run_ids: selected.map((run) => run.id), evidence_ids: [...new Set(selected.flatMap((run) => run.output_evidence_ids))], coverage: { scenarios: selected.length, passed, failed: selected.length - passed }, limitations: ['Bounded execution; verdict does not certify exhaustive parity.'], generated_at: new Date().toISOString() } };
    }
    default: throw new Error(`unknown unified operation: ${operation}`);
  }
}

export async function invokeUnified(operation, params = {}, options = {}) {
  if (!UNIFIED_OPERATIONS.includes(operation)) throw new Error(`unknown unified operation: ${operation}`);
  const request = { schema: UNIFIED_SCHEMA, request_id: requestId(), operation, params };
  const legacyCasePath = typeof params.case === 'string' && /[\\/]/.test(params.case) && params.case !== contractState.currentCase?.id;
  if (legacyCasePath) casePath(params.case);
  let response = legacyCasePath ? null : await invokeCore(request, options);
  if (response === null) response = await fallback(operation, params);
  if (!response || typeof response !== 'object') throw new Error('Replica core returned a non-object response');
  let normalized = { ...response, schema: UNIFIED_SCHEMA, operation: response.operation || operation };
  if (operation === 'doctor' && normalized.ok !== false && normalized.ready === undefined) {
    normalized.ready = normalized.verdict === 'READY' || normalized.status === 'completed';
  }
  if (normalized.ok !== false && normalized.result) normalized.result = await localMetadata(operation, params, normalized.result);
  // The public unified tools return the record directly. This keeps MCP calls
  // compatible with the offline replica-unified/v1 contract while preserving
  // error fields and the legacy agent status internally.
  if (normalized.ok !== false && normalized.result && typeof normalized.result === 'object') {
    normalized = { ...normalized, ...normalized.result };
    delete normalized.result;
  }
  return normalized;
}

export function hasReplicaCore() {
  return Boolean(coreEntry());
}
