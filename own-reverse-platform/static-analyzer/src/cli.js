#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import { analyze } from './analyzer.js';

function usage() {
  process.stderr.write('Usage: rr-static <file-or-directory> [--out result.json]\n');
}

const args = process.argv.slice(2);
if (!args[0] || args.includes('--help')) { usage(); process.exit(args.includes('--help') ? 0 : 2); }
try {
  const result = analyze(args[0]);
  const outIndex = args.indexOf('--out');
  const text = JSON.stringify(result, null, 2) + '\n';
  if (outIndex >= 0 && args[outIndex + 1]) fs.writeFileSync(args[outIndex + 1], text, 'utf8');
  else process.stdout.write(text);
} catch (error) {
  process.stderr.write(`analysis failed: ${error.message}\n`);
  process.exit(1);
}
