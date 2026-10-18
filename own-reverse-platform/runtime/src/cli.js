#!/usr/bin/env node
const fs = require('node:fs/promises');
const { captureRuntime, evaluateSafe, installRequestGuard, originKey, pageOrigin } = require('./capture');
const { CdpConnection, browserVersion, chooseTarget, listTargets } = require('./cdp');
const { compareRuntime } = require('./compare');
const { runReplay } = require('./replay');

function usage() {
  console.error('Usage: rr-runtime inspect --endpoint http://127.0.0.1:9222 [--out inspect.json]');
  console.error('       rr-runtime evaluate --endpoint http://127.0.0.1:9222 --page-url URL --allow-origin ORIGIN --expression url|title|readyState|textLength|localStorageKeys|sessionStorageKeys|snapshot');
  console.error('       rr-runtime capture --endpoint http://127.0.0.1:9222 --page-url URL --allow-origin ORIGIN [--navigate URL] [--duration-ms 3000] [--out evidence.json]');
  console.error('       rr-runtime compare --reference reference.json --replica replica.json [--out comparison.json]');
  console.error('       rr-runtime replay --reference-endpoint http://127.0.0.1:9231 --replica-endpoint http://127.0.0.1:9232 --reference-page-url URL --replica-page-url URL --allow-origin ORIGIN [--allow-origin ORIGIN] --scenario scenario.json [--out result.json]');
  process.exitCode = 2;
}
function args(argv) { const out = {}; for (let i = 0; i < argv.length; i += 1) { const key = argv[i]; if (!key.startsWith('--')) continue; const name = key.slice(2); const value = argv[i + 1]?.startsWith('--') ? true : (argv[i + 1] ?? true); if (value !== true) i += 1; if (Object.hasOwn(out, name)) out[name] = Array.isArray(out[name]) ? [...out[name], value] : [out[name], value]; else out[name] = value; } return out; }
function list(value) { return value == null ? [] : Array.isArray(value) ? value : [value]; }
async function main() {
  const command = process.argv[2]; const flags = args(process.argv.slice(3));
  if (!['inspect', 'evaluate', 'capture', 'compare', 'replay'].includes(command)) return usage();
  if (command === 'inspect') {
    const endpoint = flags.endpoint;
    if (!endpoint) throw new Error('inspect requires --endpoint');
    await writeResult({ schema: 'own-reverse-runtime-inspect/v1', endpoint, version: await browserVersion(endpoint), targets: await listTargets(endpoint) }, flags.out);
    return;
  }
  if (command === 'evaluate') {
    const endpoint = flags.endpoint;
    if (!endpoint) throw new Error('evaluate requires --endpoint');
    if (!flags['page-url']) throw new Error('evaluate requires --page-url');
    const allowedOrigins = list(flags['allow-origin']).map(originKey);
    pageOrigin(flags['page-url'], allowedOrigins);
    const target = chooseTarget(await listTargets(endpoint), flags['page-url'], endpoint);
    const connection = await new CdpConnection(target.webSocketDebuggerUrl).connect();
    const disableGuard = installRequestGuard(connection, allowedOrigins, () => {});
    try { await connection.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }); await connection.send('Runtime.enable'); await writeResult({ schema: 'own-reverse-runtime-evaluate/v1', target: { id: target.id, url: target.url }, expression: flags.expression, result: (await evaluateSafe(connection, flags.expression)).result?.value }, flags.out); }
    finally { await disableGuard(); connection.close(); }
    return;
  }
  if (command === 'capture') {
    if (!flags.endpoint) throw new Error('capture requires --endpoint');
    const result = await captureRuntime({ endpoint: flags.endpoint, pageUrl: flags['page-url'], navigate: flags.navigate,
      allowedOrigins: list(flags['allow-origin']), durationMs: Number(flags['duration-ms'] || 3000) });
    await writeResult(result, flags.out, flags.format);
  } else if (command === 'compare') {
    const [reference, replica] = await Promise.all([fs.readFile(flags.reference, 'utf8').then(JSON.parse), fs.readFile(flags.replica, 'utf8').then(JSON.parse)]);
    await writeResult(compareRuntime(reference, replica), flags.out, flags.format);
  } else {
    const scenario = await fs.readFile(flags.scenario, 'utf8').then(JSON.parse);
    const result = await runReplay({ scenario, referenceEndpoint: flags['reference-endpoint'], replicaEndpoint: flags['replica-endpoint'], referencePageUrl: flags['reference-page-url'], replicaPageUrl: flags['replica-page-url'], allowedOrigins: list(flags['allow-origin']) });
    await writeResult(result, flags.out, flags.format);
    if (!result.pass) process.exitCode = 1;
  }
}
async function writeResult(result, out, format = 'json') {
  const text = format === 'jsonl' && result.events
    ? [{ schema: result.schema, startedAt: result.startedAt, finishedAt: result.finishedAt, target: result.target, page: result.page, summary: result.summary }, ...result.events].map(item => JSON.stringify(item)).join('\n') + '\n'
    : `${JSON.stringify(result, null, 2)}\n`;
  if (out) await fs.writeFile(out, text, 'utf8'); else process.stdout.write(text);
}
main().catch(error => { console.error(`rr-runtime: ${error.message}`); process.exitCode = 1; });
