import crypto from 'node:crypto';
import path from 'node:path';

export const now = () => new Date().toISOString();

export function id(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

export function sha256(value) {
  const data = typeof value === 'string' || Buffer.isBuffer(value)
    ? value
    : JSON.stringify(value);
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function assertString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string`);
  return value.trim();
}

export function assertArray(value, field) {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return value;
}

export function parseFuture(value, field = 'expiresAt') {
  const date = new Date(value);
  if (!value || Number.isNaN(date.valueOf()) || date <= new Date()) throw new TypeError(`${field} must be a future ISO timestamp`);
  return date.toISOString();
}

export function isFuture(value, at = new Date()) {
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date > at;
}

export function isWithin(root, candidate) {
  const rootPath = path.resolve(root);
  const candidatePath = path.resolve(candidate);
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`);
}

export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
