const { CdpConnection, chooseTarget, listTargets } = require('./cdp');
const { installRequestGuard, originKey, pageOrigin, withNetworkGuardScope } = require('./capture');

const SNAPSHOTS = Object.freeze({
  page: `(() => ({
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    textLength: document.body?.innerText?.length || 0,
    localStorage: Object.fromEntries(Object.entries(localStorage)),
    sessionStorage: Object.fromEntries(Object.entries(sessionStorage))
  }))()`,
  game2048: `(() => {
    const board = Array(16).fill(0);
    for (const tile of document.querySelectorAll('.tile')) {
      const position = Array.from(tile.classList).map(name => name.match(/^tile-position-(\\d+)-(\\d+)$/)).find(Boolean);
      const value = Number(tile.querySelector('.tile-inner')?.textContent || 0);
      if (position) board[(Number(position[2]) - 1) * 4 + Number(position[1]) - 1] = value;
    }
    const scoreText = element => Array.from(element?.childNodes || []).find(node => node.nodeType === Node.TEXT_NODE)?.textContent.trim() || '';
    const message = document.querySelector('.game-message');
    return {
      score: scoreText(document.querySelector('.score-container')),
      best: scoreText(document.querySelector('.best-container')),
      board,
      message: message ? Array.from(message.classList).filter(name => name !== 'game-message').sort() : []
    };
  })()`
});

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0))); }

function boundedDelay(value, fallback = 50, maximum = 5000) {
  const delay = value == null ? fallback : Number(value);
  if (!Number.isInteger(delay) || delay < 0 || delay > maximum) throw new Error(`delay must be an integer from 0 to ${maximum} ms`);
  return delay;
}

function matchesExpected(actual, expected) {
  if (Array.isArray(expected)) return Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected);
  if (expected && typeof expected === 'object') {
    return actual && typeof actual === 'object' && Object.entries(expected).every(([key, value]) => matchesExpected(actual[key], value));
  }
  return actual === expected;
}

function randomScript(seed) {
  return `(() => { let state = ${Number(seed) >>> 0}; Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; }; })()`;
}

async function evaluate(connection, expression) {
  const result = await connection.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails;
    const description = details.exception?.description || details.exception?.value || '';
    const location = details.lineNumber == null ? '' : ` at ${details.lineNumber + 1}:${(details.columnNumber || 0) + 1}`;
    throw new Error(`${details.text || 'Runtime evaluation failed'}${location}${description ? `: ${description}` : ''}`);
  }
  return result.result?.value;
}

async function waitForPage(connection, expectedUrl, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastUrl = '';
  while (Date.now() < deadline) {
    try {
      lastUrl = await evaluate(connection, 'location.href');
      if (lastUrl === expectedUrl) return;
    } catch {
      // The document may still be transitioning between targets.
    }
    await sleep(50);
  }
  throw new Error(`page did not reach requested URL: expected ${expectedUrl}, got ${lastUrl || '<unavailable>'}`);
}

async function setup(connection, setup, seed) {
  await connection.send('Page.enable');
  await connection.send('Runtime.enable');
  await connection.send('Page.addScriptToEvaluateOnNewDocument', { source: randomScript(seed) });
  const state = setup?.gameState;
  const best = setup?.bestScore == null ? null : String(setup.bestScore);
  await evaluate(connection, `(() => {
    localStorage.clear();
    ${state == null ? '' : `localStorage.setItem('gameState', ${JSON.stringify(JSON.stringify(state))});`}
    ${best == null ? '' : `localStorage.setItem('bestScore', ${JSON.stringify(best)});`}
  })()`);
  await connection.send('Page.reload', { ignoreCache: true });
  await sleep(boundedDelay(setup?.waitMs, 250, 10000));
}

async function key(connection, value) {
  const keyCodes = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
  const event = { key: value, code: value.startsWith('Arrow') ? value : undefined,
    windowsVirtualKeyCode: keyCodes[value], nativeVirtualKeyCode: keyCodes[value] };
  await connection.send('Input.dispatchKeyEvent', { ...event, type: 'keyDown' });
  await connection.send('Input.dispatchKeyEvent', { ...event, type: 'keyUp' });
}

async function click(connection, selector) {
  const allowed = new Set(['.restart-button', '.retry-button', '.keep-playing-button']);
  if (!allowed.has(selector)) throw new Error(`click selector is not allowlisted: ${selector}`);
  const safe = JSON.stringify(String(selector));
  await evaluate(connection, `(() => { const el = document.querySelector(${safe}); if (!el) throw new Error('selector not found: ' + ${safe}); el.click(); })()`);
}

async function snapshot(connection, name) {
  const expression = SNAPSHOTS[name];
  if (!expression) throw new Error(`snapshot is not allowlisted: ${name}`);
  return evaluate(connection, expression);
}

function recordReplayGuardEvent(side, kind, payload, events, errors) {
  const event = { side, kind, ...(payload || {}) };
  events.push(event);
  if (kind === 'request.blocked') {
    errors.push(`out-of-allowlist network request blocked on ${side}: ${event.url || '<unknown URL>'}`);
  } else if (kind === 'guard.error') {
    errors.push(`network request guard failed on ${side}: ${event.message || 'unknown error'}`);
  }
  return event;
}

function replayPasses(firstFailure, errors, blockedRequests) {
  return !firstFailure && errors.length === 0 && blockedRequests.length === 0;
}

function buildReplayResult(scenario, snapshots, errors, networkGuardEvents, blockedRequests) {
  const firstFailure = snapshots.find(item => !item.pass) || null;
  return withNetworkGuardScope({
    schema: 'own-reverse-replay/v1',
    pass: replayPasses(firstFailure, errors, blockedRequests),
    scenario: scenario || null,
    networkGuardEvents,
    blockedRequests,
    snapshots,
    firstFailure,
    errors
  });
}

async function runReplay(options = {}) {
  const scenario = options.scenario;
  if (!scenario || scenario.schema !== 'own-reverse-replay/v1') throw new Error('unsupported replay scenario schema');
  if (!Array.isArray(scenario.steps) || scenario.steps.length > 500) throw new Error('replay must contain at most 500 steps');
  if (!options.referenceEndpoint || !options.replicaEndpoint) throw new Error('replay requires explicit reference and replica CDP endpoints');
  if (!options.referencePageUrl || !options.replicaPageUrl) throw new Error('replay requires exact reference and replica page URLs');
  const allowedOrigins = [...new Set((options.allowedOrigins || []).map(originKey))];
  pageOrigin(options.referencePageUrl, allowedOrigins);
  pageOrigin(options.replicaPageUrl, allowedOrigins);
  const [referenceTarget, replicaTarget] = await Promise.all([
    chooseTarget(await listTargets(options.referenceEndpoint), options.referencePageUrl, options.referenceEndpoint),
    chooseTarget(await listTargets(options.replicaEndpoint), options.replicaPageUrl, options.replicaEndpoint)
  ]);
  const [reference, replica] = await Promise.all([
    new CdpConnection(referenceTarget.webSocketDebuggerUrl, options.timeoutMs || 8000).connect(),
    new CdpConnection(replicaTarget.webSocketDebuggerUrl, options.timeoutMs || 8000).connect()
  ]);
  const snapshots = [];
  const errors = [];
  const networkGuardEvents = [];
  const blockedRequests = [];
  const errorListeners = [];
  const disableGuards = [];
  const compare = (label, left, right, expected) => {
    const equal = JSON.stringify(left) === JSON.stringify(right);
    const referenceExpected = expected == null || matchesExpected(left, expected);
    const replicaExpected = expected == null || matchesExpected(right, expected);
    const pass = equal && referenceExpected && replicaExpected;
    snapshots.push({ label, pass, equal, expected: expected ?? null,
      referenceExpected, replicaExpected, reference: left, replica: right });
    return pass;
  };
  try {
    for (const [side, connection] of [['reference', reference], ['replica', replica]]) {
      disableGuards.push(installRequestGuard(connection, allowedOrigins, (kind, payload) => {
        const event = recordReplayGuardEvent(side, kind, payload, networkGuardEvents, errors);
        if (kind === 'request.blocked') blockedRequests.push(event);
      }));
      errorListeners.push(connection.on('Runtime.exceptionThrown', payload => errors.push(payload.exceptionDetails?.text || 'uncaught page exception')));
      await connection.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
      await connection.send('Runtime.enable');
    }
    await Promise.all([
      waitForPage(reference, options.referencePageUrl),
      waitForPage(replica, options.replicaPageUrl)
    ]);
    const seed = scenario.randomSeed ?? 1;
    await Promise.all([setup(reference, scenario.setup, seed), setup(replica, scenario.setup, seed)]);
    compare('initial', await snapshot(reference, scenario.snapshot || 'page'), await snapshot(replica, scenario.snapshot || 'page'), scenario.expect);
    for (const [index, step] of (scenario.steps || []).entries()) {
      if (!step || typeof step !== 'object') throw new Error(`invalid replay step ${index}`);
      if (step.type === 'reset') {
        await Promise.all([setup(reference, step.setup || {}, step.seed ?? seed), setup(replica, step.setup || {}, step.seed ?? seed)]);
      } else if (step.type === 'key') {
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'h', 'j', 'k', 'l', 'r'].includes(step.key)) throw new Error(`key is not allowlisted: ${step.key}`);
        await Promise.all([key(reference, step.key), key(replica, step.key)]);
      }
      else if (step.type === 'click') await Promise.all([click(reference, step.selector), click(replica, step.selector)]);
      else if (step.type === 'wait') await sleep(boundedDelay(step.ms, 0));
      else if (step.type === 'reload') {
        await Promise.all([reference.send('Page.reload', { ignoreCache: true }), replica.send('Page.reload', { ignoreCache: true })]);
        await Promise.all([
          waitForPage(reference, options.referencePageUrl),
          waitForPage(replica, options.replicaPageUrl)
        ]);
      }
      else if (step.type === 'snapshot') { /* snapshot below */ }
      else throw new Error(`unsupported replay step type: ${step.type}`);
      if (step.type !== 'wait' || step.capture === true) {
        await sleep(boundedDelay(step.settleMs));
        const name = step.snapshot || scenario.snapshot || 'page';
        compare(step.label || `step-${index + 1}`, await snapshot(reference, name), await snapshot(replica, name), step.expect);
      }
    }
    return buildReplayResult(scenario.name, snapshots, errors, networkGuardEvents, blockedRequests);
  } finally {
    for (const unsubscribe of errorListeners) unsubscribe();
    await Promise.all(disableGuards.map(disable => disable()));
    reference.close(); replica.close();
  }
}

module.exports = { SNAPSHOTS, buildReplayResult, matchesExpected, recordReplayGuardEvent, replayPasses, runReplay };
