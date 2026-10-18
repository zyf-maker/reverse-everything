import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const packageRoot = resolve(process.argv[2] ?? '');
assert(packageRoot, 'package root is required');
const node = join(packageRoot, 'runtime', 'node.exe');
const server = join(packageRoot, 'server', 'index.mjs');
const emptyPath = mkdtempSync(join(tmpdir(), 'replica-empty-path-'));
const env = { ...process.env, PATH: emptyPath };
const version = spawnSync(node, ['--version'], { env, encoding: 'utf8' });
assert.equal(version.status, 0);
assert.match(version.stdout, /^v\d+\./);

const browserProfile = mkdtempSync(join(tmpdir(), 'replica-browser-smoke-'));
const browser = spawnSync(join(packageRoot, 'runtime', 'chrome', 'chrome.exe'), [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-extensions',
  '--disable-background-networking', '--no-first-run', '--user-data-dir=' + browserProfile,
  '--dump-dom', 'data:text/html,<title>plugin-smoke</title><main>ready</main>',
], { env, encoding: 'utf8', timeout: 30000 });
assert.equal(browser.status, 0);
assert.match(browser.stdout, /plugin-smoke/);

const child = spawn(node, [server], { cwd: packageRoot, env, stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '';
const pending = new Map();
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  for (const line of buffer.split('\n').slice(0, -1)) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.id !== undefined && pending.has(message.id)) pending.get(message.id)(message);
  }
  buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
});
const request = (id, method, params) => new Promise((resolvePromise, reject) => {
  const timer = setTimeout(() => {
    pending.delete(id);
    reject(new Error('timeout waiting for ' + method));
  }, 15000);
  pending.set(id, (message) => {
    clearTimeout(timer);
    resolvePromise(message);
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
try {
  const initialized = await request(1, 'initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'package-smoke', version: '1' },
  });
  assert.equal(initialized.result.serverInfo.name, 'replica');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
  const listed = await request(2, 'tools/list', {});
  assert.ok(listed.result.tools.length >= 20);
  const capabilities = await request(3, 'tools/call', { name: 'replica_capabilities', arguments: {} });
  assert.equal(capabilities.result.isError, undefined);
  const attack = await request(4, 'tools/call', {
    name: 'replica_case_get',
    arguments: { case: '../README.md' },
  });
  assert.equal(attack.result.isError, true);
  assert.match(attack.result.content[0].text, /case must be a valid case directory|inside the workbench work folder/);
  console.log(JSON.stringify({ passed: true, checks: ['bundled Node', 'bundled Chromium', 'MCP initialize', 'canonical tools', 'capabilities call', 'case path escape rejected'] }));
} finally {
  child.kill();
  rmSync(browserProfile, { recursive: true, force: true });
  rmSync(emptyPath, { recursive: true, force: true });
}
