import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { invokeUnified, UNIFIED_SCHEMA } from './unified.mjs';

const server = new McpServer(
  { name: 'replica', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

const casePath = z.string().min(1).describe('Case directory inside the Replica work folder');
const json = z.unknown();
const optionalParams = z.record(z.string(), z.unknown()).optional();
const responseText = (response) => ({
  content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
  structuredContent: response,
  ...(response.ok === false ? { isError: true } : {}),
});

function register(name, description, inputSchema, operation, map = (input) => input) {
  server.registerTool(name, {
    title: name.replaceAll('_', ' '),
    description,
    inputSchema,
  }, async (input) => {
    try {
      return responseText(await invokeUnified(operation, map(input)));
    } catch (error) {
      return responseText({
        schema: UNIFIED_SCHEMA,
        operation,
        ok: false,
        status: 'failed',
        error: { type: error.name, message: error.message },
      });
    }
  });
}

// Canonical Replica API. These names describe the shared model rather than a
// particular implementation (browser, desktop, native, or mobile).
register('replica_capabilities', 'Describe the unified Replica protocol, objects, operations, and compatibility surface.', {}, 'capabilities');
register('replica_doctor', 'Inspect the unified Replica runtime and optional execution capabilities.', { cdp: z.string().optional(), require_docker: z.boolean().optional() }, 'doctor');
register('replica_case_create', 'Create a pending, authorization-scoped Replica case. An operator must grant authorization separately.', {
  name: z.string().min(1), target: z.union([z.string().min(1), z.object({ kind: z.string().min(1), locator: z.string().min(1) })]), basis: z.string().optional(),
  target_type: z.enum(['web', 'javascript', 'desktop', 'mobile', 'binary']).optional(),
  type: z.enum(['web', 'javascript', 'desktop', 'mobile', 'binary']).optional(),
  version: z.string().optional(), profile: z.enum(['lite', 'standard', 'full']).optional(),
  cdp_endpoints: z.array(z.string()).optional(), metadata: z.record(z.string(), z.unknown()).optional(),
  scope: z.object({ schema: z.string().optional(), actions: z.array(z.string()), targets: z.record(z.string(), z.unknown()).optional(), network: z.record(z.string(), z.unknown()).optional() }).optional(),
}, 'case.create');
register('replica_case_authorize', 'Grant a pending case explicit operator authorization with an expiry.', {
  operator_attestation: z.string().optional(), basis: z.string().min(1).optional(), issuer: z.string().optional(), expires_at: z.string().optional(), case: casePath.optional(),
}, 'case.authorize');
register('replica_case_get', 'Read a case, authorization state, evidence index, scopes, and latest verification.', { case: casePath.optional() }, 'case.get');
register('replica_scope_define', 'Record the declared target scope and allowed actions for a case.', {
  case: casePath,
  scope: z.object({ id: z.string().min(1).optional(), actions: z.array(z.string()).optional(), targets: z.record(z.string(), z.unknown()).optional(), network: z.record(z.string(), z.unknown()).optional(), authorization: z.record(z.string(), z.unknown()).optional() }),
}, 'scope.define');
register('replica_scope_get', 'Read the declared scopes associated with a case.', { case: casePath }, 'scope.get');
register('replica_scope_check', 'Evaluate one action and target against the active case scope.', { case: casePath.optional(), action: z.string().min(1), target: z.string().optional() }, 'scope.check');
register('replica_observe', 'Collect a bounded runtime/browser observation or record a supplied observation.', {
  case: casePath, endpoint: z.string().optional(), page_url: z.string().optional(), navigate: z.string().optional(), duration: z.number().int().positive().optional(),
  title: z.string().optional(), data: json.optional(), kind: z.enum(['observation', 'test', 'network', 'visual', 'limitation']).optional(), source: z.string().optional(),
}, 'observe');
register('replica_analyze', 'Run an authorized static or semantic analysis and attach its findings to the case.', {
  case: casePath, target: z.string().min(1), engine: z.string().optional(), mode: z.string().optional(), options: optionalParams,
}, 'analyze');
register('replica_action', 'Execute one bounded action in the unified Replica execution model.', {
  case: casePath, kind: z.enum(['observe', 'capture', 'analyze', 'rebuild', 'replay', 'verify', 'report']), action: z.string().optional(),
  target: z.string().optional(), output: z.string().optional(), rebuild: z.string().optional(), scenario: z.string().optional(),
  reference_endpoint: z.string().optional(), replica_endpoint: z.string().optional(), reference_page_url: z.string().optional(), replica_page_url: z.string().optional(),
  parameters: optionalParams,
}, 'action', (input) => ({ ...input, ...(input.parameters || {}) }));
register('replica_evidence_add', 'Append a typed, provenance-preserving evidence record to a case.', {
  case: casePath, kind: z.enum(['observation', 'inference', 'test', 'network', 'visual', 'limitation']), title: z.string().min(1), data: json, source: z.string().optional(),
}, 'evidence.add');
register('replica_evidence_append', 'Append a unified evidence record with content hash and provenance.', {
  case: casePath.optional(), action: z.string().optional(), evidence: z.record(z.string(), z.unknown()),
}, 'evidence.append');
register('replica_scenario_define', 'Define a deterministic scenario that can be replayed and verified.', {
  case: casePath, name: z.string().min(1), steps: z.array(z.unknown()), metadata: z.record(z.string(), z.unknown()).optional(),
}, 'scenario.define');
register('replica_run', 'Run a named scenario or bounded execution step against the current case.', {
  case: casePath, kind: z.enum(['observe', 'capture', 'analyze', 'rebuild', 'replay', 'verify', 'report']), action: z.string().optional(),
  endpoint: z.string().optional(), page_url: z.string().optional(), navigate: z.string().optional(), duration: z.number().int().positive().optional(),
  target: z.string().optional(), output: z.string().optional(), rebuild: z.string().optional(), scenario: z.string().optional(),
  reference_endpoint: z.string().optional(), replica_endpoint: z.string().optional(), reference_page_url: z.string().optional(), replica_page_url: z.string().optional(), parameters: optionalParams,
}, 'run', (input) => ({ ...input, ...(input.parameters || {}) }));
register('replica_run_start', 'Start a bounded unified run from input evidence and a declared phase.', {
  case: casePath.optional(), phase: z.enum(['observe', 'analyze', 'rebuild', 'replay', 'verify', 'security']), scenario_id: z.string().optional(), input_evidence_ids: z.array(z.string()).optional(),
}, 'run.start');
register('replica_run_get', 'Read one unified run by id.', { run_id: z.string().min(1) }, 'run.get');
register('replica_verify', 'Run fresh verification for an independent rebuild and record the verdict.', { case: casePath, rebuild: z.string().min(1), scenario: z.string().min(1) }, 'verify');
register('replica_report', 'Generate a provenance-linked report for a case.', { case: casePath, format: z.enum(['markdown', 'json']).optional() }, 'report');
register('replica_report_generate', 'Generate a unified report from completed run ids.', { case: casePath.optional(), run_ids: z.array(z.string()).optional() }, 'report.generate');

// Compatibility aliases for the v0 Workbench MCP. They map to canonical
// operations so old clients do not create a second architecture.
register('replica_init', 'Compatibility alias for replica_case_create.', {
  name: z.string().min(1), target: z.string().min(1), basis: z.string().min(1), type: z.enum(['web', 'javascript', 'desktop', 'mobile', 'binary']).optional(), version: z.string().optional(), profile: z.enum(['lite', 'standard', 'full']).optional(), cdp_endpoints: z.array(z.string()).optional(),
}, 'case.create', (input) => ({ ...input, target_type: input.type }));
register('replica_status', 'Compatibility alias for replica_case_get.', { case: casePath }, 'case.get');
register('replica_capture', 'Compatibility alias for replica_observe.', {
  case: casePath, endpoint: z.string().optional(), page_url: z.string().optional(), navigate: z.string().optional(), duration: z.number().int().positive().optional(), title: z.string().optional(), data: json.optional(), kind: z.enum(['observation', 'test', 'network', 'visual', 'limitation']).optional(),
}, 'observe');
register('replica_add_evidence', 'Compatibility alias for replica_evidence_add.', { case: casePath, kind: z.enum(['observation', 'inference', 'test', 'network', 'visual', 'limitation']), title: z.string().min(1), data: json, source: z.string().optional() }, 'evidence.add');
register('replica_rebuild', 'Compatibility alias for replica_run with kind rebuild.', { case: casePath, output: z.string().min(1) }, 'run', (input) => ({ ...input, kind: 'rebuild' }));
register('replica_replay', 'Compatibility alias for replica_run with kind replay.', { case: casePath, reference_endpoint: z.string().min(1), replica_endpoint: z.string().min(1), reference_page_url: z.string().url(), replica_page_url: z.string().url(), scenario: z.string().min(1) }, 'run', (input) => ({ ...input, kind: 'replay' }));

await server.connect(new StdioServerTransport());
