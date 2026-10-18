import readline from 'node:readline';
import { PROTOCOL, ReplicaKernel } from './kernel.mjs';

export function requestEnvelope(operation, params = {}, requestId = `req_${Date.now()}`) {
  return { schema: PROTOCOL, request_id: requestId, operation, params };
}

export async function handleRequest(kernel, request) {
  const envelope = request || {};
  if (envelope.schema && envelope.schema !== PROTOCOL) return failure(envelope, new Error(`unsupported protocol schema: ${envelope.schema}`), 'PROTOCOL_MISMATCH');
  try {
    const result = await kernel.dispatch(envelope.operation, envelope.params || {});
    return { schema: PROTOCOL, request_id: envelope.request_id || null, operation: envelope.operation, ok: true, status: 'completed', result };
  } catch (error) {
    return failure(envelope, error, error.code || error.name || 'REQUEST_FAILED');
  }
}

export async function serveJsonl({ input = process.stdin, output = process.stdout, kernel = new ReplicaKernel() } = {}) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const response = await handleRequest(kernel, JSON.parse(line));
    output.write(`${JSON.stringify(response)}\n`);
  }
}

function failure(request, error, code) { return { schema: PROTOCOL, request_id: request.request_id || null, operation: request.operation || null, ok: false, status: 'failed', error: { code, type: error.name, message: error.message, details: error.details || {} } }; }
