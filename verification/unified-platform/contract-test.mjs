import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureCase = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/case.json'), 'utf8'));
const fixtureEvidence = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/evidence.json'), 'utf8'));
const requiredTools = [
  'replica_capabilities', 'replica_doctor', 'replica_case_create', 'replica_case_authorize',
  'replica_case_get', 'replica_scope_check', 'replica_evidence_append', 'replica_run_start',
  'replica_run_get', 'replica_report_generate'
];

const configured = process.env.REPLICA_UNIFIED_COMMAND_JSON;
let command = process.execPath;
let args = [path.join(here, 'mock-mcp-server.mjs')];
let mode = 'mock';
if (configured) {
  const value = JSON.parse(configured);
  assert(Array.isArray(value) && value.length > 0, 'REPLICA_UNIFIED_COMMAND_JSON must be a non-empty JSON array');
  [command, ...args] = value;
  mode = 'configured';
}

const child = spawn(command, args, { cwd: root, stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
let buffer = Buffer.alloc(0);
let nextRequest = 1;
const pending = new Map();
child.stdout.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const lineEnd = buffer.indexOf(0x0a);
    if (lineEnd < 0) break;
    const line = buffer.subarray(0, lineEnd).toString('utf8').replace(/\r$/, '');
    buffer = buffer.subarray(lineEnd + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  }
});

function request(method, params = {}) {
  const id = nextRequest++;
  const payload = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }), 'utf8');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout waiting for ${method}`)); }, 10000);
    pending.set(id, message => { clearTimeout(timer); resolve(message); });
    child.stdin.write(`${payload.toString('utf8')}\n`);
  });
}

function parseTool(response) {
  assert.equal(response.error, undefined, response.error?.message);
  const result = response.result;
  const text = result?.content?.find(item => item.type === 'text')?.text;
  const value = text ? JSON.parse(text) : result?.structuredContent;
  assert(value !== undefined, 'tool response did not include structuredContent or JSON text content');
  return { value, isError: result.isError === true };
}

async function call(name, args = {}) {
  return parseTool(await request('tools/call', { name, arguments: args }));
}

try {
  const initialize = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'contract-test', version: '1.0.0' } });
  assert.equal(initialize.result?.serverInfo?.name !== undefined, true);
  const initialized = Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), 'utf8');
  child.stdin.write(`${initialized.toString('utf8')}\n`);

  const listed = await request('tools/list');
  const toolNames = listed.result.tools.map(tool => tool.name);
  for (const name of requiredTools) assert(toolNames.includes(name), `missing MCP tool ${name}`);

  const capabilities = await call('replica_capabilities');
  assert.equal(capabilities.value.schema, 'replica-unified/v1');
  assert.deepEqual(capabilities.value.records, ['case', 'scope', 'evidence', 'run', 'report']);
  const doctor = await call('replica_doctor');
  assert.equal(doctor.value.ready, true);

  const created = await call('replica_case_create', { name: fixtureCase.name, target: fixtureCase.target, scope: fixtureCase.scope });
  assert.equal(created.value.case.authorization.status, 'pending');
  const denied = await call('replica_scope_check', { action: 'runtime', target: fixtureCase.target.locator });
  assert.equal(denied.isError, true, 'pending case must block scoped work');

  const badAuth = await call('replica_case_authorize', { basis: 'missing attestation' });
  assert.equal(badAuth.isError, true, 'authorization must require operator attestation');
  const authorized = await call('replica_case_authorize', { operator_attestation: 'operator-approved-contract', basis: 'owned synthetic fixture', issuer: 'contract-test', expires_at: '2099-01-01T00:00:00Z' });
  assert.equal(authorized.value.case.authorization.status, 'granted');

  const scope = await call('replica_scope_check', { action: 'runtime', target: fixtureCase.target.locator });
  assert.equal(scope.value.decision, 'allow');
  const appended = await call('replica_evidence_append', { action: 'runtime', evidence: fixtureEvidence });
  assert.match(appended.value.evidence.id, /^evidence_/);
  assert.equal(appended.value.evidence.case_id, authorized.value.case.id);

  const run = await call('replica_run_start', { phase: 'verify', scenario_id: 'page-ready', input_evidence_ids: [appended.value.evidence.id] });
  assert.equal(run.value.run.status, 'succeeded');
  assert.equal(run.value.run.policy_snapshot.authorization.status, 'granted');
  const fetchedRun = await call('replica_run_get', { run_id: run.value.run.id });
  assert.equal(fetchedRun.value.run.id, run.value.run.id);

  const report = await call('replica_report_generate', { run_ids: [run.value.run.id] });
  assert.equal(report.value.report.schema, 'replica-unified/report/v1');
  assert.equal(report.value.report.verdict, 'READY');
  assert.equal(report.value.report.coverage.passed, 1);
  assert(report.value.report.evidence_ids.includes(appended.value.evidence.id));

  console.log(JSON.stringify({ ok: true, mode, schema: 'replica-unified/v1', tools: toolNames.length, checks: [
    'initialize', 'tools/list', 'capabilities', 'doctor', 'pending-scope-denied', 'operator-attestation-required',
    'case-authorize', 'scope-allow', 'evidence-provenance', 'run-policy-snapshot', 'report-ready'
  ] }, null, 2));
} finally {
  child.kill();
}

