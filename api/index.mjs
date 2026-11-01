import express from 'express';
import { connectDb } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';

// Vercel invokes this Node function for every /api/* request. Keep both the
// Mongo client and Express app warm between invocations where the runtime can.
let appPromise;

async function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      process.env.MORGAN_RUNTIME_MODE = 'production';
      if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');

      const { db } = await connectDb(process.env.MONGODB_URI, process.env.MONGODB_DB || 'morgan');
      // Keep the existing migration behavior used by the long-running server.
      await db.collection('users').updateMany(
        { emailVerified: { $exists: false } },
        { $set: { emailVerified: true, emailVerificationLegacy: true } },
      );
      const adminEmail = String(process.env.MORGAN_ADMIN_EMAIL || '').trim().toLowerCase();
      if (adminEmail) await db.collection('users').updateOne({ email: adminEmail }, { $set: { role: 'admin' } });

      const app = express();
      app.use((req, _res, next) => {
        // vercel.json rewrites /api/:path* to this fixed function and carries the
        // original route as __morgan_route. Restore that URL before Express sees it.
        const requestUrl = new URL(req.url, 'http://morgan.internal');
        const routedPath = requestUrl.searchParams.get('__morgan_route');
        if (routedPath) {
          requestUrl.searchParams.delete('__morgan_route');
          const suffix = requestUrl.searchParams.toString();
          req.url = `/api/${routedPath.replace(/^\/+/, '')}${suffix ? `?${suffix}` : ''}`;
        } else if (!req.url.startsWith('/api/')) {
          req.url = `/api/${req.url.replace(/^\/+/, '')}`;
        }
        next();
      });
      app.use(createApp(db, { secureCookies: true, trustProxy: true, csp: true }));
      return app;
    })();
  }

  try { return await appPromise; }
  catch (error) { appPromise = undefined; throw error; }
}

export default async function handler(req, res) {
  try {
    const app = await getApp();
    app(req, res);
  } catch (error) {
    // Avoid writing connection strings or other configuration details to logs.
    console.error('[morgan-api-init]', error?.name || 'Error', error?.code || 'INIT_FAILED');
    if (!res.headersSent) res.status(503).json({ error: 'Morgan’s API could not start. Check its database and server configuration.' });
  }
}
