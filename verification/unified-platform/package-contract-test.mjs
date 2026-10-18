import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const packageRoot = path.resolve(process.argv[2] || process.env.REPLICA_UNIFIED_PACKAGE || '');
if (!process.argv[2] && !process.env.REPLICA_UNIFIED_PACKAGE) {
  console.error('Usage: node verification/unified-platform/package-contract-test.mjs <extracted-package>');
  process.exit(2);
}
const manifestPath = path.join(packageRoot, 'manifest.json');
assert(fs.existsSync(manifestPath), `manifest.json is missing from ${packageRoot}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.schema, 'replica-unified/package/v1');
assert.equal(manifest.self_contained, true, 'package must declare self_contained=true');
assert.equal(manifest.mcp?.transport, 'stdio');
assert.equal(manifest.entry?.server, 'server/index.mjs');
assert.equal(typeof manifest.entry?.node, 'string');
for (const relative of manifest.required_files || []) {
  assert(fs.existsSync(path.join(packageRoot, relative)), `required package path is missing: ${relative}`);
}
assert(fs.existsSync(path.join(packageRoot, manifest.entry.server)));
assert(fs.existsSync(path.join(packageRoot, manifest.entry.node)));
assert(fs.existsSync(path.join(packageRoot, 'licenses')));
assert((manifest.optional_providers || []).every(provider => provider && typeof provider.id === 'string'));
console.log(JSON.stringify({ ok: true, package: packageRoot, schema: manifest.schema,
  version: manifest.version, platform: manifest.platform, required_files: manifest.required_files?.length || 0,
  optional_providers: (manifest.optional_providers || []).map(provider => provider.id) }, null, 2));
