import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function startServer() {
  const child = spawn(process.execPath, [resolve(root, 'server/index.mjs')], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined) pending.get(message.id)?.(message);
    }
  });
  let nextId = 1;
  const request = (method, params = {}) => {
    const id = nextId++;
    return new Promise((resolvePromise, reject) => {
      pending.set(id, resolvePromise);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      setTimeout(() => { if (pending.delete(id)) reject(new Error(`timeout waiting for ${method}`)); }, 5000);
    });
  };
  return { child, request };
}

function tool(response) {
  const result = response.result;
  const text = result?.content?.find(item => item.type === 'text')?.text;
  assert(text, 'missing tool text response');
  return { value: JSON.parse(text), error: result.isError === true };
}

test('unified canonical lifecycle uses one case/evidence/run/report model', async t => {
  const { child, request } = startServer();
  t.after(() => child.kill());
  const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'unified-test', version: '1' } });
  assert.equal(init.result.serverInfo.name, 'replica');
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const listed = await request('tools/list');
  const names = listed.result.tools.map(item => item.name);
  for (const name of ['replica_case_create', 'replica_case_authorize', 'replica_scope_check', 'replica_evidence_append', 'replica_run_start', 'replica_run_get', 'replica_report_generate']) assert(names.includes(name));

  const caps = tool(await request('tools/call', { name: 'replica_capabilities', arguments: {} }));
  assert.equal(caps.value.schema, 'replica-unified/v1');
  assert.deepEqual(caps.value.records, ['case', 'scope', 'evidence', 'run', 'report']);

  const created = tool(await request('tools/call', { name: 'replica_case_create', arguments: {
    name: 'contract-case', target: { kind: 'web', locator: 'http://127.0.0.1:4100' },
    scope: { actions: ['runtime', 'verify', 'report'], targets: { paths: [], origins: ['http://127.0.0.1:4100'] }, network: { mode: 'loopback' } },
  } }));
  assert.equal(created.value.case.authorization.status, 'pending');
  const denied = tool(await request('tools/call', { name: 'replica_scope_check', arguments: { action: 'runtime', target: 'http://127.0.0.1:4100' } }));
  assert.equal(denied.error, true);

  const authorized = tool(await request('tools/call', { name: 'replica_case_authorize', arguments: { operator_attestation: 'operator-approved', basis: 'owned synthetic fixture', expires_at: '2099-01-01T00:00:00Z' } }));
  assert.equal(authorized.value.case.authorization.status, 'granted');
  const scope = tool(await request('tools/call', { name: 'replica_scope_check', arguments: { action: 'runtime', target: 'http://127.0.0.1:4100' } }));
  assert.equal(scope.value.decision, 'allow');
  const evidence = tool(await request('tools/call', { name: 'replica_evidence_append', arguments: { action: 'runtime', evidence: { kind: 'observation', state: 'observed', authority: 'runtime', content_sha256: 'a'.repeat(64), provenance: { source: 'test', captured_at: '2026-01-01T00:00:00Z' } } } }));
  assert.match(evidence.value.evidence.id, /^evidence_/);
  const run = tool(await request('tools/call', { name: 'replica_run_start', arguments: { phase: 'verify', scenario_id: 'page-ready', input_evidence_ids: [evidence.value.evidence.id] } }));
  assert.equal(run.value.run.status, 'succeeded');
  const fetched = tool(await request('tools/call', { name: 'replica_run_get', arguments: { run_id: run.value.run.id } }));
  assert.equal(fetched.value.run.id, run.value.run.id);
  const report = tool(await request('tools/call', { name: 'replica_report_generate', arguments: { run_ids: [run.value.run.id] } }));
  assert.equal(report.value.report.schema, 'replica-unified/report/v1');
  assert.equal(report.value.report.verdict, 'READY');
});
