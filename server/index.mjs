import express from 'express';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { connectDb } from './db.mjs';
import { createApp } from './app.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const prod = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';

/** Fail fast with a clear message instead of a stack trace. Never prints secret values. */
export function checkEnv(env, { uri, production = false } = {}) {
  const problems = [];
  if (!uri) problems.push('MONGODB_URI is not set. Add it to .env (see .env.example), or run `npm run dev:local` for a local database.');
  else if (!/^mongodb(\+srv)?:\/\//.test(uri)) problems.push('MONGODB_URI must start with mongodb:// or mongodb+srv://');
  if (env.MONGODB_DB && !/^[A-Za-z0-9_-]{1,63}$/.test(env.MONGODB_DB)) problems.push('MONGODB_DB may only contain letters, numbers, - and _');
  if (env.PORT && !(Number.isInteger(+env.PORT) && +env.PORT > 0 && +env.PORT < 65536)) problems.push('PORT must be a number between 1 and 65535');
  if (!!env.RESEND_API_KEY !== !!env.MAIL_FROM) problems.push('Set both RESEND_API_KEY and MAIL_FROM to enable email, or neither');
  if (env.RESEND_API_KEY && env.MAIL_FROM && !env.APP_URL) problems.push('APP_URL is required when Resend email is enabled so verification links point back to the site');
  if (env.TRUST_PROXY && !['0', '1'].includes(env.TRUST_PROXY)) problems.push('TRUST_PROXY must be 0 or 1');
  if (env.APP_URL && !/^https?:\/\/[^/\s]+$/.test(env.APP_URL.replace(/\/$/, ''))) problems.push('APP_URL must be the public site origin, e.g. https://app.example.com');
  if (production && env.RESEND_API_KEY && env.APP_URL && !env.APP_URL.startsWith('https://')) problems.push('APP_URL must use HTTPS when Resend email is enabled in production');
  if (env.MORGAN_ADMIN_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.MORGAN_ADMIN_EMAIL.trim())) problems.push('MORGAN_ADMIN_EMAIL must be a valid email address');
  return problems;
}

export async function start({ uri = process.env.MONGODB_URI, dbName = process.env.MONGODB_DB || 'morgan' } = {}) {
  // Mail development fallbacks are enabled only from this resolved server mode.
  process.env.MORGAN_RUNTIME_MODE = prod ? 'production' : 'development';
  const problems = checkEnv(process.env, { uri, production: prod });
  if (problems.length) {
    console.error('Configuration error:\n- ' + problems.join('\n- '));
    process.exit(1);
  }
  let db;
  try {
    ({ db } = await connectDb(uri, dbName));
  } catch (e) {
    // Driver messages don't include the password; print host-level detail only.
    console.error(`Could not connect to MongoDB (database "${dbName}"): ${e.message}`);
    console.error('Check MONGODB_URI, the database user\'s password, and that this machine\'s IP is on the Atlas access list.');
    process.exit(1);
  }
  // Accounts created before verification existed have no verification state. Preserve those
  // existing workspaces during rollout; all new registrations start false and must verify.
  await db.collection('users').updateMany({ emailVerified: { $exists: false } }, { $set: { emailVerified: true, emailVerificationLegacy: true } });
  const adminEmail = String(process.env.MORGAN_ADMIN_EMAIL || '').trim().toLowerCase();
  if (adminEmail) await db.collection('users').updateOne({ email: adminEmail }, { $set: { role: 'admin' } });
  const app = createApp(db, { secureCookies: prod, trustProxy: process.env.TRUST_PROXY === '1', csp: prod });

  if (prod) {
    const dist = resolve(root, 'dist');
    if (!existsSync(resolve(dist, 'index.html')) || !existsSync(resolve(dist, 'spa.html'))) throw new Error('dist/ not found or missing spa.html. Run `npm run build` first.');
    app.use('/assets', express.static(resolve(dist, 'assets'), { maxAge: '1y', immutable: true, fallthrough: false }));
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    const publicDocuments = new Map([
      ['/', 'index.html'], ['/features', 'seo-pages/features.html'], ['/product', 'seo-pages/features.html'], ['/pricing', 'seo-pages/pricing.html'],
      ['/about', 'seo-pages/about.html'], ['/resources', 'seo-pages/resources.html'], ['/faq', 'seo-pages/faq.html'], ['/contact', 'seo-pages/contact.html'],
      ['/agency-financial-management', 'seo-pages/agency-financial-management.html'], ['/agency-cash-flow', 'seo-pages/agency-cash-flow.html'],
      ['/agency-profitability', 'seo-pages/agency-profitability.html'], ['/not-found', '404.html'],
    ]);
    app.get('*', (req, res) => {
      let file = publicDocuments.get(req.path);
      const resource = /^\/resources\/([a-z0-9-]+)$/.exec(req.path);
      if (!file && resource) {
        const candidate = resolve(dist, `seo-pages/resources-${resource[1]}.html`);
        if (existsSync(candidate)) file = `seo-pages/resources-${resource[1]}.html`;
      }
      // Prerendered marketing pages keep their SEO markup. Private, auth and other
      // client routes must start from the empty SPA shell before React hydrates.
      res.setHeader('Cache-Control', 'no-cache').sendFile(resolve(dist, file || 'spa.html'));
    });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  const port = Number(process.env.PORT || 4173);
  app.listen(port, () => console.log(`Morgan ${prod ? '(production)' : '(dev)'} on http://localhost:${port} · database "${dbName}"`));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) start();
