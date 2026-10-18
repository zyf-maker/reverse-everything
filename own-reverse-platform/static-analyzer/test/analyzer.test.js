import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze } from '../src/analyzer.js';

test('reports stable structural and browser signals', () => {
  const fixture = path.resolve('test/fixture.sample.js');
  const result = analyze(fixture);
  assert.equal(result.schema, 'own-reverse.static-analysis/v1');
  assert.equal(result.summary.files, 1);
  const item = result.files[0];
  assert.ok(item.functions.some((fn) => fn.name === 'increment'));
  assert.ok(item.functions.some((fn) => fn.name === 'load'));
  assert.ok(item.apis.some((api) => api.category === 'network' && api.symbol === 'fetch'));
  assert.ok(item.apis.some((api) => api.category === 'dom' && api.symbol === 'document'));
  assert.ok(item.apis.some((api) => api.category === 'storage'));
  assert.ok(item.risks.some((risk) => risk.kind === 'html-injection'));
});

test('directory output is sorted and ignores dependency folders', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'own-static-'));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'b.js'), 'function b() {}');
  fs.writeFileSync(path.join(root, 'a.js'), 'function a() {}');
  fs.writeFileSync(path.join(root, 'node_modules', 'ignored.js'), 'function ignored() {}');
  const result = analyze(root);
  assert.deepEqual(result.files.map((item) => item.path), ['a.js', 'b.js']);
});
