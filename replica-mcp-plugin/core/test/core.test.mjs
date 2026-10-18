import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { CaseStore, ReplicaKernel, ScopeError, AuthorizationError, handleRequest, analyzeJavaScript } from '../src/index.mjs';

function pendingCase(overrides = {}) {
  return { name: `test-${Date.now()}-${Math.random()}`, target: { kind: 'javascript', locator: overrides.target || process.cwd() }, scope: { networkMode: 'offline', actions: ['static_analysis', 'rebuild', 'replay', 'verify', 'report', 'runtime_capture'] }, basis: 'test authorization', ...overrides };
}

async function authorizedKernel(overrides = {}) {
  const kernel = new ReplicaKernel();
  const entity = kernel.createCase(pendingCase(overrides));
  kernel.authorize(entity.id, { basis: 'controlled test', grantedBy: 'test-runner', operator_attestation: 'test-approved', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  return { kernel, caseId: entity.id };
}

test('case lifecycle requires explicit authorization and records policy snapshots', async () => {
  const kernel = new ReplicaKernel();
  const entity = kernel.createCase(pendingCase());
  await assert.rejects(() => kernel.analyze(entity.id, { target: process.cwd() }), AuthorizationError);
  kernel.authorize(entity.id, { basis: 'fixture only', grantedBy: 'test', operator_attestation: 'test-approved', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const result = await kernel.analyze(entity.id, { target: process.cwd() });
  assert.equal(result.run.status, 'succeeded');
  assert.equal(result.run.policy.authorization.status, 'granted');
  assert.equal(result.evidence.provenance.parent, null);
});

test('evidence provenance is hash linked and scope blocks network escape', async () => {
  const { kernel, caseId } = await authorizedKernel();
  const first = kernel.addEvidence(caseId, { kind: 'observation', title: 'one', source: 'test', data: { n: 1 } });
  const second = kernel.addEvidence(caseId, { kind: 'observation', title: 'two', source: 'test', data: { n: 2 } });
  assert.equal(second.provenance.parent, first.hash);
  const caseEntity = kernel.getCase(caseId);
  assert.equal(caseEntity.evidence.length, 2);
  const web = new ReplicaKernel();
  const webCase = web.createCase(pendingCase({ target: 'http://example.test/', type: 'web', scope: { networkMode: 'loopback', origins: ['http://example.test'] } }));
  web.authorize(webCase.id, { basis: 'loopback fixture', grantedBy: 'test', operator_attestation: 'test-approved', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  assert.throws(() => web.observe(webCase.id, { target: 'https://outside.test/', data: {} }), ScopeError);
});

test('capability discovery exposes unified internal modules and degraded optional modules', async () => {
  const kernel = new ReplicaKernel();
  const snapshot = await kernel.capabilitiesSnapshot();
  const ids = new Set(snapshot.capabilities.map(item => item.id));
  for (const id of ['analysis.javascript', 'runtime.browser', 'analysis.native', 'analysis.mobile', 'security.validation', 'planning.scenario', 'worker.orchestration']) assert.ok(ids.has(id), id);
  assert.equal(snapshot.protocol, 'replica-unified/v1');
  assert.ok(snapshot.capabilities.some(item => item.id === 'runtime.browser' && item.status === 'degraded'));
});

test('replay, verify and report use one kernel execution path', async () => {
  const { kernel, caseId } = await authorizedKernel();
  const replay = await kernel.replay(caseId, { steps: [{ label: 'initial', expectedPass: true }], maxSteps: 2 });
  assert.equal(replay.output.pass, true);
  const verification = await kernel.verify(caseId, { checks: [{ id: 'scenario', pass: true }], rebuild: 'fixture' });
  assert.equal(verification.verification.pass, true);
  const report = await kernel.report(caseId);
  assert.match(report.body, /Claim scope/);
  assert.ok(['READY', 'complete'].includes(report.status));
});

test('JSONL protocol preserves request ids and structured errors', async () => {
  const kernel = new ReplicaKernel();
  const ok = await handleRequest(kernel, { schema: 'replica-unified/v1', request_id: 'a', operation: 'doctor', params: {} });
  assert.equal(ok.ok, true);
  assert.equal(ok.request_id, 'a');
  const bad = await handleRequest(kernel, { schema: 'replica-unified/v1', request_id: 'b', operation: 'case.get', params: { caseId: 'missing' } });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'CASE_NOT_FOUND');
});

test('static analyzer works without external packages', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'replica-core-'));
  await fs.writeFile(path.join(root, 'sample.js'), "const run = async (x) => fetch('/x').then(() => eval(x));\n");
  const result = await analyzeJavaScript({ input: { target: root } });
  assert.equal(result.summary.files, 1);
  assert.ok(result.summary.functions >= 1);
  assert.ok(result.summary.risks >= 1);
});
