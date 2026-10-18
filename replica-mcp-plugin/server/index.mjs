import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { invokeAgent } from './workbench.mjs';

const server = new McpServer({ name: 'replica-workbench', version: '0.1.1' }, { capabilities: { tools: {} } });
const casePath = z.string().min(1).describe('Case directory under the workbench work/ folder');
const resultText = (response) => ({ content: [{ type: 'text', text: JSON.stringify(response, null, 2) }], structuredContent: response, ...(response.ok ? {} : { isError: true }) });
const call = (operation, params = {}) => invokeAgent({ schema: 'replica-agent/v1', request_id: `mcp-${Date.now()}-${Math.random().toString(16).slice(2)}`, operation, params });
const register = (name, description, inputSchema, operation, map = (input) => input) => {
  server.registerTool(name, { title: name.replaceAll('_', ' '), description, inputSchema }, async (input) => {
    try { return resultText(await call(operation, map(input))); }
    catch (error) { return resultText({ ok: false, status: 'failed', error: { type: error.name, message: error.message } }); }
  });
};

register('replica_capabilities', 'List available Replica Workbench operations and transport metadata.', {}, 'capabilities');
register('replica_doctor', 'Check local Python, Node, browser, and optional CDP capabilities.', { cdp: z.string().optional(), require_docker: z.boolean().optional() }, 'doctor');
register('replica_init', 'Create a pending case. Authorization must be granted by an operator using the native CLI.', {
  name: z.string().min(1), target: z.string().min(1), basis: z.string().min(1), type: z.enum(['web', 'javascript', 'desktop', 'mobile', 'binary']).optional(), version: z.string().optional(), profile: z.enum(['lite', 'standard', 'full']).optional(), cdp_endpoints: z.array(z.string()).optional(),
}, 'init');
register('replica_status', 'Read case authorization, evidence count, and latest verification.', { case: casePath }, 'status');
register('replica_report', 'Generate or refresh a Markdown report for a case.', { case: casePath }, 'report');
register('replica_analyze', 'Run an authorized static inventory against a target and record evidence.', { case: casePath, target: z.string().min(1), engine: z.enum(['inventory', 'own-static']).optional() }, 'analyze');
register('replica_capture', 'Capture an authorized browser observation, or add non-browser evidence.', {
  case: casePath, endpoint: z.string().optional(), page_url: z.string().optional(), navigate: z.string().optional(), duration: z.number().int().positive().optional(), title: z.string().optional(), data: z.unknown().optional(), kind: z.enum(['observation', 'test', 'network', 'visual', 'limitation']).optional(),
}, 'capture');
register('replica_rebuild', 'Create an independent rebuild scaffold inside work/.', { case: casePath, output: z.string().min(1) }, 'rebuild');
register('replica_replay', 'Run bounded behavior replay between allowlisted loopback browser endpoints.', { case: casePath, reference_endpoint: z.string().min(1), replica_endpoint: z.string().min(1), reference_page_url: z.string().url(), replica_page_url: z.string().url(), scenario: z.string().min(1) }, 'replay');
register('replica_verify', 'Run fresh static and browser verification for an independent rebuild.', { case: casePath, rebuild: z.string().min(1), scenario: z.string().min(1) }, 'verify');
register('replica_add_evidence', 'Append evidence to a case.', { case: casePath, kind: z.enum(['observation', 'inference', 'test', 'network', 'visual', 'limitation']), title: z.string().min(1), data: z.unknown(), source: z.string().optional() }, 'evidence.add');

await server.connect(new StdioServerTransport());
