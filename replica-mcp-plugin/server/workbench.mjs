import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultWorkbenchRoot = resolve(pluginRoot, '..', 'replica-workbench');

export function getWorkbenchRoot() {
  const bundled = resolve(pluginRoot, 'workbench');
  if (!process.env.REPLICA_WORKBENCH_ROOT && (existsSync(join(bundled, 'run.ps1')) || existsSync(join(bundled, 'run.sh')))) return bundled;
  return resolve(process.env.REPLICA_WORKBENCH_ROOT || defaultWorkbenchRoot);
}

function commandFor(root) {
  const firstExisting = (paths) => paths.map((path) => resolve(pluginRoot, path)).find((path) => existsSync(path));
  const bundledPython = firstExisting(process.platform === 'win32'
    ? ['runtime/python/python.exe']
    : ['runtime/python/bin/python3', 'runtime/python/bin/python', 'runtime/python/python3']);
  const bundledNode = firstExisting(process.platform === 'win32'
    ? ['runtime/node.exe']
    : ['runtime/node/bin/node', 'runtime/node/node']);
  const bundledChrome = firstExisting(process.platform === 'win32'
    ? ['runtime/chrome/chrome.exe']
    : ['runtime/chrome/chrome', 'runtime/chrome/chromium', 'runtime/chrome/Chromium.app/Contents/MacOS/Chromium', 'runtime/chrome/Google Chrome.app/Contents/MacOS/Google Chrome']);
  if (bundledPython && bundledNode) {
    return {
      command: bundledPython,
      args: ['-m', 'replica_platform.cli', 'agent'],
      env: {
        PYTHONPATH: join(root, 'src'),
        REPLICA_NODE_BIN: bundledNode,
        ...(existsSync(bundledChrome) ? { CHROME_PATH: bundledChrome } : {}),
        PATH: `${dirname(bundledNode)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}`,
      },
    };
  }
  if (process.platform === 'win32') {
    return { command: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'run.ps1'), 'agent'], env: {} };
  }
  return { command: 'bash', args: [join(root, 'run.sh'), 'agent'], env: {} };
}

function stopProcessTree(child) {
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { child.kill(); }
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
}

export function validateWorkbenchRoot(root = getWorkbenchRoot()) {
  if (!existsSync(join(root, 'run.ps1')) && !existsSync(join(root, 'run.sh'))) {
    throw new Error(`Replica Workbench is not installed at ${root}. Set REPLICA_WORKBENCH_ROOT or run the installer.`);
  }
  return root;
}

export function invokeAgent(request, { timeoutMs = 120000 } = {}) {
  const root = validateWorkbenchRoot();
  const { command, args, env: commandEnv } = commandFor(root);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...commandEnv, PYTHONIOENCODING: 'utf-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
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
      stopProcessTree(child);
      finish(reject, new Error(`Replica Workbench timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish(reject, new Error(`Could not start Replica Workbench: ${error.message}`)));
    child.on('close', (code) => {
      if (settled) return;
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
      if (!line) {
        finish(reject, new Error(stderr.trim() || `Replica Workbench exited with code ${code}`));
        return;
      }
      try { finish(resolvePromise, JSON.parse(line)); }
      catch (error) { finish(reject, new Error(`Replica Workbench returned invalid JSON: ${error.message}`)); }
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}
