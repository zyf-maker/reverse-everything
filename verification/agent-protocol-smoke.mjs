import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workbench = path.join(root, 'replica-workbench');
const python = process.env.REPLICA_PYTHON || path.join(workbench, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python3');
const casePath = path.join(workbench, 'work/e2e-2048-20261017-final');

function invoke(requests, jsonl = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-m', 'replica_platform.cli', 'agent', ...(jsonl ? ['--jsonl'] : [])], {
      cwd: workbench,
      env: { ...process.env, PYTHONPATH: path.join(workbench, 'src') },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(jsonl ? `${requests.map(JSON.stringify).join('\n')}\n` : `${JSON.stringify(requests)}\n`);
  });
}

function invokePowerShell(args, input = '') {
  const executable = process.env.POWERSHELL_EXE || 'powershell.exe';
  const result = spawnSync(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], {
    cwd: workbench,
    env: { ...process.env, PYTHONPATH: path.join(workbench, 'src') },
    input,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024
  });
  if (result.error) throw result.error;
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function powerShellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

const schema = 'replica-agent/v1';
const capabilities = await invoke({ schema, request_id: 'node-agent-capabilities', operation: 'capabilities', params: {} });
assert.equal(capabilities.code, 0, capabilities.stderr);
const capabilitiesResponse = JSON.parse(capabilities.stdout);
assert.equal(capabilitiesResponse.ok, true);
assert.equal(capabilitiesResponse.request_id, 'node-agent-capabilities');

const batch = await invoke([
  { schema, request_id: 'node-jsonl-capabilities', operation: 'capabilities', params: {} },
  { schema, request_id: 'node-jsonl-status', operation: 'status', params: { case: casePath } }
], true);
assert.equal(batch.code, 0, batch.stderr);
const batchResponses = batch.stdout.trim().split(/\r?\n/).map(JSON.parse);
assert.equal(batchResponses.length, 2);
assert.equal(batchResponses.every(response => response.ok), true);
assert.equal(batchResponses[1].result.latest_verification.verdict, 'READY');

const selfGrant = await invoke({
  schema, request_id: 'node-agent-self-grant-denied', operation: 'init',
  params: {
    name: 'node-agent-self-grant-must-not-create', target: path.join(root, 'target-2048'),
    type: 'web', basis: 'agent supplied', authorize: true,
    authorization_expires_at: '2099-01-01T00:00:00Z'
  }
});
assert.equal(selfGrant.code, 1);
assert.equal(JSON.parse(selfGrant.stdout).ok, false);
assert.equal(JSON.parse(selfGrant.stdout).error.message.includes('cannot grant authorization'), true);

if (process.platform === 'win32') {
  const launcher = path.join(workbench, 'run.ps1');
  const powershellRequest = {
    schema, request_id: 'powershell-agent-capabilities', operation: 'capabilities', params: {}
  };
  const powershellSingle = invokePowerShell(['-File', launcher, 'agent'], JSON.stringify(powershellRequest));
  assert.equal(powershellSingle.code, 0, powershellSingle.stderr);
  assert.equal(JSON.parse(powershellSingle.stdout).ok, true);

  const powershellBatch = invokePowerShell(['-File', launcher, 'agent', '--jsonl'], [
    JSON.stringify(powershellRequest),
    JSON.stringify({ schema, request_id: 'powershell-agent-invalid', operation: 'invalid', params: {} })
  ].join('\n') + '\n');
  assert.equal(powershellBatch.code, 1, powershellBatch.stderr);
  const powershellResponses = powershellBatch.stdout.trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(powershellResponses.length, 2);
  assert.equal(powershellResponses[0].ok, true);
  assert.equal(powershellResponses[1].ok, false);

  const psRequestLiteral = powerShellLiteral(JSON.stringify(powershellRequest));
  const psLauncherLiteral = powerShellLiteral(launcher);
  const pipelineCommand = `$request = ${psRequestLiteral}; $request | & ${psLauncherLiteral} agent; exit $LASTEXITCODE`;
  const powershellPipeline = invokePowerShell(['-Command', pipelineCommand]);
  assert.equal(powershellPipeline.code, 0, powershellPipeline.stderr);
  assert.equal(JSON.parse(powershellPipeline.stdout).ok, true);

  const mixedPipelineCommand = [
    `$requests = @(${powerShellLiteral(JSON.stringify(powershellRequest))},`,
    `${powerShellLiteral(JSON.stringify({ schema, request_id: 'powershell-pipeline-invalid', operation: 'invalid', params: {} }))});`,
    `$requests | & ${psLauncherLiteral} agent --jsonl; exit $LASTEXITCODE`
  ].join(' ');
  const powershellMixedPipeline = invokePowerShell(['-Command', mixedPipelineCommand]);
  assert.equal(powershellMixedPipeline.code, 1, powershellMixedPipeline.stderr);
  const mixedPipelineResponses = powershellMixedPipeline.stdout.trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(mixedPipelineResponses.length, 2);
  assert.equal(mixedPipelineResponses[0].ok, true);
  assert.equal(mixedPipelineResponses[1].ok, false);
}

console.log(JSON.stringify({
  passed: true,
  client: 'Node.js child process over stdin/stdout; no agent SDK',
  checks: [
    'single JSON request', 'JSONL batch', 'latest verification status', 'agent self-authorization denied',
    ...(process.platform === 'win32' ? [
      'PowerShell raw-stdin JSON', 'PowerShell mixed-result JSONL exit code', 'PowerShell pipeline input',
      'PowerShell pipeline JSONL mixed-result exit code'
    ] : [])
  ]
}, null, 2));
