const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { compareRuntime } = require('../src/compare');
const { SAFE_EXPRESSIONS, installRequestGuard, originKey, pageOrigin, summarize, withNetworkGuardScope } = require('../src/capture');
const { SNAPSHOTS, buildReplayResult, recordReplayGuardEvent, runReplay } = require('../src/replay');
const { chooseTarget, normalizeEndpoint, validateDebuggerUrl } = require('../src/cdp');

const events = [{ kind: 'navigation' }, { kind: 'console' }, { kind: 'console' }];
assert.deepEqual(summarize(events), { eventCount: 3, kinds: { navigation: 1, console: 2 }, errors: 0 });
const a = { page: { localStorage: { score: '1' } }, events, summary: summarize(events) };
const b = { page: { localStorage: { score: '9' } }, events, summary: summarize(events) };
assert.equal(compareRuntime(a, b).pass, true);
const errorEvidence = { ...a, summary: { ...a.summary, errors: 1 } };
assert.equal(compareRuntime(errorEvidence, b).pass, false);
const c = { page: { localStorage: {} }, events: [{ kind: 'exception' }], summary: summarize([{ kind: 'exception' }]) };
assert.equal(compareRuntime(a, c).pass, false);
assert.equal(typeof SAFE_EXPRESSIONS.snapshot, 'string');
assert.equal(Object.hasOwn(SAFE_EXPRESSIONS, 'location.href'), false);
assert.equal(typeof SNAPSHOTS.game2048, 'string');
assert.deepEqual(withNetworkGuardScope({}).networkGuard, {
  scope: 'selected-page-target-only', browserWide: false, workerTargetsCovered: false
});
const runtimeDocs = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
assert.match(runtimeDocs, /selected page target/i);
assert.match(runtimeDocs, /service.worker/i);
const tile = {
  classList: ['tile', 'tile-4', 'tile-position-1-1'],
  querySelector: () => ({ textContent: '4' })
};
const gameSnapshot = vm.runInNewContext(SNAPSHOTS.game2048, {
  Array, Number, Object,
  Node: { TEXT_NODE: 3 },
  document: {
    querySelectorAll: () => [tile],
    querySelector: () => null
  },
  localStorage: {}
});
assert.equal(gameSnapshot.board[0], 4);
assert.equal(gameSnapshot.score, '');
assert.equal(gameSnapshot.best, '');
assert.deepEqual(Array.from(gameSnapshot.message), []);

assert.throws(() => normalizeEndpoint('http://user:pass@127.0.0.1:9222'), /bare loopback origin/);
assert.throws(() => normalizeEndpoint('http://127.0.0.1:9222/json/list'), /bare loopback origin/);
assert.throws(() => normalizeEndpoint('http://127.0.0.1:9222/?token=x'), /bare loopback origin/);
assert.throws(() => normalizeEndpoint('http://localhost:9222'), /non-loopback/);
assert.equal(normalizeEndpoint('http://127.0.0.1:9222/').port, '9222');
assert.throws(() => chooseTarget([{ type: 'page', url: 'https://safe.example/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/a' }]), /exact authorized page URL/);
const selected = chooseTarget([{ type: 'page', url: 'https://safe.example/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/a' }], 'https://safe.example/', 'http://127.0.0.1:9222');
assert.equal(selected.url, 'https://safe.example/');
assert.throws(() => validateDebuggerUrl('ws://127.0.0.1:9333/devtools/page/a', 'http://127.0.0.1:9222'), /authorized loopback endpoint/);
assert.throws(() => validateDebuggerUrl('ws://localhost:9222/devtools/page/a', 'http://127.0.0.1:9222'), /authorized loopback endpoint/);
assert.throws(() => validateDebuggerUrl('ws://external.invalid:9222/devtools/page/a', 'http://127.0.0.1:9222'), /authorized loopback endpoint/);
assert.equal(originKey('https://safe.example'), 'https://safe.example');
assert.throws(() => pageOrigin('https://external.invalid/', ['https://safe.example']), /outside the exact allowlist/);
assert.throws(() => pageOrigin('https://user:pass@safe.example/', ['https://safe.example']), /without credentials/);

const replayGuardEvents = [];
const replayGuardErrors = [];
const blockedReplayRequest = recordReplayGuardEvent(
  'reference', 'request.blocked', { url: 'https://external.invalid/collect' }, replayGuardEvents, replayGuardErrors
);
assert.deepEqual(replayGuardEvents, [{
  side: 'reference', kind: 'request.blocked', url: 'https://external.invalid/collect'
}]);
assert.deepEqual(replayGuardErrors, [
  'out-of-allowlist network request blocked on reference: https://external.invalid/collect'
]);
const blockedReplayResult = buildReplayResult(
  'network-boundary', [], replayGuardErrors, replayGuardEvents, [blockedReplayRequest]
);
assert.equal(blockedReplayResult.pass, false);
assert.deepEqual(blockedReplayResult.blockedRequests, [blockedReplayRequest]);
assert.deepEqual(blockedReplayResult.networkGuard, {
  scope: 'selected-page-target-only', browserWide: false, workerTargetsCovered: false
});
assert.equal(buildReplayResult('clean', [], [], [], []).pass, true);

const calls = [];
const listeners = new Map();
const guardEvents = [];
const mockConnection = {
  on: (method, listener) => { listeners.set(method, listener); return () => listeners.delete(method); },
  send: async (method, params) => { calls.push({ method, params }); }
};
const disable = installRequestGuard(mockConnection, ['https://safe.example'], (kind, payload) => guardEvents.push({ kind, payload }));
listeners.get('Fetch.requestPaused')({ requestId: 'allowed', request: { url: 'https://safe.example/app.js' } });
listeners.get('Fetch.requestPaused')({ requestId: 'blocked', request: { url: 'https://external.invalid/collect' } });
async function finishGuardTests() {
  await assert.rejects(runReplay({
    scenario: { schema: 'own-reverse-replay/v1', steps: [] },
    referenceEndpoint: 'http://127.0.0.1:9222', replicaEndpoint: 'http://127.0.0.1:9223',
    referencePageUrl: 'https://external.invalid/', replicaPageUrl: 'https://safe.example/',
    allowedOrigins: ['https://safe.example']
  }), /outside the exact allowlist/);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.slice(0, 2).map(call => call.method), ['Fetch.continueRequest', 'Fetch.failRequest']);
  assert.deepEqual(guardEvents, [{ kind: 'request.blocked', payload: { url: 'https://external.invalid/collect' } }]);
  await disable();
  assert.equal(calls[2].method, 'Fetch.disable');
  console.log('runtime tests: 37 passed');
}
finishGuardTests().catch(error => { console.error(error); process.exitCode = 1; });
