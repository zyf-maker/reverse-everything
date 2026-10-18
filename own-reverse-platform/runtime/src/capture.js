const { CdpConnection, chooseTarget, listTargets } = require('./cdp');

function now() { return new Date().toISOString(); }

const NETWORK_GUARD_SCOPE = Object.freeze({
  scope: 'selected-page-target-only',
  browserWide: false,
  workerTargetsCovered: false
});

function withNetworkGuardScope(result) {
  return { ...result, networkGuard: { ...NETWORK_GUARD_SCOPE } };
}

function originKey(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) throw new Error('Allowed origins must be bare HTTP(S) origins');
  return url.origin.toLowerCase();
}

function pageOrigin(value, allowedOrigins) {
  let url;
  try { url = new URL(value); } catch { throw new Error('An exact authorized page URL is required'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Page URL must be HTTP(S) without credentials');
  }
  const allowed = new Set((allowedOrigins || []).map(originKey));
  if (!allowed.has(url.origin.toLowerCase())) throw new Error(`Page origin is outside the exact allowlist: ${url.origin}`);
  return url.origin.toLowerCase();
}

function installRequestGuard(connection, allowedOrigins, record) {
  const allowed = new Set(allowedOrigins.map(originKey));
  const unsubscribe = connection.on('Fetch.requestPaused', payload => {
    let permitted = false;
    try {
      const url = new URL(payload.request.url);
      permitted = ['http:', 'https:'].includes(url.protocol) ? allowed.has(url.origin.toLowerCase())
        : ['about:', 'blob:', 'data:'].includes(url.protocol);
    } catch { permitted = false; }
    const method = permitted ? 'Fetch.continueRequest' : 'Fetch.failRequest';
    const params = permitted ? { requestId: payload.requestId } : { requestId: payload.requestId, errorReason: 'BlockedByClient' };
    if (!permitted) record('request.blocked', { url: payload.request.url });
    connection.send(method, params).catch(error => record('guard.error', { message: error.message }));
  });
  return async () => {
    unsubscribe();
    await connection.send('Fetch.disable').catch(() => {});
  };
}

async function captureRuntime(options = {}) {
  const startedAt = now();
  const endpoint = options.endpoint;
  if (!endpoint) throw new Error('capture requires an explicit loopback CDP endpoint');
  if (!options.pageUrl) throw new Error('capture requires an exact authorized page URL');
  const allowedOrigins = [...new Set((options.allowedOrigins || []).map(originKey))];
  pageOrigin(options.pageUrl, allowedOrigins);
  if (options.navigate) pageOrigin(options.navigate, allowedOrigins);
  const targets = await listTargets(endpoint);
  const target = chooseTarget(targets, options.pageUrl, endpoint);
  const events = [];
  const connection = await new CdpConnection(target.webSocketDebuggerUrl, options.timeoutMs || 8000).connect();
  const record = (kind, payload) => events.push({ at: now(), kind, payload });
  const disableGuard = installRequestGuard(connection, allowedOrigins, record);
  const subscriptions = [
    ['Runtime.consoleAPICalled', payload => record('console', { type: payload.type, args: (payload.args || []).map(arg => arg.value ?? arg.description ?? arg.type), stack: payload.stackTrace })],
    ['Runtime.exceptionThrown', payload => record('exception', { text: payload.exceptionDetails?.text, url: payload.exceptionDetails?.url, line: payload.exceptionDetails?.lineNumber, column: payload.exceptionDetails?.columnNumber })],
    ['Log.entryAdded', payload => record('log', payload.entry)],
    ['Network.requestWillBeSent', payload => record('request', { requestId: payload.requestId, url: payload.request.url, method: payload.request.method, type: payload.type, documentURL: payload.documentURL })],
    ['Network.responseReceived', payload => record('response', { requestId: payload.requestId, url: payload.response.url, status: payload.response.status, mimeType: payload.response.mimeType, type: payload.type })],
    ['Page.frameNavigated', payload => record('navigation', { frameId: payload.frame.id, url: payload.frame.url, title: payload.frame.name })],
    ['DOMStorage.domStorageItemAdded', payload => record('storage.added', payload)],
    ['DOMStorage.domStorageItemRemoved', payload => record('storage.removed', payload)],
    ['DOMStorage.domStorageItemUpdated', payload => record('storage.updated', payload)],
    ['DOMStorage.domStorageItemsCleared', payload => record('storage.cleared', payload)]
  ];
  const unsubs = subscriptions.map(([method, listener]) => connection.on(method, listener));
  let pageState = {};
  try {
    await connection.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await Promise.all(['Runtime.enable', 'Log.enable', 'Network.enable', 'Page.enable', 'DOMStorage.enable'].map(method => connection.send(method).catch(error => record('enable.error', { method, message: error.message }))));
    if (options.navigate) await connection.send('Page.navigate', { url: options.navigate });
    const waitMs = options.durationMs == null ? 3000 : Number(options.durationMs);
    if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 120000) throw new Error('capture duration must be an integer from 0 to 120000 ms');
    await new Promise(resolve => setTimeout(resolve, waitMs));
    try {
      const evaluated = await evaluateSafe(connection, 'snapshot');
      pageState = evaluated.result?.value || {};
    } catch (error) { record('evaluate.error', { message: error.message }); }
  } finally {
    for (const unsubscribe of unsubs) unsubscribe();
    await disableGuard();
    connection.close();
  }
  return withNetworkGuardScope({ schema: 'own-reverse-runtime/v1', startedAt, finishedAt: now(), target: { id: target.id, url: target.url, title: target.title, type: target.type }, page: pageState, events, summary: summarize(events) });
}

const SAFE_EXPRESSIONS = Object.freeze({
  url: 'location.href',
  title: 'document.title',
  readyState: 'document.readyState',
  textLength: 'document.body?.innerText?.length || 0',
  localStorageKeys: 'Object.keys(localStorage).sort()',
  sessionStorageKeys: 'Object.keys(sessionStorage).sort()',
  snapshot: `(() => ({ url: location.href, title: document.title, readyState: document.readyState, localStorage: Object.fromEntries(Object.entries(localStorage)), sessionStorage: Object.fromEntries(Object.entries(sessionStorage)), textLength: document.body?.innerText?.length || 0 }))()`
});

async function evaluateSafe(connection, expression) {
  const source = SAFE_EXPRESSIONS[expression] || expression;
  if (!Object.values(SAFE_EXPRESSIONS).includes(source)) throw new Error(`Expression is not on the runtime inspection allowlist: ${expression}`);
  return connection.send('Runtime.evaluate', { expression: source, returnByValue: true, awaitPromise: true });
}

function summarize(events) {
  const counts = {};
  for (const event of events) counts[event.kind] = (counts[event.kind] || 0) + 1;
  return { eventCount: events.length, kinds: counts, errors: (counts.exception || 0) + (counts['evaluate.error'] || 0) + (counts['guard.error'] || 0) };
}

module.exports = { NETWORK_GUARD_SCOPE, SAFE_EXPRESSIONS, captureRuntime, evaluateSafe, installRequestGuard, originKey, pageOrigin, summarize, withNetworkGuardScope };
