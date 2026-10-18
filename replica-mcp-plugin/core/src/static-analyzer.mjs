import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './util.mjs';

const EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

export async function analyzeJavaScript({ input }) {
  const root = path.resolve(String(input?.target || input?.path || input));
  const files = collectFiles(root);
  const results = files.map(file => analyzeSource(fs.readFileSync(file, 'utf8'), path.relative(root, file)));
  return { schema: 'replica-unified/v1/static-analysis', input: root, summary: { files: results.length, bytes: results.reduce((sum, item) => sum + item.bytes, 0), functions: results.reduce((sum, item) => sum + item.functions.length, 0), calls: results.reduce((sum, item) => sum + item.calls.length, 0), apiReferences: results.reduce((sum, item) => sum + item.apis.length, 0), risks: results.reduce((sum, item) => sum + item.risks.length, 0) }, files: results };
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

function lineAt(source, offset) { return source.slice(0, offset).split(/\r?\n/).length; }
function mask(source) { return source.replace(/\/\/.*|\/\*[\s\S]*?\*\/|(['"`])(?:\\.|(?!\1)[^\\])*\1/g, match => match.includes('\n') ? match.replace(/[^\n]/g, ' ') : ' '.repeat(match.length)); }
function unique(values, key) { return [...new Map(values.map(item => [key(item), item])).values()].sort((a, b) => key(a).localeCompare(key(b))); }

function analyzeSource(source, file) {
  const clean = mask(source); const functions = []; const calls = []; const apis = []; const risks = [];
  for (const match of clean.matchAll(/\b(?:async\s+)?function\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g)) functions.push({ name: match[1] || '<anonymous>', kind: 'function', parameters: splitParams(match[2]), line: lineAt(source, match.index || 0) });
  for (const match of clean.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/g)) functions.push({ name: match[1], kind: 'arrow', parameters: splitParams(match[2] ?? match[3]), line: lineAt(source, match.index || 0) });
  const ignored = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'new', 'async', 'await']);
  for (const match of clean.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/g)) if (!ignored.has(match[1])) calls.push({ callee: match[1], line: lineAt(source, match.index || 0) });
  for (const [category, regex] of [['dom', /\b(?:document|window|HTMLElement|MutationObserver|IntersectionObserver)\b/g], ['network', /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon)\b/g], ['storage', /\b(?:localStorage|sessionStorage|indexedDB|caches)\b/g], ['timing', /\b(?:setTimeout|setInterval|requestAnimationFrame)\b/g], ['module', /\b(?:import|require|dynamicImport)\b/g]]) for (const match of clean.matchAll(regex)) apis.push({ category, symbol: match[0], line: lineAt(source, match.index || 0) });
  for (const [kind, regex, message] of [['dynamic-code', /\beval\s*\(|\bnew\s+Function\s*\(/g, 'Dynamic code execution can make behavior harder to reproduce.'], ['html-injection', /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\s*=/g, 'HTML sinks should be reviewed for untrusted input.'], ['insecure-transport', /\b(?:http:\/\/|ws:\/\/)/g, 'Clear-text transport reference detected.']]) for (const match of clean.matchAll(regex)) risks.push({ kind, message, line: lineAt(source, match.index || 0) });
  return { path: file, bytes: Buffer.byteLength(source), lines: source.split(/\r?\n/).length, sha256: sha256(source), functions: unique(functions, item => `${item.name}:${item.kind}:${item.line}`), calls: unique(calls, item => `${item.callee}:${item.line}`), apis: unique(apis, item => `${item.category}:${item.symbol}:${item.line}`), risks: unique(risks, item => `${item.kind}:${item.line}`) };
}
function splitParams(value) { return String(value || '').trim() ? String(value).split(',').map(item => item.trim()) : []; }
