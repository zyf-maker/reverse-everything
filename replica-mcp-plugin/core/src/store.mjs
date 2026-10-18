import { createCase, grantAuthorization, appendCase, createEvidence, createFinding, createObservation, createAction, createScenario, createRun, createVerification, createReport, replaceCase, revokeAuthorization } from './model.mjs';
import { ReplicaError } from './errors.mjs';
import { clone, id, now, sha256 } from './util.mjs';

export class CaseStore {
  constructor(seed = []) {
    this.cases = new Map();
    this.events = new Map();
    this.evidenceHeads = new Map();
    for (const value of seed) this.put(value);
  }

  put(caseEntity) {
    if (!caseEntity?.id) throw new TypeError('case entity must have an id');
    this.cases.set(caseEntity.id, clone(caseEntity));
    if (!this.events.has(caseEntity.id)) this.events.set(caseEntity.id, []);
    const latest = [...(caseEntity.evidence || [])].at(-1);
    if (latest?.hash) this.evidenceHeads.set(caseEntity.id, latest.hash);
    return this.get(caseEntity.id);
  }

  get(caseId) {
    const value = this.cases.get(caseId);
    if (!value) throw new ReplicaError(`case not found: ${caseId}`, 'CASE_NOT_FOUND');
    return clone(value);
  }

  has(caseId) { return this.cases.has(caseId); }

  list() { return [...this.cases.values()].map(clone); }

  update(caseId, updater) {
    const current = this.get(caseId);
    const next = typeof updater === 'function' ? updater(current) : replaceCase(current, updater);
    this.put(next);
    return next;
  }

  event(caseId, type, data = {}) {
    const event = { schema: 'replica-unified/v1/event', id: id('event'), at: now(), caseId, type, data: clone(data), previous: this.events.get(caseId)?.at(-1)?.hash || null };
    event.hash = sha256(event);
    const list = this.events.get(caseId) || [];
    list.push(event);
    this.events.set(caseId, list);
    this.update(caseId, current => replaceCase(current, { eventHead: event.hash }));
    return clone(event);
  }

  eventsFor(caseId) { return clone(this.events.get(caseId) || []); }

  authorize(caseId, input) {
    const next = this.update(caseId, current => grantAuthorization(current, input));
    this.event(caseId, 'case.authorized', { authorization: next.authorization });
    return next;
  }

  revoke(caseId, reason) {
    const next = this.update(caseId, current => revokeAuthorization(current, reason));
    this.event(caseId, 'case.revoked', { reason });
    return next;
  }

  addEvidence(caseId, input) {
    const current = this.get(caseId);
    const evidence = createEvidence({ ...input, case_id: caseId }, this.evidenceHeads.get(caseId) || null);
    this.evidenceHeads.set(caseId, evidence.hash);
    const next = this.update(caseId, currentCase => appendCase(currentCase, 'evidence', evidence));
    this.event(caseId, 'evidence.added', { evidenceId: evidence.id, hash: evidence.hash });
    return { case: next, evidence };
  }

  addObservation(caseId, input) {
    const observation = createObservation(input);
    this.update(caseId, current => appendCase(current, 'observations', observation));
    this.event(caseId, 'observation.recorded', { observationId: observation.id });
    return observation;
  }

  addFinding(caseId, input) {
    const finding = createFinding(input);
    this.update(caseId, current => appendCase(current, 'findings', finding));
    this.event(caseId, 'finding.created', { findingId: finding.id });
    return finding;
  }

  addAction(caseId, input) {
    const action = createAction(input);
    this.update(caseId, current => appendCase(current, 'actions', action));
    this.event(caseId, 'action.planned', { actionId: action.id, type: action.type });
    return action;
  }

  updateAction(caseId, actionId, patch) {
    const current = this.get(caseId);
    const actions = current.actions.map(action => action.id === actionId ? { ...action, ...clone(patch) } : action);
    if (!actions.some(action => action.id === actionId)) throw new ReplicaError(`action not found: ${actionId}`, 'ACTION_NOT_FOUND');
    const next = this.update(caseId, { actions });
    this.event(caseId, 'action.updated', { actionId, state: patch.state });
    return next.actions.find(action => action.id === actionId);
  }

  addScenario(caseId, input) {
    const scenario = createScenario(input);
    this.update(caseId, current => appendCase(current, 'scenarios', scenario));
    this.event(caseId, 'scenario.created', { scenarioId: scenario.id });
    return scenario;
  }

  addRun(caseId, input) {
    const run = createRun(input);
    this.update(caseId, current => appendCase(current, 'runs', run));
    this.event(caseId, 'run.created', { runId: run.id, actionId: run.actionId });
    return run;
  }

  updateRun(caseId, runId, patch) {
    const current = this.get(caseId);
    const runs = current.runs.map(run => run.id === runId ? { ...run, ...clone(patch) } : run);
    if (!runs.some(run => run.id === runId)) throw new ReplicaError(`run not found: ${runId}`, 'RUN_NOT_FOUND');
    this.update(caseId, { runs });
    this.event(caseId, 'run.updated', { runId, status: patch.status });
    return runs.find(run => run.id === runId);
  }

  addVerification(caseId, input) {
    const verification = createVerification(input);
    this.update(caseId, current => appendCase(current, 'verifications', verification));
    this.event(caseId, 'verification.recorded', { verificationId: verification.id, pass: verification.pass });
    return verification;
  }

  addReport(caseId, input) {
    const report = createReport({ ...input, caseId });
    this.update(caseId, current => appendCase(current, 'reports', report));
    this.event(caseId, 'report.generated', { reportId: report.id, hash: report.hash });
    return report;
  }

  create(input) {
    const entity = createCase(input);
    if (this.cases.has(entity.id)) throw new ReplicaError(`case already exists: ${entity.id}`, 'CASE_EXISTS');
    this.put(entity);
    this.event(entity.id, 'case.created', { state: entity.state, target: entity.target });
    return this.get(entity.id);
  }
}
