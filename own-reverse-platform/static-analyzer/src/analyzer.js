import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

function lineAt(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length;
}

function maskCommentsAndStrings(source) {
  let out = '';
  let state = 'code';
  let quote = '';
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const n = source[i + 1];
    if (state === 'line') {
      out += c === '\n' ? '\n' : ' ';
      if (c === '\n') state = 'code';
      continue;
    }
    if (state === 'block') {
      out += c === '\n' ? '\n' : ' ';
      if (c === '*' && n === '/') { out += ' '; i += 1; state = 'code'; }
      continue;
    }
    if (state === 'string') {
      out += c === '\n' ? '\n' : ' ';
      if (c === '\\') { if (i + 1 < source.length) { out += ' '; i += 1; } continue; }
      if (c === quote) state = 'code';
      continue;
    }
    if (c === '/' && n === '/') { out += '  '; i += 1; state = 'line'; continue; }
    if (c === '/' && n === '*') { out += '  '; i += 1; state = 'block'; continue; }
    if (c === '`' || c === '\"' || c === "'") { quote = c; out += ' '; state = 'string'; continue; }
    out += c;
  }
  return out;
}

function uniqueSorted(items, key = (x) => JSON.stringify(x)) {
  const map = new Map();
  for (const item of items) map.set(key(item), item);
  return [...map.values()].sort((a, b) => key(a).localeCompare(key(b)));
}

function analyzeSource(source, file) {
  const clean = maskCommentsAndStrings(source);
  const functions = [];
  const calls = [];
  const domApis = [];
  const risks = [];
  const addMatches = (regex, fn) => {
    for (const match of clean.matchAll(regex)) fn(match, match.index ?? 0);
  };

  addMatches(/\b(?:async\s+)?function\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g, (m, index) => {
    functions.push({ name: m[1] || '<anonymous>', kind: 'function', parameters: m[2].trim() ? m[2].split(',').map((x) => x.trim()) : [], line: lineAt(source, index) });
  });
  addMatches(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/g, (m, index) => {
    const params = (m[2] ?? m[3] ?? '').trim();
    functions.push({ name: m[1], kind: 'arrow', parameters: params ? params.split(',').map((x) => x.trim()) : [], line: lineAt(source, index) });
  });
  addMatches(/\b([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?function\s*\(([^)]*)\)/g, (m, index) => {
    functions.push({ name: m[1], kind: 'object-method', parameters: m[2].trim() ? m[2].split(',').map((x) => x.trim()) : [], line: lineAt(source, index) });
  });

  const ignored = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'new', 'async', 'await']);
  addMatches(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/g, (m, index) => {
    const name = m[1];
    if (!ignored.has(name) && !name.endsWith('.if')) calls.push({ callee: name, line: lineAt(source, index) });
  });

  const apiPatterns = [
    ['dom', /\b(?:document|window|HTMLElement|MutationObserver|IntersectionObserver)\b/g],
    ['network', /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon)\b/g],
    ['storage', /\b(?:localStorage|sessionStorage|indexedDB|caches)\b/g],
    ['timing', /\b(?:setTimeout|setInterval|requestAnimationFrame)\b/g],
    ['module', /\b(?:import|require|dynamicImport)\b/g]
  ];
  for (const [category, regex] of apiPatterns) addMatches(regex, (m, index) => domApis.push({ category, symbol: m[0], line: lineAt(source, index) }));

  const riskPatterns = [
    ['dynamic-code', /\beval\s*\(|\bnew\s+Function\s*\(/g, 'Dynamic code execution can make behavior harder to reproduce.'],
    ['html-injection', /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\s*=/g, 'HTML sinks should be reviewed for untrusted input.'],
    ['document-write', /\bdocument\.write\s*\(/g, 'Document.write changes parser-time behavior.'],
    ['insecure-transport', /\b(?:http:\/\/|ws:\/\/)/g, 'Clear-text transport reference detected.'],
    ['debugger', /\bdebugger\s*;/g, 'Debugger statement may pause automated execution.']
  ];
  for (const [kind, regex, message] of riskPatterns) addMatches(regex, (_m, index) => risks.push({ kind, message, line: lineAt(source, index) }));

  return {
    path: file,
    bytes: Buffer.byteLength(source),
    lines: source.split(/\r?\n/).length,
    sha256: crypto.createHash('sha256').update(source).digest('hex'),
    functions: uniqueSorted(functions, (x) => `${x.name}:${x.kind}:${x.line}`),
    calls: uniqueSorted(calls, (x) => `${x.callee}:${x.line}`),
    apis: uniqueSorted(domApis, (x) => `${x.category}:${x.symbol}:${x.line}`),
    risks: uniqueSorted(risks, (x) => `${x.kind}:${x.line}`)
  };
}

function collectFiles(input) {
  const stat = fs.statSync(input);
  if (stat.isFile()) return EXTENSIONS.has(path.extname(input).toLowerCase()) ? [input] : [];
  const files = [];
  for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORE.has(entry.name)) continue;
    const full = path.join(input, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(full));
    else if (EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

export function analyze(input, options = {}) {
  const absolute = path.resolve(input);
  const files = collectFiles(absolute);
  const fileResults = files.map((file) => analyzeSource(fs.readFileSync(file, 'utf8'), path.relative(absolute, file) || path.basename(file)));
  const summary = {
    files: fileResults.length,
    bytes: fileResults.reduce((sum, item) => sum + item.bytes, 0),
    functions: fileResults.reduce((sum, item) => sum + item.functions.length, 0),
    calls: fileResults.reduce((sum, item) => sum + item.calls.length, 0),
    apiReferences: fileResults.reduce((sum, item) => sum + item.apis.length, 0),
    risks: fileResults.reduce((sum, item) => sum + item.risks.length, 0)
  };
  return { schema: 'own-reverse.static-analysis/v1', input: absolute, options, summary, files: fileResults };
}

export { analyzeSource };
