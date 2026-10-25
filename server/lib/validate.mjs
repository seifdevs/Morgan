import { ObjectId } from 'mongodb';
import { toCents } from '../../shared/money.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = (msg) => new HttpError(400, msg);

export function str(v, field, { min = 0, max = 200, required = false } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw bad(`${field} must be text`);
  v = v.trim();
  if (required && !v) throw bad(`${field} is required`);
  if (v && v.length < min) throw bad(`${field} must be at least ${min} characters`);
  if (v.length > max) throw bad(`${field} must be at most ${max} characters`);
  return v;
}

export function email(v, field = 'Email', required = true) {
  const s = str(v, field, { max: 254, required }).toLowerCase();
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad(`${field} is not a valid email address`);
  return s;
}

export function date(v, field, required = true) {
  if (!required && (v === undefined || v === null || v === '')) return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad(`${field} must be a date (YYYY-MM-DD)`);
  const d = new Date(v + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw bad(`${field} is not a valid date`);
  return v;
}

/** Accepts integer cents (number) or a decimal string. */
export function cents(v, field, { min = -1e13, max = 1e13 } = {}) {
  const c = Number.isInteger(v) ? v : typeof v === 'string' ? toCents(v) : null;
  if (c === null || !Number.isSafeInteger(c)) throw bad(`${field} must be an amount with at most 2 decimals`);
  if (c < min || c > max) throw bad(`${field} is out of range`);
  return c;
}

export function int(v, field, { min = 0, max = 1e9 } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${field} must be a whole number between ${min} and ${max}`);
  return n;
}

export function oneOf(v, field, options) {
  if (!options.includes(v)) throw bad(`${field} must be one of: ${options.join(', ')}`);
  return v;
}

/** Parse a route id; malformed ids are reported as not found so ids can't be probed. */
export function oid(v) {
  if (typeof v !== 'string' || !ObjectId.isValid(v) || String(new ObjectId(v)) !== v) throw new HttpError(404, 'Not found');
  return new ObjectId(v);
}

export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
