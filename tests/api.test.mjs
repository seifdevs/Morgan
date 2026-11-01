import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDb } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { hashToken } from '../server/lib/auth.mjs';

let mongod, client, server, base, db, realFetch, originalEnv;
const resendRequests = [];
let resendFailure = null;

before(async () => {
  originalEnv = Object.fromEntries(['RESEND_API_KEY', 'MAIL_FROM', 'APP_URL', 'MORGAN_ADMIN_EMAIL'].map((k) => [k, process.env[k]]));
  Object.assign(process.env, { RESEND_API_KEY: 're_test_suite_only', MAIL_FROM: 'Morgan <no-reply@example.test>', APP_URL: 'https://app.example.test', MORGAN_ADMIN_EMAIL: 'seifeldinashrafa@gmail.com' });
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://api.resend.com/emails')) {
      const request = JSON.parse(init.body); resendRequests.push(request);
      if (resendFailure) return new Response(JSON.stringify(resendFailure.body), { status: resendFailure.status, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ id: `resend_test_${resendRequests.length}` }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(input, init);
  };
  mongod = await MongoMemoryServer.create();
  ({ client, db } = await connectDb(mongod.getUri(), 'morgan_test'));
  server = createApp(db, { trustProxy: true }).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  server?.close(); await client?.close(); await mongod?.stop();
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(originalEnv || {})) value === undefined ? delete process.env[key] : process.env[key] = value;
});

/** Tiny cookie-jar client. */
function agent() {
  let cookie = '';
  const ip = `10.0.0.${Math.floor(Math.random() * 250) + 1}`; // each agent is a distinct client for rate limiting
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-morgan-csrf': '1', 'x-forwarded-for': ip, ...(cookie && { cookie }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()), headers: res.headers };
  };
  return { call, get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
}

const rawReg = (a, email, extra = {}) => a.call('POST', '/auth/register', { name: 'Owner', email, password: 'correct horse 42', businessName: 'Biz ' + email, ...extra });
async function tokenFromLatest(email, subject = 'Verify your Morgan email') {
  const msg = [...resendRequests].reverse().find((m) => m.to?.includes(email.toLowerCase()) && m.subject === subject);
  assert.ok(msg, `expected a Resend request for ${subject}`);
  const match = new RegExp(`${subject.startsWith('Reset') ? 'reset-password' : 'verify-email'}\\?token=([\\w-]+)`).exec(msg.text);
  assert.ok(match, 'email includes a one-time link');
  return match[1];
}
async function reg(a, email, extra = {}) {
  const created = await rawReg(a, email, extra);
  if (created.status === 201) assert.ok(a.cookie, 'signup creates an authenticated session');
  return created;
}
async function issueVerification(user, expiresAt = new Date(Date.now() + 24 * 3600e3)) {
  const token = randomBytes(32).toString('base64url');
  await db.collection('users').updateOne({ _id: user._id }, { $set: { emailVerified: false } });
  await db.collection('verificationTokens').insertOne({ _id: hashToken(token), userId: user._id, expiresAt });
  return token;
}
const statementFile = Buffer.from('Date,Description,Amount\n2026-10-01,Sample row,1.00').toString('base64');

test('registration validates input and rejects duplicates', async () => {
  const a = agent();
  assert.equal((await reg(a, 'bad-email')).status, 400);
  assert.equal((await a.call('POST', '/auth/register', { name: 'x', email: 'w@x.io', password: 'short', businessName: 'B' })).status, 400);
  const ok = await rawReg(a, 'Alice@Example.com');
  assert.equal(ok.status, 201);
  assert.equal(ok.body.user.email, 'alice@example.com');
  assert.ok(ok.body.business.id);
  assert.ok(a.cookie, 'signup immediately creates a financial workspace session');
  const stored = await db.collection('users').findOne({ email: 'alice@example.com' });
  assert.equal(stored.emailVerified, true);
  assert.equal(await db.collection('verificationTokens').countDocuments({ userId: stored._id }), 0);
  assert.ok(!resendRequests.some((m) => m.subject === 'Verify your Morgan email' && m.to.includes('alice@example.com')));
  assert.equal((await a.call('GET', '/transactions')).status, 200, 'new account can use the workspace without email confirmation');
  assert.equal((await rawReg(agent(), 'alice@example.com')).status, 409);
  const tz = await reg(agent(), 'tz@example.com', { timezone: 'Pacific/Kiritimati' });
  assert.equal(tz.body.business.timezone, 'Pacific/Kiritimati');
  assert.equal((await reg(agent(), 'tz2@example.com', { timezone: 'Not/AZone' })).body.business.timezone, 'UTC');
  assert.match(stored.passwordHash, /^scrypt\$/);
});

test('signup succeeds without sending email when the provider is unavailable', async () => {
  const a = agent();
  resendFailure = { status: 403, body: { statusCode: 403, name: 'validation_error', message: 'You can only send testing emails to your own email address (owner@example.com). Verify a domain at resend.com/domains.' } };
  const result = await rawReg(a, 'kept@example.com');
  resendFailure = null;
  assert.equal(result.status, 201);
  assert.ok(result.body.user);
  assert.ok(a.cookie);
  const user = await db.collection('users').findOne({ email: 'kept@example.com' });
  assert.ok(user, 'account creation is independent of Resend');
  assert.equal(user.emailVerified, true);
  assert.equal(await db.collection('verificationTokens').countDocuments({ userId: user._id }), 0);
  assert.equal(await db.collection('emailEvents').countDocuments({ kind: 'verification' }), 0);
  assert.equal((await a.call('POST', '/auth/login', { email: 'kept@example.com', password: 'correct horse 42' })).status, 200);
});

test('verification handles invalid, expired, used links and resend requests', async () => {
  const a = agent();
  const created = await rawReg(a, 'verify-lifecycle@example.com');
  assert.equal(created.status, 201);
  assert.equal((await a.call('POST', '/auth/verify-email', { token: 'invalid-token' })).status, 400);
  const user = await db.collection('users').findOne({ email: 'verify-lifecycle@example.com' });
  const expired = await issueVerification(user, new Date(Date.now() - 1000));
  assert.equal((await a.call('POST', '/auth/verify-email', { token: expired })).status, 400);
  const beforeResend = resendRequests.length;
  const resend = await a.call('POST', '/auth/resend-verification', { email: 'verify-lifecycle@example.com' });
  assert.equal(resend.body.emailStatus, 'accepted');
  assert.equal(resendRequests.length, beforeResend + 1);
  const fresh = await tokenFromLatest('verify-lifecycle@example.com');
  const verified = await a.call('POST', '/auth/verify-email', { token: fresh });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.welcomeEmail.status, 'accepted');
  assert.ok(resendRequests.some((m) => m.subject === 'Welcome to Morgan' && m.to.includes('verify-lifecycle@example.com')));
  assert.equal((await a.call('POST', '/auth/verify-email', { token: fresh })).status, 400, 'used verification token cannot be replayed');
  assert.equal((await a.call('POST', '/auth/resend-verification', { email: 'verify-lifecycle@example.com' })).body.emailStatus, 'unknown', 'verified addresses do not receive another verification link');
});

test('login, session persistence, logout invalidates the session server-side', async () => {
  const a = agent();
  assert.equal((await a.call('POST', '/auth/login', { email: 'alice@example.com', password: 'wrong password 1' })).status, 401);
  assert.equal((await a.call('POST', '/auth/login', { email: 'nobody@example.com', password: 'whatever 123' })).status, 401);
  const ok = await a.call('POST', '/auth/login', { email: 'ALICE@example.com', password: 'correct horse 42' });
  assert.equal(ok.status, 200);
  const stolen = a.cookie;
  assert.equal((await a.call('GET', '/auth/me')).body.user.email, 'alice@example.com');
  assert.equal((await a.call('POST', '/auth/logout')).status, 200);
  const replay = agent(); replay.cookie = stolen;
  assert.equal((await replay.call('GET', '/auth/me')).body.user, null);
  assert.equal((await replay.call('GET', '/transactions')).status, 401);
  const disabled = await reg(agent(), 'disabled@example.com');
  assert.equal(disabled.status, 201);
  await db.collection('users').updateOne({ email: 'disabled@example.com' }, { $set: { status: 'disabled' } });
  assert.equal((await agent().call('POST', '/auth/login', { email: 'disabled@example.com', password: 'wrong password 1' })).status, 401);
  assert.equal((await agent().call('POST', '/auth/login', { email: 'disabled@example.com', password: 'correct horse 42' })).status, 403);
});

test('administrator role is database-backed and protected on the API', async () => {
  const admin = agent(), regular = agent();
  const createdAdmin = await reg(admin, 'seifeldinashrafa@gmail.com');
  assert.equal(createdAdmin.body.user.role, 'admin');
  assert.equal((await db.collection('users').findOne({ email: 'seifeldinashrafa@gmail.com' })).role, 'admin');
  assert.equal((await admin.call('GET', '/admin/overview')).status, 200);
  assert.ok(Number.isInteger((await admin.call('GET', '/admin/overview')).body.users));
  await reg(regular, 'normal-user@example.com');
  assert.equal((await regular.call('GET', '/admin/overview')).status, 403, 'server denies ordinary authenticated users');
  assert.equal((await agent().call('GET', '/admin/overview')).status, 401, 'server denies unauthenticated requests');
});

test('state-changing requests require the CSRF header', async () => {
  const a = agent();
  const r = await a.call('POST', '/auth/login', { email: 'alice@example.com', password: 'correct horse 42' }, { 'x-morgan-csrf': '0' });
  assert.equal(r.status, 403);
});

test('login is rate limited on failures only', async () => {
  const a = agent();
  let last;
  for (let i = 0; i < 10; i++) last = await a.call('POST', '/auth/login', { email: 'ratelimit@example.com', password: 'nope nope 1' });
  assert.equal(last.status, 429);
  // Regression: repeated successful logins must not lock the owner out.
  const ok = agent();
  for (let i = 0; i < 12; i++) assert.equal((await ok.call('POST', '/auth/login', { email: 'alice@example.com', password: 'correct horse 42' })).status, 200);
  // Rotating emails from one IP is capped too.
  const spray = agent();
  let s;
  for (let i = 0; i < 32; i++) s = await spray.call('POST', '/auth/login', { email: `victim${i}@example.com`, password: 'guess guess 1' });
  assert.equal(s.status, 429);
});

test('oversized and non-string credentials are rejected without hashing', async () => {
  const a = agent();
  assert.equal((await a.call('POST', '/auth/login', { email: 'alice@example.com', password: 'x'.repeat(100000) })).status, 401);
  assert.equal((await a.call('POST', '/auth/login', { email: { $ne: null }, password: { $ne: null } })).status, 401);
});

test('query operators in filters are not passed to MongoDB', async () => {
  const a = agent();
  await reg(a, 'nosql@example.com');
  await a.call('POST', '/transactions', { date: '2026-10-01', description: 'x', category: 'Rent', amount: '5', type: 'expense' });
  const r = await fetch(`${base}/transactions?category[$ne]=nothing&vendor[$gt]=`, { headers: { cookie: a.cookie } });
  const body = await r.json();
  // Object-valued params are ignored, never turned into operators.
  assert.equal(r.status, 200);
  assert.equal(body.total, 1);
  assert.equal((await fetch(`${base}/transactions?from[$gt]=`, { headers: { cookie: a.cookie } })).status, 400);
});

test('invoice numbers skip ahead after a prefix change collides', async () => {
  const a = agent();
  await reg(a, 'prefix@example.com');
  const c = await a.call('POST', '/customers', { name: 'C' });
  const mk = () => a.call('POST', '/invoices', { customerId: c.body.id, issueDate: '2026-10-01', dueDate: '2026-10-02', items: [{ description: 'x', quantity: 1, unitCents: 1 }] });
  const biz = { name: 'P', currency: 'USD', invoicePrefix: 'A-', defaultTaxRateBps: 0, paymentTermsDays: 14, openingBalanceCents: 0 };
  await a.call('PATCH', '/business', { ...biz, invoicePrefix: 'A-00' });
  assert.equal((await mk()).body.number, 'A-000001');
  await a.call('PATCH', '/business', { ...biz, invoicePrefix: 'A-000' }); // next would be A-000 + 0002
  await db.collection('invoices').updateOne({ number: 'A-000001' }, { $set: { number: 'A-0000002' } });
  const n = await mk();
  assert.equal(n.status, 201);
  assert.notEqual(n.body.number, 'A-0000002');
});

test('account deletion password attempts are rate limited', async () => {
  const a = agent();
  await reg(a, 'deleter@example.com');
  let last;
  for (let i = 0; i < 6; i++) last = await a.call('DELETE', '/account', { password: 'wrong wrong 1' });
  assert.equal(last.status, 429);
  assert.equal((await a.call('GET', '/auth/me')).body.user.email, 'deleter@example.com');
});

test('production headers: CSP, HSTS, secure cookie, health check', async () => {
  const prodServer = createApp(db, { secureCookies: true, csp: true }).listen(0);
  const url = `http://127.0.0.1:${prodServer.address().port}/api`;
  try {
    const h = await fetch(url + '/health');
    assert.deepEqual(await h.json(), { ok: true, db: 'up' });
    assert.match(h.headers.get('content-security-policy'), /default-src 'self'.*frame-ancestors 'none'/);
    assert.match(h.headers.get('strict-transport-security'), /max-age/);
    const r = await fetch(url + '/auth/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-morgan-csrf': '1' }, body: JSON.stringify({ name: 'S', email: 'secure@example.com', password: 'correct horse 42', businessName: 'S' }) });
    assert.equal(r.status, 201);
    assert.match(r.headers.get('set-cookie'), /; Secure/, 'registration issues the authenticated session over a secure cookie');
    const login = await fetch(url + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-morgan-csrf': '1' }, body: JSON.stringify({ email: 'secure@example.com', password: 'correct horse 42' }) });
    assert.match(login.headers.get('set-cookie'), /; Secure/);
  } finally { prodServer.close(); }
});

test('full invoice workflow with exact money math, PDF and payments', async () => {
  const a = agent();
  await reg(a, 'bob@example.com');
  const cust = await a.call('POST', '/customers', { name: 'Cedar House', email: 'ap@cedar.io' });
  assert.equal(cust.status, 201);
  const inv = await a.call('POST', '/invoices', {
    customerId: cust.body.id, issueDate: '2026-10-01', dueDate: '2026-10-15', taxRateBps: 825, discountCents: 11,
    items: [{ description: 'Design', quantity: 2, unitCents: 1005 }, { description: 'Fee', quantity: 1, unitCents: 1 }],
  });
  assert.equal(inv.status, 201);
  assert.deepEqual(inv.body.totals, { subtotal: 2011, discount: 11, tax: 165, total: 2165 });
  assert.equal(inv.body.number, 'INV-0001');
  assert.equal(inv.body.displayStatus, 'draft');
  const id = inv.body.id;

  assert.equal((await a.call('POST', `/invoices/${id}/payments`, { amountCents: 100 })).status, 400, 'no payment on draft');
  const send = await a.call('POST', `/invoices/${id}/send`, {});
  assert.equal(send.status, 200, 'provider acceptance is returned by the mail integration');
  assert.ok(send.body.emailId);
  assert.equal((await a.call('GET', `/invoices/${id}`)).body.status, 'sent');

  const sent = await a.call('GET', `/invoices/${id}`);
  assert.equal(sent.body.displayStatus, 'overdue');
  assert.equal((await a.call('GET', '/overview')).body.cash, null, 'without a dated balance point, an invoice cannot establish available cash');
  const pdf = await a.call('GET', `/invoices/${id}/pdf`);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
  // Every xref offset must point at its "N 0 obj" header, and startxref at the xref table.
  const raw = pdf.body.toString('latin1');
  const xrefAt = Number(/startxref\n(\d+)/.exec(raw)[1]);
  assert.ok(raw.startsWith('xref', xrefAt));
  [...raw.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].forEach((m, i) => assert.ok(raw.startsWith(`${i + 1} 0 obj`, Number(m[1]))));
  assert.match(raw, /Cedar House/);

  assert.equal((await a.call('POST', `/invoices/${id}/payments`, { amount: '21.66' })).status, 400, 'overpayment rejected');
  const p1 = await a.call('POST', `/invoices/${id}/payments`, { amount: '10.00', date: '2026-10-20' });
  assert.equal(p1.body.balanceDue, 1165);
  assert.equal(p1.body.displayStatus, 'overdue');
  assert.equal((await a.call('GET', '/overview')).body.cash, null, 'payment movement does not invent the starting cash balance');
  const p2 = await a.call('POST', `/invoices/${id}/payments`, { amountCents: 1165, date: '2026-10-21' });
  assert.equal(p2.body.status, 'paid');
  assert.equal(p2.body.balanceDue, 0);
  assert.equal((await a.call('GET', '/overview')).body.cash, null);

  const txns = await a.call('GET', '/transactions');
  assert.equal(txns.body.total, 2);
  assert.equal(txns.body.income, 2165);
  // Linked payment transactions cannot be edited directly.
  assert.equal((await a.call('DELETE', `/transactions/${txns.body.items[0].id}`)).status, 400);
  // Removing a payment reopens the invoice and removes its transaction.
  const reopened = await a.call('DELETE', `/invoices/${id}/payments/${p2.body.payments[1].id}`);
  assert.equal(reopened.body.status, 'sent');
  assert.equal((await a.call('GET', '/transactions')).body.total, 1);
});

test('business data is strictly isolated between accounts', async () => {
  const a = agent(), b = agent();
  await reg(a, 'carol@example.com');
  await reg(b, 'dave@example.com');
  const t = await a.call('POST', '/transactions', { date: '2026-10-01', description: 'Rent', vendor: 'Harbor', category: 'Rent', amount: '1850.00', type: 'expense' });
  assert.equal(t.body.amountCents, -185000);
  const c = await a.call('POST', '/customers', { name: 'Private Co' });
  const inv = await a.call('POST', '/invoices', { customerId: c.body.id, issueDate: '2026-10-01', dueDate: '2026-11-01', items: [{ description: 'x', quantity: 1, unitCents: 500 }] });

  assert.equal((await b.call('GET', '/transactions')).body.total, 0);
  assert.equal((await b.call('GET', '/invoices')).body.length, 0);
  assert.equal((await b.call('GET', `/invoices/${inv.body.id}`)).status, 404);
  assert.equal((await b.call('GET', `/invoices/${inv.body.id}/pdf`)).status, 404);
  assert.equal((await b.call('PATCH', `/transactions/${t.body.id}`, { date: '2026-10-01', description: 'hacked', amount: '1', type: 'income' })).status, 404);
  assert.equal((await b.call('DELETE', `/transactions/${t.body.id}`)).status, 404);
  assert.equal((await b.call('DELETE', `/customers/${c.body.id}`)).status, 404);
  // b cannot invoice a's customer.
  assert.equal((await b.call('POST', '/invoices', { customerId: c.body.id, issueDate: '2026-10-01', dueDate: '2026-11-01', items: [{ description: 'x', quantity: 1, unitCents: 1 }] })).status, 400);
  // Client-supplied businessId is ignored.
  const sneaky = await b.call('POST', '/transactions', { businessId: 'x', date: '2026-10-02', description: 'mine', amount: '5', type: 'income' });
  assert.equal(sneaky.status, 201);
  assert.equal((await a.call('GET', '/transactions')).body.total, 1);
});

test('bank accounts isolate data and statement imports are reviewed, persistent and deduplicated', async () => {
  const a = agent(), b = agent();
  await reg(a, 'bank-a@example.com'); await reg(b, 'bank-b@example.com');
  const created = await a.call('POST', '/bank-accounts', { institution: 'North Bank', name: 'Operating', type: 'checking', currency: 'USD', accountNumber: '001234', openingBalanceCents: 100000, openingBalanceDate: '2026-09-01' });
  assert.equal(created.status, 201); assert.equal(created.body.maskedIdentifier, '•••• 1234'); assert.equal('accountNumber' in created.body, false);
  const rows = [{ date: '2026-09-12', description: 'Studio rent', vendor: 'Studio', amountCents: -25000, currency: 'USD', reference: 'R-12', runningBalanceCents: 75000 }];
  const preview = await a.call('POST', '/bank-statements/preview', { accountId: created.body.id, statementPeriodStart: '2026-09-01', statementPeriodEnd: '2026-09-30', openingBalanceCents: 100000, closingBalanceCents: 75000, rows });
  assert.equal(preview.status, 200); assert.equal(preview.body.summary.discrepancyCents, 0); assert.equal(preview.body.rows[0].duplicate, false);
  const invalidFile = await a.call('POST', '/bank-statements/import', { accountId: created.body.id, filename: 'statement.pdf', sourceFileBase64: statementFile, rows });
  assert.equal(invalidFile.status, 400, 'file contents must match their extension before anything is persisted');
  assert.equal(await db.collection('statementImports').countDocuments({ filename: 'statement.pdf' }), 0);
  const imported = await a.call('POST', '/bank-statements/import', { accountId: created.body.id, filename: 'october.csv', sourceFileBase64: statementFile, statementPeriodStart: '2026-09-01', statementPeriodEnd: '2026-09-30', openingBalanceCents: 100000, closingBalanceCents: 75000, rows });
  assert.equal(imported.status, 201); assert.equal(imported.body.imported, 1);
  assert.equal(imported.body.emailNotification.status, 'accepted', 'statement import confirmation was accepted by the provider');
  const repeat = await a.call('POST', '/bank-statements/import', { accountId: created.body.id, filename: 'different-name.csv', sourceFileBase64: statementFile, statementPeriodStart: '2026-09-01', statementPeriodEnd: '2026-09-30', openingBalanceCents: 100000, closingBalanceCents: 75000, rows });
  assert.equal(repeat.status, 201); assert.equal(repeat.body.imported, 0); assert.equal(repeat.body.duplicates, 1);
  const txns = await a.call('GET', '/transactions'); assert.equal(txns.body.total, 1); assert.equal(txns.body.items[0].source, 'bank-statement');
  assert.equal(txns.body.income, 0); assert.equal(txns.body.expenses, 0); assert.equal(txns.body.unclassified, 1);
  assert.equal((await a.call('PATCH', `/bank-transactions/${txns.body.items[0].id}/classification`, { financialClass: 'expense', category: 'Rent' })).status, 200);
  const classified = await a.call('GET', '/transactions');
  assert.equal(classified.body.expenses, 25000); assert.equal(classified.body.unclassified, 0);
  assert.equal((await a.call('GET', '/reports/pnl?year=2026')).body.expenses[0].total, 25000);
  const accounts = await a.call('GET', '/bank-accounts'); assert.equal(accounts.body[0].calculatedBalanceCents, 75000); assert.equal(accounts.body[0].latestImport.duplicateCount, 1);
  const storedStatement = await db.collection('statementImports').findOne({ businessId: (await db.collection('users').findOne({ email: 'bank-a@example.com' })).businessId, filename: 'october.csv' });
  assert.deepEqual(Buffer.from(storedStatement.sourceFile.buffer), Buffer.from(statementFile, 'base64'));
  assert.equal(storedStatement.sourceFileSha256.length, 64);
  const imports = await a.call('GET', `/bank-accounts/${created.body.id}/imports`);
  assert.equal(imports.body.find((x) => x.filename === 'october.csv').sourceFileStored, true);
  assert.equal('sourceFile' in imports.body.find((x) => x.filename === 'october.csv'), false);
  const coverage = await a.call('GET', '/reports/coverage?year=2026');
  assert.equal(coverage.body.months.find((m) => m.month === '2026-09').accounts[0].status, 'complete');
  assert.equal((await a.call('GET', '/overview')).body.cash, 75000, 'statement closing balance anchors consolidated cash');
  assert.equal((await b.call('GET', '/reports/coverage?year=2026')).body.accounts.length, 0);
  const withoutBaseline = await a.call('POST', '/bank-accounts', { institution: 'North Bank', name: 'No opening point', type: 'checking', currency: 'USD' });
  assert.equal((await a.call('GET', '/bank-accounts')).body.find((item) => item.id === withoutBaseline.body.id).calculatedBalanceCents, null, 'transaction movement alone is not presented as an account balance');
  const partialCash = await a.call('GET', '/overview');
  assert.equal(partialCash.body.cash, null, 'a partial set of account balances is not presented as the total available cash');
  assert.deepEqual(partialCash.body.cashDetails.missingAccounts, ['No opening point']);
  assert.equal((await b.call('PATCH', `/bank-transactions/${txns.body.items[0].id}/classification`, { financialClass: 'expense', category: 'Rent' })).status, 404);
  const refund = { date: '2026-10-14', description: 'Studio rent refund', vendor: 'Studio', amountCents: 5000, currency: 'USD', reference: 'R-REFUND' };
  await a.call('POST', '/bank-statements/import', { accountId: created.body.id, filename: 'refund.csv', sourceFileBase64: statementFile, rows: [refund] });
  const refundTxn = (await a.call('GET', '/transactions')).body.items.find((t) => t.description === refund.description);
  assert.equal((await a.call('PATCH', `/bank-transactions/${refundTxn.id}/classification`, { financialClass: 'refund', category: 'Rent' })).status, 200);
  assert.equal((await a.call('GET', '/transactions')).body.expenses, 20000);
  assert.equal((await a.call('GET', `/bank-accounts/${created.body.id}/imports`)).body.length, 3);
  assert.equal((await b.call('GET', '/bank-accounts')).body.length, 0);
  assert.equal((await b.call('GET', `/bank-accounts/${created.body.id}/imports`)).status, 404);
  const archived = await a.call('PATCH', `/bank-accounts/${created.body.id}`, { status: 'archived' }); assert.equal(archived.body.status, 'archived');
  assert.equal((await a.call('POST', '/bank-statements/preview', { accountId: created.body.id, rows })).status, 404);
  assert.equal((await a.call('POST', '/bank-accounts', { institution: 'x', name: 'bad', type: 'other', currency: 'USD' })).status, 201);
  assert.equal((await a.call('POST', '/bank-statements/preview', { accountId: created.body.id, rows: [{ ...rows[0], date: 'not-a-date' }] })).status, 404);
});

test('statement reconciliation handles partial invoice payments, bills, existing expenses and transfers once', async () => {
  const a = agent(); await reg(a, 'reconcile@example.com');
  const customer = await a.call('POST', '/customers', { name: 'Cedar Client' });
  const invoice = await a.call('POST', '/invoices', { customerId: customer.body.id, issueDate: '2026-10-01', dueDate: '2026-11-15', items: [{ description: 'Services', quantity: 1, unitCents: 10000 }] });
  await a.call('POST', `/invoices/${invoice.body.id}/mark-sent`);
  const account = await a.call('POST', '/bank-accounts', { institution: 'North Bank', name: 'Operating', type: 'checking', currency: 'USD' });
  const importOne = (rows, filename, accountId = account.body.id) => a.call('POST', '/bank-statements/import', { accountId, filename, sourceFileBase64: statementFile, rows });
  const first = { date: '2026-10-22', description: 'Cedar Client payment', vendor: 'Cedar Client', amountCents: 4000, currency: 'USD', reference: 'PAY-1' };
  assert.equal((await importOne([first], 'first.csv')).status, 201);
  const available = await a.call('GET', `/bank-accounts/${account.body.id}/transactions`);
  const suggestion = available.body[0].matches.find((m) => m.kind === 'invoice'); assert.ok(suggestion);
  assert.equal((await a.call('POST', `/bank-transactions/${available.body[0].id}/reconcile`, { kind: 'invoice', recordId: invoice.body.id })).status, 200);
  let updated = await a.call('GET', `/invoices/${invoice.body.id}`); assert.equal(updated.body.displayStatus, 'partial'); assert.equal(updated.body.balanceDue, 6000);
  const second = { ...first, date: '2026-10-23', description: 'Cedar Client final payment', amountCents: 6000, reference: 'PAY-2' };
  assert.equal((await importOne([second], 'second.csv')).body.imported, 1);
  const dueTxn = (await a.call('GET', `/bank-accounts/${account.body.id}/transactions`)).body.find((t) => t.description === second.description);
  assert.equal((await a.call('POST', `/bank-transactions/${dueTxn.id}/reconcile`, { kind: 'invoice', recordId: invoice.body.id })).status, 200);
  updated = await a.call('GET', `/invoices/${invoice.body.id}`); assert.equal(updated.body.displayStatus, 'paid'); assert.equal(updated.body.amountPaid, 10000);

  const bill = await a.call('POST', '/bills', { vendor: 'DeskCo', description: 'Office supply', category: 'Office', amountCents: 4500, issueDate: '2026-10-10', dueDate: '2026-11-10' });
  const billRow = { date: '2026-10-23', description: 'DeskCo office supply first payment', vendor: 'DeskCo', amountCents: -2500, currency: 'USD', reference: 'B-1' };
  await importOne([billRow], 'bill.csv');
  const billTxn = (await a.call('GET', `/bank-accounts/${account.body.id}/transactions`)).body.find((t) => t.description === billRow.description);
  assert.equal(billTxn.matches.find((m) => m.kind === 'bill').amountCents, 4500);
  assert.equal((await a.call('POST', `/bank-transactions/${billTxn.id}/reconcile`, { kind: 'bill', recordId: bill.body.id })).status, 200);
  let updatedBill = (await a.call('GET', '/bills')).body.find((item) => item.id === bill.body.id);
  assert.equal(updatedBill.status, 'partial'); assert.equal(updatedBill.amountPaidCents, 2500); assert.equal(updatedBill.balanceDueCents, 2000);
  const billFinal = { ...billRow, date: '2026-10-24', description: 'DeskCo office supply final payment', amountCents: -2000, reference: 'B-2' };
  await importOne([billFinal], 'bill-final.csv');
  const billFinalTxn = (await a.call('GET', `/bank-accounts/${account.body.id}/transactions`)).body.find((t) => t.description === billFinal.description);
  assert.ok(billFinalTxn.matches.find((m) => m.kind === 'bill'));
  assert.equal((await a.call('POST', `/bank-transactions/${billFinalTxn.id}/reconcile`, { kind: 'bill', recordId: bill.body.id })).status, 200);
  updatedBill = (await a.call('GET', '/bills')).body.find((item) => item.id === bill.body.id);
  assert.equal(updatedBill.status, 'paid'); assert.equal(updatedBill.amountPaidCents, 4500); assert.equal(updatedBill.payments.length, 2);

  await a.call('POST', '/transactions', { date: '2026-10-22', description: 'Cloud service', vendor: 'CloudCo', category: 'Software', amount: '25.00', type: 'expense' });
  const expense = { date: '2026-10-22', description: 'CloudCo monthly', vendor: 'CloudCo', amountCents: -2500, currency: 'USD', reference: 'C-1' };
  await importOne([expense], 'expense.csv');
  const expenseTxn = (await a.call('GET', `/bank-accounts/${account.body.id}/transactions`)).body.find((t) => t.description === expense.description);
  const existing = expenseTxn.matches.find((m) => m.kind === 'existing'); assert.ok(existing);
  await a.call('POST', `/bank-transactions/${expenseTxn.id}/reconcile`, { kind: 'existing', recordId: existing.id });
  const totals = await a.call('GET', '/transactions'); assert.equal(totals.body.expenses, 7000, 'bill payment and existing expense each count once');

  const reserve = await a.call('POST', '/bank-accounts', { institution: 'North Bank', name: 'Reserve', type: 'savings', currency: 'USD' });
  const out = { date: '2026-10-23', description: 'Transfer to reserve', amountCents: -8000, currency: 'USD', reference: 'T-OUT' };
  const incoming = { date: '2026-10-23', description: 'Transfer from operating', amountCents: 8000, currency: 'USD', reference: 'T-IN' };
  await importOne([out], 'transfer-out.csv'); await importOne([incoming], 'transfer-in.csv', reserve.body.id);
  const transferTxn = (await a.call('GET', `/bank-accounts/${account.body.id}/transactions`)).body.find((t) => t.description === out.description);
  const transferMatch = transferTxn.matches.find((m) => m.kind === 'transfer'); assert.ok(transferMatch);
  await a.call('POST', `/bank-transactions/${transferTxn.id}/reconcile`, { kind: 'transfer', recordId: transferMatch.id });
  const afterTransfer = await a.call('GET', '/transactions');
  assert.equal(afterTransfer.body.expenses, 7000); assert.equal(afterTransfer.body.income, 10000, 'internal transfers stay out of income and expense totals');
});

test('bills, overview and analytics use persisted data', async () => {
  const a = agent();
  await reg(a, 'erin@example.com');
  const today = new Date().toISOString().slice(0, 10);
  await a.call('PATCH', '/business', { name: 'Erin Co', currency: 'USD', invoicePrefix: 'E-', openingBalanceCents: 1000000, openingBalanceDate: '2026-01-01', defaultTaxRateBps: 0, paymentTermsDays: 14 });
  await a.call('POST', '/transactions/import', { rows: [
    { date: today, description: 'Client', amount: '5000', type: 'income', category: 'Revenue' },
    { date: today, description: 'SaaS', vendor: 'Cloudline', amount: '99.99', type: 'expense', category: 'Software' },
    { date: today, description: 'SaaS', vendor: 'Cloudline', amount: '99.99', type: 'expense', category: 'Software' },
  ] });
  const badImport = await a.call('POST', '/transactions/import', { rows: [{ date: 'nope', description: 'x', amount: '1' }] });
  assert.equal(badImport.status, 400);
  const bill = await a.call('POST', '/bills', { vendor: 'Harbor', amount: '1850', dueDate: today, category: 'Rent' });
  const ov1 = await a.call('GET', '/overview');
  assert.equal(ov1.body.cash, 1000000 + 500000 - 19998);
  assert.equal(ov1.body.payables.outstanding, 185000);
  await a.call('POST', `/bills/${bill.body.id}/pay`, { date: today, amountCents: 50000 });
  const partialBill = (await a.call('GET', '/bills')).body.find((item) => item.id === bill.body.id);
  assert.equal(partialBill.status, 'partial'); assert.equal(partialBill.amountPaidCents, 50000); assert.equal(partialBill.balanceDueCents, 135000);
  const partialOverview = await a.call('GET', '/overview');
  assert.equal(partialOverview.body.payables.outstanding, 135000);
  assert.equal(partialOverview.body.cash, 1000000 + 500000 - 19998 - 50000);
  await a.call('POST', `/bills/${bill.body.id}/pay`, { date: today });
  const ov2 = await a.call('GET', '/overview');
  assert.equal(ov2.body.cash, 1000000 + 500000 - 19998 - 185000);
  assert.equal(ov2.body.period.income, 500000);
  assert.equal(ov2.body.period.expenses, 19998 + 185000);
  const ins = await a.call('GET', '/insights');
  assert.ok(ins.body.insights.some((i) => i.kind === 'duplicate' && i.amountCents === 9999));
  const sp = await a.call('GET', '/spending');
  assert.equal(sp.body.total, 19998 + 185000);
  assert.equal(sp.body.byCategory[0].name, 'Rent');
  const cf = await a.call('GET', '/cashflow');
  assert.equal(cf.body.opening, ov2.body.cash);
  assert.equal(cf.body.weeks.length, 13);
});

test('password change signs out other sessions; account deletion removes data', async () => {
  const a = agent(), other = agent();
  await reg(a, 'frank@example.com');
  await other.call('POST', '/auth/login', { email: 'frank@example.com', password: 'correct horse 42' });
  assert.equal((await a.call('POST', '/account/password', { currentPassword: 'bad', newPassword: 'new password 99' })).status, 401);
  const ch = await a.call('POST', '/account/password', { currentPassword: 'correct horse 42', newPassword: 'new password 99' });
  assert.equal(ch.body.signedOut, 1);
  assert.equal(ch.body.emailNotification.status, 'accepted', 'password change security email was accepted by the provider');
  assert.equal((await other.call('GET', '/auth/me')).body.user, null);
  assert.equal((await a.call('GET', '/auth/me')).body.user.email, 'frank@example.com');
  await a.call('POST', '/transactions', { date: '2026-10-01', description: 'x', amount: '5', type: 'income' });
  assert.equal((await a.call('DELETE', '/account', { password: 'new password 99' })).status, 200);
  assert.equal(await db.collection('users').countDocuments({ email: 'frank@example.com' }), 0);
  assert.equal((await agent().call('POST', '/auth/login', { email: 'frank@example.com', password: 'new password 99' })).status, 401);
});

test('password reset: generic response, single-use expiring token, all sessions revoked', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  const envBefore = Object.fromEntries(['RESEND_API_KEY', 'MAIL_FROM', 'APP_URL'].map((k) => [k, process.env[k]]));
  Object.assign(process.env, { RESEND_API_KEY: 're_test', MAIL_FROM: 'Morgan <no-reply@example.com>', APP_URL: 'https://app.example.com' });
  globalThis.fetch = (u, o) => {
    if (!String(u).startsWith('https://api.resend.com')) return realFetch(u, o);
    const request = JSON.parse(o.body); sent.push(request); resendRequests.push(request);
    return Promise.resolve(new Response(JSON.stringify({ id: `resend_reset_${sent.length}` }), { status: 200 }));
  };
  try {
    const owner = agent(), other = agent();
    await reg(owner, 'reset@example.com');
    await other.call('POST', '/auth/login', { email: 'reset@example.com', password: 'correct horse 42' });
    // Unknown email: same response, no mail.
    assert.deepEqual((await agent().call('POST', '/auth/forgot', { email: 'ghost@example.com' })).body, { ok: true });
    const resetMessages = () => sent.filter((message) => message.subject === 'Reset your Morgan password');
    assert.equal(resetMessages().length, 0);
    // Host header must not influence the link.
    await agent().call('POST', '/auth/forgot', { email: 'reset@example.com' }, { 'x-forwarded-host': 'evil.example' });
    assert.equal(resetMessages().length, 1);
    const resetMessage = resetMessages()[0];
    const token = /reset-password\?token=([\w-]+)/.exec(resetMessage.text)[1];
    assert.match(resetMessage.text, /^[\s\S]*https:\/\/app\.example\.com\/reset-password/);
    assert.equal((await agent().call('POST', '/auth/reset', { token, password: 'short' })).status, 400);
    assert.equal((await agent().call('POST', '/auth/reset', { token: 'forged', password: 'brand new pass 7' })).status, 400);
    const resetResult = await agent().call('POST', '/auth/reset', { token, password: 'brand new pass 7' });
    assert.equal(resetResult.status, 200);
    assert.equal(resetResult.body.emailNotification.status, 'accepted', 'password reset security email was accepted by the provider');
    assert.equal((await agent().call('POST', '/auth/reset', { token, password: 'another pass 8' })).status, 400, 'token is single-use');
    assert.equal((await owner.call('GET', '/auth/me')).body.user, null, 'existing sessions revoked');
    assert.equal((await other.call('GET', '/auth/me')).body.user, null);
    assert.equal((await agent().call('POST', '/auth/login', { email: 'reset@example.com', password: 'correct horse 42' })).status, 401);
    assert.equal((await agent().call('POST', '/auth/login', { email: 'reset@example.com', password: 'brand new pass 7' })).status, 200);
    // Expired tokens are rejected.
    await agent().call('POST', '/auth/forgot', { email: 'reset@example.com' });
    const t2 = /token=([\w-]+)/.exec(resetMessages().at(-1).text)[1];
    await db.collection('resetTokens').updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await agent().call('POST', '/auth/reset', { token: t2, password: 'brand new pass 9' })).status, 400);
  } finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of Object.entries(envBefore)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
  assert.equal((await agent().call('POST', '/auth/forgot', { email: 'reset@example.com' })).status, 200, 'email configuration remains available to following tests');
});

test('expired sessions are rejected server-side', async () => {
  const a = agent();
  await reg(a, 'expiry@example.com');
  await db.collection('sessions').updateMany({ userId: (await db.collection('users').findOne({ email: 'expiry@example.com' }))._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await a.call('GET', '/auth/me')).body.user, null);
  assert.equal((await a.call('GET', '/invoices')).status, 401);
});

test('financial setup, expected schedules, forecast edits and business isolation persist', async () => {
  const a = agent(), other = agent();
  const created = await reg(a, 'planner@example.com');
  await reg(other, 'different-planner@example.com');
  assert.equal(created.body.business.financialSetupComplete, false);
  const setup = await a.call('GET', '/financial-setup');
  assert.equal(setup.body.business.financialSetupComplete, false);
  const today = setup.body.business.timezone ? (await a.call('GET', '/cashflow')).body.today : new Date().toISOString().slice(0, 10);
  const plus = (days) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  const saved = await a.call('PATCH', '/financial-setup', { cashAccounts: [
    { name: 'Operating', type: 'checking', currency: 'USD', balanceCents: 750000, balanceDate: today, notes: '' },
    { name: 'Reserve', type: 'savings', currency: 'USD', balanceCents: 450000, balanceDate: today, notes: '' },
  ], monthlyBudgetCents: 100000, minimumCashCents: 250000, industry: 'Design' });
  assert.equal(saved.body.business.openingBalanceCents, 1200000);
  assert.equal(saved.body.business.cashAccounts.length, 2);
  assert.equal((await a.call('PATCH', '/financial-setup', { cashAccounts: [{ name: 'Foreign', type: 'checking', currency: 'EUR', balanceCents: 10, balanceDate: today }] })).status, 400, 'currencies cannot be summed without conversion');
  assert.equal((await a.call('PATCH', '/financial-setup', { cashAccounts: [
    { name: 'A', type: 'checking', currency: 'USD', balanceCents: 10, balanceDate: today },
    { name: 'B', type: 'checking', currency: 'USD', balanceCents: 10, balanceDate: plus(1) },
  ] })).status, 400, 'account balances must share an as-of date');
  assert.equal(saved.body.business.monthlyBudgetCents, 100000);
  const monthly = await a.call('POST', '/planning-items', { name: 'Software subscription', type: 'expense', category: 'Software', amountCents: 20000, cadence: 'monthly', nextDate: plus(1), confidence: 'planned' });
  const oneTime = await a.call('POST', '/planning-items', { name: 'Equipment purchase', type: 'expense', category: 'Equipment', amountCents: 50000, cadence: 'once', nextDate: plus(8), confidence: 'planned' });
  assert.equal(monthly.status, 201); assert.equal(oneTime.status, 201);
  const forecast = await a.call('GET', '/cashflow');
  const scheduled = forecast.body.weeks.flatMap((w) => w.items).filter((i) => i.type === 'planned');
  const subRows = scheduled.filter((i) => i.id === monthly.body.id);
  assert.ok(subRows.length >= 3, 'monthly recurrence is generated inside the 13 week horizon');
  const spendPlan = await a.call('GET', '/spending');
  assert.equal(spendPlan.body.plannedRecurring.find((i) => i.id === monthly.body.id).monthlyEstimateCents, 20000, 'planned recurring costs appear separately in Spending');
  assert.equal(scheduled.find((i) => i.id === oneTime.body.id).amountCents, -50000);
  assert.equal(scheduled.find((i) => i.id === oneTime.body.id).date, plus(8));
  assert.equal(await db.collection('transactions').countDocuments({ businessId: new (await import('mongodb')).ObjectId(created.body.business.id) }), 0, 'expected items are not recorded as actual transactions');
  const edited = await a.call('PATCH', `/planning-items/${monthly.body.id}`, { name: 'Software subscription', type: 'expense', category: 'Software', amountCents: 25000, cadence: 'monthly', nextDate: plus(1), confidence: 'planned' });
  assert.equal(edited.body.amountCents, 25000);
  const afterEdit = await a.call('GET', '/cashflow');
  assert.ok(afterEdit.body.weeks.flatMap((w) => w.items).filter((i) => i.id === monthly.body.id).every((i) => i.amountCents === -25000));
  assert.equal((await a.call('GET', '/spending')).body.plannedRecurring.find((i) => i.id === monthly.body.id).monthlyEstimateCents, 25000, 'spending plan recalculates after edit');
  const overview = await a.call('GET', '/overview');
  assert.equal(overview.body.cash, 1200000);
  assert.equal(overview.body.financialPlan.monthlyBudgetCents, 100000);
  assert.equal(overview.body.financialPlan.forecast.days90, 1200000 - 3 * 25000 - 50000);
  assert.deepEqual((await other.call('GET', '/planning-items')).body, []);
  assert.equal((await other.call('PATCH', `/planning-items/${monthly.body.id}`, { name: 'x', type: 'expense', category: 'x', amountCents: 1, cadence: 'once', nextDate: today })).status, 404);
  assert.equal((await a.call('DELETE', `/planning-items/${oneTime.body.id}`)).status, 200);
  assert.equal((await a.call('GET', '/planning-items')).body.length, 1);
  assert.ok(!(await a.call('GET', '/cashflow')).body.weeks.flatMap((w) => w.items).some((i) => i.id === oneTime.body.id), 'deleting a plan removes its future forecast occurrence');
  assert.equal(await db.collection('transactions').countDocuments({ businessId: new (await import('mongodb')).ObjectId(created.body.business.id) }), 0, 'removing a plan leaves actual transaction history untouched');
  const done = await a.call('PATCH', '/financial-setup', { complete: true });
  assert.equal(done.body.business.financialSetupComplete, true);
  assert.equal(done.body.emailNotification.status, 'accepted');
  assert.ok(resendRequests.some((message) => message.subject === 'Your Morgan workspace is ready' && message.to.includes('planner@example.com')));
  const emailsBeforeRepeat = resendRequests.length;
  await a.call('PATCH', '/financial-setup', { complete: true });
  assert.equal(resendRequests.length, emailsBeforeRepeat, 'repeat setup saves do not send duplicate onboarding emails');
  assert.equal((await a.call('GET', '/auth/me')).body.business.financialSetupComplete, true);
  await a.call('POST', '/auth/logout');
  const fresh = agent();
  await fresh.call('POST', '/auth/login', { email: 'planner@example.com', password: 'correct horse 42' });
  const reloaded = await fresh.call('GET', '/financial-setup');
  assert.equal(reloaded.body.business.openingBalanceCents, 1200000);
  assert.equal(reloaded.body.business.cashAccounts.length, 2);
  assert.equal(reloaded.body.business.monthlyBudgetCents, 100000);
  assert.equal(reloaded.body.items.length, 1);
});
