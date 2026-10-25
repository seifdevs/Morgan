import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './validate.mjs';

const scrypt = promisify(_scrypt);
const N = 16384, R = 8, P = 1, KEYLEN = 64;
export const SESSION_COOKIE = 'morgan_sid';
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, n, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p });
  return timingSafeEqual(key, expected);
}

// Precomputed so unknown-email logins cost the same as real ones.
export const DUMMY_HASH = await hashPassword(randomBytes(12).toString('hex'));

export const hashToken = (t) => createHash('sha256').update(t).digest('hex');

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ }
    }
  }
  return out;
}

export function sessionCookie(token, { secure, maxAgeMs = SESSION_TTL_MS }) {
  return [
    `${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`, secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export async function createSession(db, user, req) {
  const token = randomBytes(32).toString('base64url');
  await db.collection('sessions').insertOne({
    _id: hashToken(token),
    userId: user._id,
    businessId: user.businessId,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
  });
  return token;
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'Password must be at least 10 characters');
  if (pw.length > 200) throw new HttpError(400, 'Password is too long');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new HttpError(400, 'Password must include a letter and a number');
  return pw;
}

/** Loads the session from the cookie. businessId always comes from the server-side session, never the client. */
export function loadSession(db) {
  return async (req, _res, next) => {
    try {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (token) {
        const s = await db.collection('sessions').findOne({ _id: hashToken(token), expiresAt: { $gt: new Date() } });
        if (s) {
          const user = await db.collection('users').findOne({ _id: s.userId });
          if (user) { req.user = user; req.businessId = user.businessId; req.sessionId = s._id; }
        }
      }
      next();
    } catch (e) { next(e); }
  };
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in'));
  next();
}

// shortcut: in-memory fixed-window limiter, per process; move to Redis/Mongo if running multiple instances.
const buckets = new Map();
export function rateLimit({ key, limit, windowMs, byEmail = false, failuresOnly = false }) {
  return (req, res, next) => {
    const id = `${key}:${req.ip}:${byEmail ? String(req.body?.email || '').toLowerCase() : ''}`;
    const now = Date.now();
    let b = buckets.get(id);
    if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(id, b); }
    // failuresOnly: successful requests (e.g. correct logins) don't use up the allowance.
    if (failuresOnly) res.on('finish', () => { if (res.statusCode >= 400 && res.statusCode !== 429) b.count++; });
    if ((failuresOnly ? b.count : ++b.count) >= limit + (failuresOnly ? 0 : 1)) {
      const err = new HttpError(429, 'Too many attempts. Please wait and try again.');
      err.retryAfter = Math.ceil((b.reset - now) / 1000);
      return next(err);
    }
    if (buckets.size > 50000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    next();
  };
}
