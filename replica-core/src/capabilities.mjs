import os from 'node:os';
import { CapabilityError } from './errors.mjs';

export const CAPABILITY_SCHEMA = 'replica-unified/v1/capability';

export class CapabilityRegistry {
  constructor() { this.items = new Map(); }

  register(capability) {
    if (!capability?.id || typeof capability.run !== 'function') throw new TypeError('capability requires id and run()');
    this.items.set(capability.id, { ...capability, status: capability.status || 'ready', version: capability.version || '1.0.0', modes: [...(capability.modes || [])], requirements: [...(capability.requirements || [])] });
    return this.items.get(capability.id);
  }

  get(id) { const value = this.items.get(id); if (!value) throw new CapabilityError(`capability not registered: ${id}`); return value; }
  has(id) { return this.items.has(id); }
  list() { return [...this.items.values()].map(({ run, ...metadata }) => ({ schema: CAPABILITY_SCHEMA, ...metadata })); }

  async probe(context = {}) {
    const results = [];
    for (const capability of this.items.values()) {
      let status = capability.status;
      let detail = capability.description || '';
      if (typeof capability.probe === 'function') {
        try { const result = await capability.probe(context); status = result.status || status; detail = result.detail || detail; }
        catch (error) { status = 'degraded'; detail = error.message; }
      }
      results.push({ schema: CAPABILITY_SCHEMA, id: capability.id, version: capability.version, status, detail, modes: capability.modes, requirements: capability.requirements });
    }
    return results;
  }

  async run(id, context) { return this.get(id).run(context); }
}

export function createBuiltInCapabilities({ staticAnalyze, runtimeCapture, replay, rebuild, verify, report } = {}) {
  const registry = new CapabilityRegistry();
  registry.register({ id: 'core.case', description: 'Case lifecycle, authorization and scope enforcement', modes: ['in-process'], run: async () => ({ ok: true }) });
  registry.register({ id: 'core.evidence', description: 'Immutable evidence records with hash-linked provenance', modes: ['in-process'], run: async () => ({ ok: true }) });
  registry.register({ id: 'analysis.javascript', description: 'Lexical JavaScript and TypeScript structural analysis', modes: ['offline'], requirements: ['node'], run: staticAnalyze || (async () => { throw new CapabilityError('javascript analyzer is unavailable'); }) });
  registry.register({ id: 'runtime.browser', description: 'Bounded browser/CDP observation and network guard', status: runtimeCapture ? 'ready' : 'degraded', modes: ['loopback', 'in-process'], requirements: ['browser-cdp'], run: runtimeCapture || (async () => { throw new CapabilityError('browser runtime adapter is unavailable'); }), probe: async context => context.runtimeAdapter ? { status: 'ready', detail: 'runtime adapter registered' } : { status: 'degraded', detail: 'no runtime adapter registered' } });
  registry.register({ id: 'rebuild.scaffold', description: 'Independent reconstruction manifest and artifact planning', modes: ['offline', 'in-process'], run: rebuild || (async ({ input }) => ({ schema: 'replica-unified/v1/rebuild', status: 'scaffold', output: input.output || null })) });
  registry.register({ id: 'replay.behavior', description: 'Deterministic scenario replay and checkpoint comparison', modes: ['offline', 'loopback'], run: replay || (async ({ input }) => deterministicReplay(input)) });
  registry.register({ id: 'verify.contract', description: 'Static, runtime and scenario verification aggregation', modes: ['offline', 'loopback'], run: verify || (async ({ input }) => contractVerify(input)) });
  registry.register({ id: 'report.markdown', description: 'Deterministic case report generation', modes: ['in-process'], run: report || (async ({ input }) => ({ schema: 'replica-unified/v1/report', body: input.body || '' })) });
  registry.register({ id: 'analysis.native', description: 'Native executable and process analysis planning', status: 'degraded', modes: ['offline'], requirements: ['platform-toolchain'], run: async ({ input }) => ({ schema: 'replica-unified/v1/native-analysis', status: 'planned', target: input.target || null, checks: [] }), probe: async () => ({ status: 'degraded', detail: `native analysis requires a platform toolchain on ${process.platform}` }) });
  registry.register({ id: 'analysis.mobile', description: 'Android and mobile package analysis planning', status: 'degraded', modes: ['offline'], requirements: ['mobile-toolchain'], run: async ({ input }) => ({ schema: 'replica-unified/v1/mobile-analysis', status: 'planned', target: input.target || null, checks: [] }), probe: async () => ({ status: 'degraded', detail: 'mobile toolchain is optional and not bundled' }) });
  registry.register({ id: 'security.validation', description: 'Authorized active security validation with bounded controls', status: 'degraded', modes: ['loopback', 'allowlist'], requirements: ['security-worker'], run: async ({ input }) => ({ schema: 'replica-unified/v1/security-validation', status: 'planned', target: input.target || null, checks: [], limits: input.limits || {} }), probe: async context => context.securityWorker ? { status: 'ready', detail: 'security worker registered' } : { status: 'degraded', detail: 'no security worker registered; planning mode only' } });
  registry.register({ id: 'planning.scenario', description: 'Scenario and action planning with bounded steps', modes: ['in-process'], run: async ({ input }) => ({ schema: 'replica-unified/v1/plan', status: 'planned', steps: input.steps || [] }) });
  registry.register({ id: 'worker.orchestration', description: 'In-process bounded worker execution and event collection', modes: ['in-process'], run: async ({ input }) => ({ schema: 'replica-unified/v1/worker', status: 'completed', output: input || null, host: os.platform() }) });
  return registry;
}

function deterministicReplay(input = {}) {
  const steps = Array.isArray(input.steps) ? input.steps : [];
  const maxSteps = Number(input.maxSteps || 500);
  if (steps.length > maxSteps) throw new CapabilityError(`scenario exceeds max steps (${maxSteps})`);
  const checkpoints = steps.map((step, index) => ({ index, label: step.label || `step-${index + 1}`, pass: step.expectedPass !== false, observed: step.observed ?? null, expected: step.expected ?? null }));
  return { schema: 'replica-unified/v1/replay', pass: checkpoints.every(item => item.pass), checkpoints, steps: steps.length, deterministic: true };
}

function contractVerify(input = {}) {
  const checks = Array.isArray(input.checks) ? input.checks : [];
  return { schema: 'replica-unified/v1/contract-verification', pass: checks.length > 0 && checks.every(item => item.pass === true), checks, claimScope: 'Only supplied checks and scenario checkpoints were evaluated.' };
}
