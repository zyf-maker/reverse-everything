import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));

test('portable manifest and MCP config expose a bundled stdio entry', async () => {
  const manifest = await readJson('plugin.json');
  const mcp = await readJson('mcp.json');
  const server = mcp.mcpServers['replica-unified'];
  assert.equal(manifest.name, 'replica-unified');
  assert.equal(manifest.version, '0.2.0');
  assert.equal(server.type, 'stdio');
  assert.equal(server.command, '${PLUGIN_ROOT}/runtime/node.exe');
  assert.deepEqual(server.args, ['${PLUGIN_ROOT}/server/index.mjs']);
});

test('Claude plugin manifest uses the plugin-root placeholder for its local server', async () => {
  const manifest = await readJson('.claude-plugin/plugin.json');
  const mcp = await readJson('.mcp.json');
  const server = mcp.mcpServers['replica-unified'];
  assert.equal(manifest.name, 'replica-unified');
  assert.equal(manifest.version, '0.2.0');
  assert.equal(server.command, '${CLAUDE_PLUGIN_ROOT}/runtime/node.exe');
  assert.deepEqual(server.args, ['${CLAUDE_PLUGIN_ROOT}/server/index.mjs']);
});
