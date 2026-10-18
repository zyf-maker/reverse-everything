import { assertAuthorized, createAction, createScenario, createVerification, appendCase, completeCase } from './model.mjs';
import { AuthorizationError, CapabilityError, ReplicaError } from './errors.mjs';
import { createBuiltInCapabilities } from './capabilities.mjs';
import { analyzeJavaScript } from './static-analyzer.mjs';
import { CaseStore } from './store.mjs';

export const PROTOCOL = 'replica-unified/v1';

const ACTION_TO_CAPABILITY = Object.freeze({
  static_analysis: 'analysis.javascript',
  runtime_capture: 'runtime.browser',
  network_observe: 'runtime.browser',
  rebuild: 'rebuild.scaffold',
  replay: 'replay.behavior',
  verify: 'verify.contract',
  report: 'report.markdown'
});

export class ReplicaKernel {
  constructor({ store = new CaseStore(), capabilities, adapters = {} } = {}) {
    this.store = store;
    this.adapters = adapters;
    this.capabilities = capabilities || createBuiltInCapabilities({ staticAnalyze: analyzeJavaScript, ...adapters });
  }

  async capabilitiesSnapshot() { return { schema: `${PROTOCOL}/capabilities`, protocol: PROTOCOL, capabilities: await this.capabilities.probe(this.adapters), actions: Object.keys(ACTION_TO_CAPABILITY) }; }

  doctor() {
    return { schema: `${PROTOCOL}/doctor`, runtime: { node: process.version, platform: process.platform, arch: process.arch }, store: { cases: this.store.list().length }, security: { authorizationRequired: true, scopeEnforced: true, provenance: 'hash-linked' }, status: 'ready' };
  }

  createCase(input) { return this.store.create(input); }
  getCase(caseId) { return this.store.get(caseId); }
  listCases() { return this.store.list(); }
  scopeCheck(caseId, actionType, target) {
    const current = this.store.get(caseId);
    const normalized = { static: 'static_analysis', runtime: 'runtime_capture', network: 'network_observe' }[actionType] || actionType;
    try { assertAuthorized(current, normalized, target || current.target.locator); return { decision: 'allow', action: actionType, normalized_action: normalized, target: target || current.target.locator, caseId }; }
    catch (error) { return { decision: 'deny', action: actionType, normalized_action: normalized, target: target || current.target.locator, caseId, error: { code: error.code || error.name, message: error.message } }; }
  }
  authorize(caseId, input) { return this.store.authorize(caseId, input); }
  revoke(caseId, reason) { return this.store.revoke(caseId, reason); }

  addEvidence(caseId, input) { return this.store.addEvidence(caseId, input).evidence; }
  addFinding(caseId, input) { return this.store.addFinding(caseId, input); }
  observe(caseId, input = {}) {
    const current = this.store.get(caseId);
    assertAuthorized(current, input.actionType || 'runtime_capture', input.target || current.target.locator);
    const observation = this.store.addObservation(caseId, { ...input, source: input.source || 'kernel.observe' });
    if (input.evidence !== false) this.store.addEvidence(caseId, { kind: input.kind || 'observation', title: input.title || 'Observation', source: input.source || 'kernel.observe', method: input.method || 'observe', target: input.target || current.target.locator, data: observation.data, confidence: observation.confidence, limitations: observation.limitations });
    return observation;
  }

  analyze(caseId, input = {}) { return this.execute(caseId, 'static_analysis', { ...input, target: input.target || this.store.get(caseId).target.locator }); }

  planAction(caseId, input = {}) {
    const actionType = input.type || 'custom';
    const current = this.store.get(caseId);
    if (actionType !== 'custom') assertAuthorized(current, actionType, input.target || current.target.locator);
    const action = this.store.addAction(caseId, createAction({ ...input, type: actionType }));
    return action;
  }

  addScenario(caseId, input) { return this.store.addScenario(caseId, createScenario(input)); }

  async runAction(caseId, actionId, input = {}) {
    const current = this.store.get(caseId);
    const action = current.actions.find(item => item.id === actionId);
    if (!action) throw new ReplicaError(`action not found: ${actionId}`, 'ACTION_NOT_FOUND');
    if (action.type !== 'custom') assertAuthorized(current, action.type, input.target || action.input?.target || current.target.locator);
    const capabilityId = ACTION_TO_CAPABILITY[action.type] || action.capability;
    if (!capabilityId) throw new CapabilityError(`action has no capability: ${action.type}`);
    const capability = this.capabilities.get(capabilityId);
    const run = this.store.addRun(caseId, { actionId: action.id, policy: { authorization: current.authorization, scope: current.scope, target: current.target } });
    this.store.updateAction(caseId, action.id, { state: 'running', startedAt: run.startedAt });
    try {
      const output = await capability.run({ kernel: this, case: this.store.get(caseId), action, input: { ...action.input, ...input }, adapters: this.adapters });
      this.store.updateRun(caseId, run.id, { status: 'succeeded', finishedAt: new Date().toISOString(), output });
      this.store.updateAction(caseId, action.id, { state: 'succeeded', finishedAt: new Date().toISOString(), output });
      const evidence = this.store.addEvidence(caseId, { kind: action.type === 'verify' ? 'test' : 'observation', title: action.label, source: `capability:${capabilityId}`, method: action.type, target: input.target || action.input?.target || this.store.get(caseId).target.locator, data: output }).evidence;
      this.store.updateAction(caseId, action.id, { evidenceIds: [evidence.id] });
      return { action: this.store.get(caseId).actions.find(item => item.id === action.id), run: this.store.get(caseId).runs.find(item => item.id === run.id), output, evidence };
    } catch (error) {
      this.store.updateRun(caseId, run.id, { status: 'failed', finishedAt: new Date().toISOString(), error: { code: error.code || error.name, message: error.message } });
      this.store.updateAction(caseId, action.id, { state: 'failed', finishedAt: new Date().toISOString(), error: { code: error.code || error.name, message: error.message } });
      throw error;
    }
  }

  async execute(caseId, actionType, input = {}) {
    const action = this.planAction(caseId, { type: actionType, label: input.label || actionType, input });
    return this.runAction(caseId, action.id, input);
  }

  async replay(caseId, input) { return this.execute(caseId, 'replay', input); }
  async rebuild(caseId, input) { return this.execute(caseId, 'rebuild', input); }

  async verify(caseId, input = {}) {
    const result = await this.execute(caseId, 'verify', input);
    const verification = this.store.addVerification(caseId, { scenarioId: input.scenarioId || null, rebuild: input.rebuild || null, pass: result.output?.pass === true, checks: result.output?.checks || result.output?.checkpoints || [], evidenceIds: [result.evidence.id] });
    return { ...result, verification };
  }

  async report(caseId, input = {}) {
    const current = this.store.get(caseId);
    assertAuthorized(current, 'report', current.target.locator);
    const body = renderReport(current);
    const ready = current.verifications.length > 0 && current.verifications.every(item => item.pass === true) && current.evidence.every((item, index, all) => index === 0 || item.provenance.parent === all[index - 1].hash);
    const passed = current.verifications.filter(item => item.pass === true).length;
    const report = this.store.addReport(caseId, { schema: `${PROTOCOL}/report/v1`, status: ready ? 'READY' : 'complete', verdict: ready ? 'READY' : 'INCOMPLETE', coverage: { passed, total: current.verifications.length }, body, evidenceIds: current.evidence.map(item => item.id), verificationIds: current.verifications.map(item => item.id) });
    return report;
  }

  async dispatch(operation, params = {}) {
    switch (operation) {
      case 'capabilities': return this.capabilitiesSnapshot();
      case 'doctor': return this.doctor();
      case 'case.create': return this.createCase(params);
      case 'case.get': return this.getCase(params.caseId || params.case);
      case 'case.list': return this.listCases();
      case 'case.authorize': return this.authorize(params.caseId || params.case, params.authorization || params);
      case 'case.revoke': return this.revoke(params.caseId || params.case, params.reason || 'revoked by operator');
      case 'scope.get': return this.getCase(params.caseId || params.case).scope;
      case 'scope.check': return this.scopeCheck(params.caseId || params.case, params.action || params.actionType, params.target);
      case 'evidence.add': return this.addEvidence(params.caseId || params.case, params);
      case 'finding.add': return this.addFinding(params.caseId || params.case, params);
      case 'observe': return this.observe(params.caseId || params.case, params);
      case 'analyze': return this.analyze(params.caseId || params.case, params);
      case 'action.plan': return this.planAction(params.caseId || params.case, params);
      case 'action.run': return this.runAction(params.caseId || params.case, params.actionId, params.input || params);
      case 'scenario.create': return this.addScenario(params.caseId || params.case, params);
      case 'run': return this.runAction(params.caseId || params.case, params.actionId, params.input || {});
      case 'run.get': {
        const current = this.getCase(params.caseId || params.case);
        const run = current.runs.find(item => item.id === params.runId || item.id === params.run_id);
        if (!run) throw new ReplicaError(`run not found: ${params.runId || params.run_id}`, 'RUN_NOT_FOUND');
        return run;
      }
      case 'rebuild': return this.rebuild(params.caseId || params.case, params);
      case 'replay': return this.replay(params.caseId || params.case, params);
      case 'verify': return this.verify(params.caseId || params.case, params);
      case 'report': return this.report(params.caseId || params.case, params);
      case 'events': return this.store.eventsFor(params.caseId || params.case);
      default: throw new ReplicaError(`unsupported operation: ${operation}`, 'UNSUPPORTED_OPERATION');
    }
  }
}

function renderReport(caseEntity) {
  const lines = [`# Replica Case: ${caseEntity.name}`, '', `- Case ID: \`${caseEntity.id}\``, `- State: \`${caseEntity.state}\``, `- Target: \`${caseEntity.target.kind}\` ${caseEntity.target.locator}`, `- Authorization: \`${caseEntity.authorization.status}\``, `- Evidence: ${caseEntity.evidence.length}`, `- Findings: ${caseEntity.findings.length}`, `- Verifications: ${caseEntity.verifications.length}`, '', '## Verification'];
  if (!caseEntity.verifications.length) lines.push('', 'No verification has been recorded.');
  for (const verification of caseEntity.verifications) lines.push('', `- ${verification.pass ? 'PASS' : 'FAIL'} \`${verification.id}\` (${verification.checks.length} checks)`);
  lines.push('', '## Evidence');
  for (const evidence of caseEntity.evidence) lines.push('', `- \`${evidence.kind}\` ${evidence.title} — ${evidence.source} — hash \`${evidence.hash.slice(0, 16)}\``);
  lines.push('', 'Claim scope: only the listed observations, evidence and verification checkpoints were evaluated.');
  return `${lines.join('\n')}\n`;
}
