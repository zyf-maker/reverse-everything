#!/usr/bin/env node
import { ReplicaKernel } from '../src/kernel.mjs';
import { serveJsonl } from '../src/protocol.mjs';

const kernel = new ReplicaKernel();
if (process.argv.includes('--jsonl') || process.argv.length === 2) await serveJsonl({ kernel });
else {
  const operation = process.argv[2];
  const params = process.argv[3] ? JSON.parse(process.argv[3]) : {};
  const result = await kernel.dispatch(operation, params);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
