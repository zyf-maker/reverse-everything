import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getWorkbenchRoot, invokeAgent } from './workbench.mjs';

const root = getWorkbenchRoot();
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundled = existsSync(join(pluginRoot, 'manifest.json'));
const firstExisting = (paths) => paths.map((path) => join(pluginRoot, path)).find(existsSync);
const bundledNode = process.platform === 'win32'
  ? firstExisting(['runtime/node.exe'])
  : firstExisting(['runtime/node/bin/node', 'runtime/node/node']);
const bundledPython = process.platform === 'win32'
  ? firstExisting(['runtime/python/python.exe'])
  : firstExisting(['runtime/python/bin/python3', 'runtime/python/bin/python', 'runtime/python/python3']);
const bundledBrowser = process.platform === 'win32'
  ? firstExisting(['runtime/chrome/chrome.exe'])
  : firstExisting(['runtime/chrome/chrome', 'runtime/chrome/chromium', 'runtime/chrome/Chromium.app/Contents/MacOS/Chromium', 'runtime/chrome/Google Chrome.app/Contents/MacOS/Google Chrome']);
const checks = {
  workbench: existsSync(join(root, 'run.ps1')) || existsSync(join(root, 'run.sh')),
  package: existsSync(join(root, 'pyproject.toml')),
  runtime: existsSync(join(root, '..', 'own-reverse-platform', 'runtime', 'src', 'cli.js')),
  ...(bundled ? {
    node: Boolean(bundledNode),
    python: Boolean(bundledPython),
    browser: Boolean(bundledBrowser),
    dependencies: existsSync(join(pluginRoot, 'node_modules', '@modelcontextprotocol', 'server')),
  } : {}),
};
let agent = null;
if (Object.values(checks).every(Boolean)) {
  try { agent = await invokeAgent({ schema: 'replica-agent/v1', request_id: 'plugin-doctor', operation: 'doctor', params: {} }, { timeoutMs: 30000 }); }
  catch (error) { agent = { ok: false, error: { type: error.name, message: error.message } }; }
}
const ready = Object.values(checks).every(Boolean) && agent?.ok === true;
console.log(JSON.stringify({ plugin: 'replica-workbench', root, ready, checks, workbench: agent }, null, 2));
process.exitCode = ready ? 0 : 1;
