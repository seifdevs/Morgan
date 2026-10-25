import express from 'express';
import { createApi, errorHandler } from './api.mjs';

// Production CSP. The Helix chat widget is the only third-party script; Vite dev mode needs inline scripts, so dev skips it.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://helixbots.io https://*.helixbots.io",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https: wss:",
  'frame-src https:',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export function createApp(db, { secureCookies = false, trustProxy = false, csp = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (csp) res.setHeader('Content-Security-Policy', CSP);
    if (secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.get('/api/health', async (_req, res) => {
    try { await db.command({ ping: 1 }); res.json({ ok: true, db: 'up' }); }
    catch { res.status(503).json({ ok: false, db: 'down' }); }
  });
  app.use('/api', createApi(db, { secureCookies }), errorHandler);
  return app;
}
