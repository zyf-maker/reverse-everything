import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { invokeAgent, validateWorkbenchRoot } from '../server/workbench.mjs';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function startServer() {
  const child = spawn(process.execPath, [resolve(pluginRoot, 'server/index.mjs')], { cwd: pluginRoot, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (const line of buffer.split('\n').slice(0, -1)) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined) pending.get(message.id)?.(message);
    }
    buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
  });
  const request = (id, method, params) => new Promise((resolvePromise, reject) => {
    pending.set(id, resolvePromise);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`timeout waiting for ${method}`)); }, 5000);
  });
  return { child, request };
}

test('workbench bridge returns capabilities and rejects self-authorization', async () => {
  validateWorkbenchRoot();
  const response = await invokeAgent({ schema: 'replica-agent/v1', request_id: 'test', operation: 'capabilities', params: {} });
  assert.equal(response.ok, true);
  assert.deepEqual(response.result.transport, ['json', 'jsonl']);
  const rejected = await invokeAgent({ schema: 'replica-agent/v1', request_id: 'attack', operation: 'init', params: { name: 'attack', target: '.', basis: 'agent', authorize: true, authorization_expires_at: '2099-01-01T00:00:00Z' } });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error.message, /cannot grant authorization/);
});

test('MCP server initializes and exposes only named tools', async (t) => {
  const { child, request } = startServer();
  t.after(() => child.kill());
  const initialized = await request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(initialized.result.serverInfo.name, 'replica-workbench');
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {}})}\n`);
  const listed = await request(2, 'tools/list', {});
  const names = listed.result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    'replica_add_evidence', 'replica_analyze', 'replica_capabilities', 'replica_capture', 'replica_doctor',
    'replica_init', 'replica_rebuild', 'replica_replay', 'replica_report', 'replica_status', 'replica_verify',
  ]);
  const called = await request(3, 'tools/call', { name: 'replica_capabilities', arguments: {} });
  assert.equal(called.result.isError, undefined);
  assert.match(called.result.content[0].text, /replica-agent\/v1/);
});

test('MCP errors preserve the workbench security boundary', async (t) => {
  const { child, request } = startServer();
  t.after(() => child.kill());
  await request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {}})}\n`);
  const response = await request(2, 'tools/call', { name: 'replica_rebuild', arguments: { case: 'work/e2e-2048-20261017-final', output: '..\\escape' } });
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /case must be a valid case directory|inside the workbench work folder/);
});
