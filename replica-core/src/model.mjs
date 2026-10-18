import { AuthorizationError, ScopeError, TransitionError } from './errors.mjs';
import { assertArray, assertString, clone, id, isFuture, now, parseFuture, sha256, stable, isWithin } from './util.mjs';

export const SCHEMA = 'replica-core/v1';
export const CASE_STATES = Object.freeze(['pending_authorization', 'authorized', 'active', 'completed', 'blocked', 'closed']);
export const ACTION_STATES = Object.freeze(['planned', 'running', 'succeeded', 'failed', 'skipped']);
export const EVIDENCE_KINDS = Object.freeze(['observation', 'inference', 'test', 'network', 'visual', 'limitation', 'artifact']);
export const TARGET_KINDS = Object.freeze(['web', 'javascript', 'desktop', 'mobile', 'binary', 'unknown']);
export const ACTION_TYPES = Object.freeze(['static_analysis', 'runtime_capture', 'network_observe', 'rebuild', 'replay', 'verify', 'report', 'custom']);

export function createTarget(input = {}) {
  if (typeof input === 'string') input = { locator: input };
  const kind = input.kind || input.type || 'unknown';
  if (!TARGET_KINDS.includes(kind)) throw new TypeError(`unsupported target kind: ${kind}`);
  return Object.freeze({ schema: `${SCHEMA}/target`, id: input.id || id('target'), kind, locator: assertString(input.locator ?? input.value, 'target.locator'), version: input.version || null, metadata: clone(input.metadata || {}) });
}

export function createScope(input = {}) {
  const mode = input.network?.mode || input.networkMode || 'offline';
  if (!['offline', 'loopback', 'allowlist'].includes(mode)) throw new TypeError(`unsupported network scope: ${mode}`);
  const actionAliases = { static: 'static_analysis', runtime: 'runtime_capture', network: 'network_observe' };
  const actions = [...new Set((input.actions || ['static_analysis', 'runtime_capture', 'network_observe', 'rebuild', 'replay', 'verify', 'report']).map(action => actionAliases[action] || action))];
  const paths = [...new Set(input.paths || input.targets?.paths || [])].map(value => assertString(value, 'scope.paths item'));
  const origins = [...new Set(input.origins || input.targets?.origins || [])].map(value => normalizeOrigin(value));
  const cdpEndpoints = [...new Set(input.cdpEndpoints || input.targets?.cdp_endpoints || [])].map(value => normalizeEndpoint(value));
  if (mode === 'offline' && (origins.length || cdpEndpoints.length)) throw new ScopeError('offline scope cannot include network endpoints');
  return Object.freeze({
    schema: `${SCHEMA}/scope`,
    network: { mode, origins, cdpEndpoints },
    paths,
    actions,
    limits: clone(input.limits || { maxSteps: 500, maxDurationMs: 120000, maxEvidenceBytes: 25_000_000 }),
    constraints: clone(input.constraints || {})
  });
}

export function createAuthorization(input = {}) {
  const status = input.status || 'pending';
  if (!['pending', 'granted', 'expired', 'revoked'].includes(status)) throw new TypeError(`unsupported authorization status: ${status}`);
  const result = { schema: `${SCHEMA}/authorization`, status, basis: String(input.basis || ''), grantedBy: input.grantedBy || input.issuer || null, operatorAttestation: input.operatorAttestation || input.operator_attestation || null, grantedAt: input.grantedAt || null, expiresAt: input.expiresAt || input.expires_at || null, constraints: clone(input.constraints || {}) };
  if (status === 'granted') {
    if (!result.basis.trim() || !result.grantedBy || !result.operatorAttestation) throw new AuthorizationError('granted authorization requires basis, issuer and operator attestation');
    result.expiresAt = parseFuture(result.expiresAt);
    result.grantedAt ||= now();
  }
  return Object.freeze(result);
}

export function createCase(input = {}) {
  const name = assertString(input.name, 'case.name');
  const target = createTarget(input.target || { kind: input.type, locator: input.locator || input.value });
  const inferredScope = /^https?:\/\//i.test(target.locator)
    ? { networkMode: 'loopback', origins: [new URL(target.locator).origin] }
    : {};
  const scope = createScope(input.scope || inferredScope);
  const authorization = createAuthorization(input.authorization || { basis: input.basis });
  const createdAt = input.createdAt || now();
  const entity = {
    schema: `${SCHEMA}/case`, id: input.id || id('case'), name, createdAt, updatedAt: createdAt,
    state: authorization.status === 'granted' ? 'authorized' : 'pending_authorization', target, scope, authorization,
    observations: [], evidence: [], findings: [], actions: [], scenarios: [], runs: [], verifications: [], reports: [],
    eventHead: null, metadata: clone(input.metadata || {})
  };
  return Object.freeze(entity);
}

export function grantAuthorization(caseEntity, input = {}) {
  if (caseEntity.state !== 'pending_authorization') throw new TransitionError(`case cannot be authorized from ${caseEntity.state}`);
  const authorization = createAuthorization({ ...input, status: 'granted' });
  return replaceCase(caseEntity, { authorization, state: 'authorized' });
}

export function revokeAuthorization(caseEntity, reason = '') {
  if (caseEntity.state === 'closed') throw new TransitionError('closed case cannot be revoked');
  return replaceCase(caseEntity, { authorization: createAuthorization({ ...caseEntity.authorization, status: 'revoked', constraints: { ...caseEntity.authorization.constraints, reason } }), state: 'blocked' });
}

export function replaceCase(caseEntity, patch) {
  return Object.freeze({ ...clone(caseEntity), ...clone(patch), updatedAt: now() });
}

export function assertAuthorized(caseEntity, actionType, target = caseEntity.target.locator, at = new Date()) {
  const auth = caseEntity.authorization;
  if (caseEntity.state !== 'authorized' && caseEntity.state !== 'active') throw new AuthorizationError('case is not authorized', { state: caseEntity.state });
  if (auth.status !== 'granted' || !isFuture(auth.expiresAt, at)) throw new AuthorizationError('authorization is missing or expired', { expiresAt: auth.expiresAt });
  if (!caseEntity.scope.actions.includes(actionType)) throw new ScopeError(`action is outside the authorized scope: ${actionType}`);
  assertTargetInScope(caseEntity.scope, target, actionType);
}

export function assertTargetInScope(scope, target, actionType = 'custom') {
  const value = String(target);
  if (!/^https?:\/\//i.test(value) && scope.paths.length) {
    if (!scope.paths.some(root => isWithin(root, value))) throw new ScopeError('local target is outside the authorized path roots', { target: value, roots: scope.paths });
  }
  if (scope.network.mode === 'offline' && /^https?:\/\//i.test(value)) throw new ScopeError('offline scope forbids network targets');
  if (scope.network.mode === 'loopback' && /^https?:\/\//i.test(value)) {
    const url = new URL(value);
    if (!isLoopback(url.hostname)) throw new ScopeError('loopback scope requires a loopback target');
    if (scope.network.origins.length && !scope.network.origins.includes(url.origin.toLowerCase())) throw new ScopeError('target origin is outside the allowlist');
  }
  if (scope.network.mode === 'allowlist' && /^https?:\/\//i.test(value)) {
    const origin = new URL(value).origin.toLowerCase();
    if (scope.network.origins.length && !scope.network.origins.includes(origin)) throw new ScopeError('target origin is outside the allowlist');
  }
  if (actionType === 'runtime_capture' || actionType === 'replay') return;
  return true;
}

export function createObservation(input = {}) {
  return Object.freeze({ schema: `${SCHEMA}/observation`, id: input.id || id('obs'), recordedAt: input.recordedAt || now(), type: input.type || 'unknown', source: assertString(input.source || 'unknown', 'observation.source'), target: input.target || null, data: clone(input.data), confidence: clampConfidence(input.confidence ?? 1), limitations: [...(input.limitations || [])] });
}

export function createEvidence(input = {}, previousHash = null) {
  const kind = input.kind || 'observation';
  if (!EVIDENCE_KINDS.includes(kind)) throw new TypeError(`unsupported evidence kind: ${kind}`);
  const payload = { schema: `${SCHEMA}/evidence`, id: input.id || id('evidence'), case_id: input.case_id || input.caseId || null, recordedAt: input.recordedAt || now(), kind, title: assertString(input.title || kind, 'evidence.title'), source: assertString(input.source || input.authority || 'unknown', 'evidence.source'), method: input.method || 'unspecified', target: input.target || null, data: clone(input.data ?? input.content), content: clone(input.content ?? input.data), confidence: clampConfidence(input.confidence ?? 1), limitations: [...(input.limitations || [])], provenance: { parent: previousHash, ...(clone(input.provenance || {})), contentSha256: input.content_sha256 || sha256(input.data ?? input.content), sourceRef: input.sourceRef || null }, parent_ids: [...(input.parent_ids || (previousHash ? [previousHash] : []))] };
  return Object.freeze({ ...payload, hash: sha256(stable(payload)) });
}

export function createFinding(input = {}) {
  const status = input.status || 'open';
  if (!['open', 'confirmed', 'rejected', 'resolved'].includes(status)) throw new TypeError(`unsupported finding status: ${status}`);
  return Object.freeze({ schema: `${SCHEMA}/finding`, id: input.id || id('finding'), createdAt: input.createdAt || now(), title: assertString(input.title, 'finding.title'), statement: assertString(input.statement, 'finding.statement'), status, confidence: clampConfidence(input.confidence ?? 0.5), evidenceIds: [...new Set(input.evidenceIds || [])], tags: [...new Set(input.tags || [])], metadata: clone(input.metadata || {}) });
}

export function createAction(input = {}) {
  const type = input.type || 'custom';
  if (!ACTION_TYPES.includes(type)) throw new TypeError(`unsupported action type: ${type}`);
  return Object.freeze({ schema: `${SCHEMA}/action`, id: input.id || id('action'), type, label: input.label || type, state: input.state || 'planned', requestedAt: input.requestedAt || now(), startedAt: input.startedAt || null, finishedAt: input.finishedAt || null, input: clone(input.input || {}), output: clone(input.output), error: input.error || null, evidenceIds: [...new Set(input.evidenceIds || [])], capability: input.capability || `${type}`, actor: input.actor || 'kernel' });
}

export function createScenario(input = {}) {
  const steps = assertArray(input.steps || [], 'scenario.steps');
  if (steps.length > 500) throw new TypeError('scenario cannot contain more than 500 steps');
  return Object.freeze({ schema: `${SCHEMA}/scenario`, id: input.id || id('scenario'), name: assertString(input.name || 'scenario', 'scenario.name'), createdAt: input.createdAt || now(), seed: input.seed ?? 1, steps: clone(steps), assertions: clone(input.assertions || []), snapshot: input.snapshot || 'page', metadata: clone(input.metadata || {}) });
}

export function createRun(input = {}) {
  const policy = clone(input.policy || input.policy_snapshot || {});
  return Object.freeze({ schema: `${SCHEMA}/run`, id: input.id || id('run'), actionId: assertString(input.actionId, 'run.actionId'), startedAt: input.startedAt || now(), finishedAt: input.finishedAt || null, status: input.status || 'running', policy, policy_snapshot: policy, events: clone(input.events || []), output: clone(input.output), error: input.error || null });
}

export function createVerification(input = {}) {
  const checks = clone(input.checks || []);
  const pass = input.pass == null ? checks.length > 0 && checks.every(item => item.pass === true) : Boolean(input.pass);
  return Object.freeze({ schema: `${SCHEMA}/verification`, id: input.id || id('verification'), createdAt: input.createdAt || now(), scenarioId: input.scenarioId || null, rebuild: input.rebuild || null, pass, checks, claimScope: input.claimScope || 'Only the listed checks and scenario checkpoints were evaluated.', evidenceIds: [...new Set(input.evidenceIds || [])] });
}

export function createReport(input = {}) {
  const body = String(input.body || '');
  const report = { schema: input.schema || `${SCHEMA}/report`, id: input.id || id('report'), createdAt: input.createdAt || now(), caseId: assertString(input.caseId, 'report.caseId'), status: input.status || 'draft', verdict: input.verdict || (input.status === 'READY' ? 'READY' : 'INCOMPLETE'), coverage: clone(input.coverage || { passed: 0, total: 0 }), body, evidenceIds: [...new Set(input.evidenceIds || [])], evidence_ids: [...new Set(input.evidenceIds || [])], verificationIds: [...new Set(input.verificationIds || [])], verification_ids: [...new Set(input.verificationIds || [])] };
  return Object.freeze({ ...report, hash: sha256(stable(report)) });
}

export function appendCase(caseEntity, collection, item) {
  const values = [...(caseEntity[collection] || []), clone(item)];
  return replaceCase(caseEntity, { [collection]: values, state: caseEntity.state === 'authorized' ? 'active' : caseEntity.state });
}

export function completeCase(caseEntity) {
  if (!['authorized', 'active', 'blocked'].includes(caseEntity.state)) throw new TransitionError(`case cannot complete from ${caseEntity.state}`);
  return replaceCase(caseEntity, { state: 'completed' });
}

export function closeCase(caseEntity) {
  if (caseEntity.state === 'pending_authorization') throw new TransitionError('pending case must be authorized or revoked before closing');
  return replaceCase(caseEntity, { state: 'closed' });
}

function clampConfidence(value) { const numeric = Number(value); if (!Number.isFinite(numeric)) return 0; return Math.min(1, Math.max(0, numeric)); }
function normalizeOrigin(value) { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new ScopeError('origins must be bare HTTP(S) origins'); return url.origin.toLowerCase(); }
function normalizeEndpoint(value) { const url = new URL(value); if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ScopeError('CDP endpoint must be HTTP(S)'); if (!isLoopback(url.hostname)) throw new ScopeError('CDP endpoint must use numeric loopback'); return `${url.protocol}//${url.host}`; }
function isLoopback(host) { return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host) || /^0?x?7f/i.test(host); }
