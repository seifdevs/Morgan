import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDb } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { hashToken } from '../server/lib/auth.mjs';
import plans from '../shared/plans.json' with { type: 'json' };
import policies from '../shared/policies.json' with { type: 'json' };

const acceptedPolicies = policies.map(({ id, version }) => ({ policyId: id, version }));
const acceptedPurchase = { acceptedPolicies, purchaseTermsAccepted: true };

let mongod, client, server, base, db, realFetch, originalEnv;
const resendRequests = [];
let resendFailure = null;
let nextTestIp = 1;
const geminiRequests = [];
let geminiPayload = { answer: 'Based on your saved records, review the scheduled movement.', citations: [], recommendations: ['Review the forecast movement.'], unsupported: false };
let geminiStatus = 200;

before(async () => {
  originalEnv = Object.fromEntries(['RESEND_API_KEY', 'MAIL_FROM', 'APP_URL', 'MORGAN_ADMIN_EMAIL', 'GEMINI_API_KEY'].map((k) => [k, process.env[k]]));
  Object.assign(process.env, { RESEND_API_KEY: 're_test_suite_only', MAIL_FROM: 'Morgan <no-reply@example.test>', APP_URL: 'https://app.example.test', MORGAN_ADMIN_EMAIL: 'seifeldinashrafa@gmail.com', GEMINI_API_KEY: 'gemini_test_suite_only' });
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://api.resend.com/emails')) {
      const request = JSON.parse(init.body); resendRequests.push(request);
      if (resendFailure) return new Response(JSON.stringify(resendFailure.body), { status: resendFailure.status, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ id: `resend_test_${resendRequests.length}` }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(input).startsWith('https://generativelanguage.googleapis.com/')) {
      geminiRequests.push({ url: String(input), headers: init.headers, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(geminiPayload) }] } }] }), { status: geminiStatus, headers: { 'content-type': 'application/json', ...(geminiStatus === 429 && { 'retry-after': '20' }) } });
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
  for (const x of Object.keys(geminiPayload)) delete geminiPayload[x];
  for (const [key, value] of Object.entries(originalEnv || {})) value === undefined ? delete process.env[key] : process.env[key] = value;
});

/** Tiny cookie-jar client. */
function agent() {
  let cookie = '';
  const ip = `10.20.0.${nextTestIp++}`; // each agent is a distinct client for rate limiting
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

const rawReg = (a, email, extra = {}) => a.call('POST', '/auth/register', { name: 'Owner', email, password: 'correct horse 42', businessName: 'Biz ' + email, country: 'US', bankId: '628', currency: 'USD', statementCurrencyConfirmed: true, statementFilename: 'statement.csv', statementFileBase64: Buffer.from('Date,Description,Amount\n2026-10-01,Sample row,1.00').toString('base64'), openingBalanceCents: 0, closingBalanceCents: 100, statementReviewed: true, acceptedPolicies, ...extra });
async function tokenFromLatest(email, subject = 'Verify your Morgan email') {
  const msg = [...resendRequests].reverse().find((m) => m.to?.includes(email.toLowerCase()) && m.subject === subject);
  assert.ok(msg, `expected a Resend request for ${subject}`);
  const match = new RegExp(`${subject.startsWith('Reset') ? 'reset-password' : 'verify-email'}\\?token=([\\w-]+)`).exec(msg.text);
  assert.ok(match, 'email includes a one-time link');
  return match[1];
}
async function verifySignup(a, email) {
  const token = await tokenFromLatest(email);
  const verified = await a.call('POST', '/auth/verify-email', { token });
  assert.equal(verified.status, 200, 'verification link activates the account');
  const login = await a.call('POST', '/auth/login', { email, password: 'correct horse 42' });
  assert.equal(login.status, 200, 'verified account can sign in');
}
async function reg(a, email, extra = {}) {
  const created = await rawReg(a, email, extra);
  if (created.status === 201) {
    assert.equal(created.body.verificationRequired, true);
    assert.equal(a.cookie, '', 'signup does not create an authenticated session');
    await verifySignup(a, email);
    const step1 = await a.call('PATCH', '/financial-setup', { onboardingStep: 1 }); assert.equal(step1.status, 200);
    const step2 = await a.call('PATCH', '/financial-setup', { onboardingStep: 2, expectedActivityReviewed: true }); assert.equal(step2.status, 200);
    const step3 = await a.call('PATCH', '/financial-setup', { monthlyBudgetCents: 0, minimumCashCents: 0, onboardingStep: 3 }); assert.equal(step3.status, 200);
    const done = await a.call('PATCH', '/financial-setup', { complete: true }); assert.equal(done.status, 200);
  }
  return created;
}
async function issueVerification(user, expiresAt = new Date(Date.now() + 24 * 3600e3)) {
  const token = randomBytes(32).toString('base64url');
  await db.collection('users').updateOne({ _id: user._id }, { $set: { emailVerified: false } });
  await db.collection('verificationTokens').insertOne({ _id: hashToken(token), userId: user._id, expiresAt });
  return token;
}
const statementFile = Buffer.from('Date,Description,Amount\n2026-10-01,Sample row,1.00').toString('base64');
const bankStatementFile = Buffer.from('Date,Description,Amount,Reference,Balance\n2026-09-12,Studio rent,-250.00,R-12,750.00').toString('base64');
function statementUpload(rows, openingBalanceCents = 100000) {
  let balance = openingBalanceCents;
  const lines = ['Date,Description,Amount,Vendor,Reference,Balance'];
  for (const row of rows) { balance += row.amountCents; const amount = (row.amountCents / 100).toFixed(2), closing = row.runningBalanceCents ?? balance;
    const esc = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    lines.push([row.date, row.description, amount, row.vendor || '', row.reference || '', (closing / 100).toFixed(2)].map(esc).join(','));
  }
  return { sourceFileBase64: Buffer.from(lines.join('\n')).toString('base64'), openingBalanceCents, closingBalanceCents: balance };
}

test('registration validates input and rejects duplicates', async () => {
  const a = agent();
  assert.equal((await reg(a, 'bad-email')).status, 400);
  assert.equal((await a.call('POST', '/auth/register', { name: 'x', email: 'w@x.io', password: 'short', businessName: 'B' })).status, 400);
  const missingAcceptance = await a.call('POST', '/auth/register', { name: 'No consent', email: 'no-consent@example.com', password: 'correct horse 42', businessName: 'No Consent', acceptedPolicies: [] });
  assert.equal(missingAcceptance.status, 400, 'registration is rejected server-side without current policy versions');
  const banks = await a.call('GET', '/bank-directory?country=US&q=JPMorgan');
  assert.equal(banks.status, 200); assert.equal(banks.body.banks[0].name, 'JPMorgan Chase Bank, National Association'); assert.equal(banks.body.banks.length <= 100, true);
  const ok = await rawReg(a, 'Alice@Example.com');
  assert.equal(ok.status, 201);
  assert.equal(ok.body.user.email, 'alice@example.com');
  assert.ok(ok.body.business.id);
  assert.equal(ok.body.verificationRequired, true);
  assert.equal(a.cookie, '', 'signup requires email verification before creating a session');
  const stored = await db.collection('users').findOne({ email: 'alice@example.com' });
  assert.deepEqual(stored.policyVersionsAccepted, Object.fromEntries(policies.map(({ id, version }) => [id, version])));
  assert.equal(await db.collection('policyAcceptances').countDocuments({ userId: stored._id, source: 'registration' }), 3);
  assert.equal(stored.emailVerified, false);
  assert.equal(await db.collection('verificationTokens').countDocuments({ userId: stored._id }), 1);
  assert.ok(resendRequests.some((m) => m.subject === 'Verify your Morgan email' && m.to.includes('alice@example.com')));
  assert.equal((await a.call('GET', '/transactions')).status, 401, 'unverified account cannot access the dashboard');
  await verifySignup(a, 'alice@example.com');
  assert.equal((await db.collection('users').findOne({ email: 'alice@example.com' })).emailVerified, true);
  assert.equal((await a.call('GET', '/transactions')).status, 403, 'dashboard API is gated until financial onboarding is complete');
  const p1 = await a.call('PATCH', '/financial-setup', { onboardingStep: 1 }); assert.equal(p1.status, 200);
  const p2 = await a.call('PATCH', '/financial-setup', { onboardingStep: 2, expectedActivityReviewed: true }); assert.equal(p2.status, 200);
  const p3 = await a.call('PATCH', '/financial-setup', { monthlyBudgetCents: 0, minimumCashCents: 0, onboardingStep: 3 }); assert.equal(p3.status, 200);
  assert.equal((await a.call('PATCH', '/financial-setup', { complete: true })).status, 200);
  assert.equal((await rawReg(agent(), 'alice@example.com')).status, 409);
  const tz = await reg(agent(), 'tz@example.com', { timezone: 'Pacific/Kiritimati' });
  assert.equal(tz.body.business.timezone, 'Pacific/Kiritimati');
  assert.equal((await reg(agent(), 'tz2@example.com', { timezone: 'Not/AZone' })).body.business.timezone, 'UTC');
  assert.match(stored.passwordHash, /^scrypt\$/);
});

test('registration succeeds without a bank statement and creates an empty workspace', async () => {
  const account = agent();
  const result = await account.call('POST', '/auth/register', {
    name: 'No Statement', email: 'no-statement@example.com', password: 'correct horse 42', businessName: 'New Business', currency: 'EUR',
    acceptedPolicies,
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.business.currency, 'EUR');
  assert.equal(result.body.business.openingBalanceCents, 0);
  assert.equal(result.body.business.openingBalanceDate, null);
  await verifySignup(account, 'no-statement@example.com');
  const businessId = new ObjectId(result.body.business.id);
  assert.equal(await db.collection('bankAccounts').countDocuments({ businessId }), 0);
  assert.equal(await db.collection('statementImports').countDocuments({ businessId }), 0);
  assert.equal(await db.collection('transactions').countDocuments({ businessId }), 0);
  assert.equal((await account.call('PATCH', '/financial-setup', { cashAccounts: [], onboardingStep: 1 })).status, 200, 'onboarding can continue without a statement or manually entered opening balance');
});

test('policy updates require version-specific reacceptance before protected use resumes', async () => {
  const customer = agent();
  await reg(customer, 'policy-update@example.com');
  const user = await db.collection('users').findOne({ email: 'policy-update@example.com' });
  await db.collection('users').updateOne({ _id: user._id }, { $unset: { policyVersionsAccepted: '' } });
  assert.equal((await customer.call('GET', '/account/policies/status')).body.missing.length, policies.length);
  assert.equal((await customer.call('GET', '/usage')).status, 428);
  assert.equal((await customer.call('POST', '/account/policies/accept', { acceptedPolicies: [{ policyId: policies[0].id, version: 'old-version' }] })).status, 400);
  assert.equal((await customer.call('POST', '/account/policies/accept', { acceptedPolicies })).status, 200);
  assert.equal((await customer.call('GET', '/usage')).status, 200);
  assert.equal(await db.collection('policyAcceptances').countDocuments({ userId: user._id, source: 'reacceptance' }), policies.length);
});

test('registration imports only server-extracted statement data and requires reconciled balances', async () => {
  const a = agent();
  const source = Buffer.from('Date,Description,Amount,Balance\n2026-10-01,Opening client receipt,50.00,150.00\n2026-10-02,Software,-20.00,130.00').toString('base64');
  const preview = await a.call('POST', '/auth/statement-preview', { filename: 'real.csv', sourceFileBase64: source, currency: 'USD' });
  assert.equal(preview.status, 200); assert.equal(preview.body.rows.length, 2); assert.equal(preview.body.rows[1].amountCents, -2000);
  const mismatch = await rawReg(a, 'bad-balance@example.com', { statementFileBase64: source, statementFilename: 'real.csv', openingBalanceCents: 10000, closingBalanceCents: 14000 });
  assert.equal(mismatch.status, 400); assert.match(mismatch.body.error, /do not reconcile/);
  const created = await rawReg(a, 'statement-owner@example.com', { statementFileBase64: source, statementFilename: 'real.csv', openingBalanceCents: 10000, closingBalanceCents: 13000 });
  assert.equal(created.status, 201);
  await verifySignup(a, 'statement-owner@example.com');
  const bid = new ObjectId(created.body.business.id);
  const txns = await db.collection('transactions').find({ businessId: bid }).sort({ date: 1 }).toArray();
  assert.equal(txns.length, 2); assert.equal(txns[0].description, 'Opening client receipt'); assert.equal(txns[1].amountCents, -2000);
  assert.equal((await a.call('GET', '/overview')).status, 403);
  assert.equal((await db.collection('statementImports').countDocuments({ businessId: bid, sourceFileSha256: { $exists: true } })), 1);

  const duplicateFile = Buffer.from('Date,Description,Amount,Balance,Reference\n2026-10-01,Same transaction,50.00,150.00,SAME-1\n2026-10-01,Same transaction,50.00,150.00,SAME-1').toString('base64');
  const duplicatePreview = await a.call('POST', '/auth/statement-preview', { filename: 'duplicate.csv', sourceFileBase64: duplicateFile, currency: 'USD' });
  assert.equal(duplicatePreview.body.summary.duplicates, 1); assert.equal(duplicatePreview.body.rows[1].duplicate, true);
  const duplicateBase = { statementFileBase64: duplicateFile, statementFilename: 'duplicate.csv', openingBalanceCents: 10000, closingBalanceCents: 15000 };
  assert.equal((await rawReg(a, 'duplicate-owner@example.com', duplicateBase)).status, 400, 'repeated rows need explicit review');
  const deduplicated = await rawReg(a, 'duplicate-owner@example.com', { ...duplicateBase, duplicatesReviewed: true }); assert.equal(deduplicated.status, 201);
  assert.equal(await db.collection('transactions').countDocuments({ businessId: new ObjectId(deduplicated.body.business.id) }), 1);
});

test('demo account is isolated, visibly marked, populated and bypasses required onboarding', async () => {
  const a = agent();
  assert.equal((await a.call('POST', '/auth/demo', {})).status, 400, 'demo creation also requires policy acceptance');
  const created = await a.call('POST', '/auth/demo', { acceptedPolicies });
  assert.equal(created.status, 201); assert.equal(created.body.business.isDemo, true); assert.equal(created.body.business.financialSetupComplete, true);
  const biz = new ObjectId(created.body.business.id);
  assert.ok(await db.collection('transactions').countDocuments({ businessId: biz, simulated: true }) >= 5);
  assert.equal(await db.collection('customers').countDocuments({ businessId: biz, simulated: true }), 1);
  assert.equal(await db.collection('invoices').countDocuments({ businessId: biz, simulated: true }), 1);
  assert.equal(await db.collection('bills').countDocuments({ businessId: biz, simulated: true }), 1);
  assert.equal(await db.collection('bankAccounts').countDocuments({ businessId: biz, simulated: true }), 1);
  assert.equal((await a.call('GET', '/overview')).status, 200);
  const real = agent(); await reg(real, 'isolated@example.com');
  assert.equal((await real.call('GET', '/transactions')).body.items.some((row) => row.simulated), false);
});

test('signup succeeds without sending email when the provider is unavailable', async () => {
  const a = agent();
  resendFailure = { status: 403, body: { statusCode: 403, name: 'validation_error', message: 'You can only send testing emails to your own email address (owner@example.com). Verify a domain at resend.com/domains.' } };
  const result = await rawReg(a, 'kept@example.com');
  resendFailure = null;
  assert.equal(result.status, 201);
  assert.ok(result.body.user);
  assert.equal(a.cookie, '');
  const user = await db.collection('users').findOne({ email: 'kept@example.com' });
  assert.ok(user, 'account creation is independent of Resend');
  assert.equal(user.emailVerified, false);
  assert.equal(await db.collection('verificationTokens').countDocuments({ userId: user._id }), 1);
  assert.equal(await db.collection('emailEvents').countDocuments({ kind: 'verification', status: 'rejected' }), 1);
  assert.equal((await a.call('POST', '/auth/login', { email: 'kept@example.com', password: 'correct horse 42' })).status, 403);
});

test('verification handles invalid, expired, used links and resend requests', async () => {
  const a = agent();
  const created = await rawReg(a, 'verify-lifecycle@example.com');
  assert.equal(created.status, 201);
  assert.equal((await a.call('POST', '/auth/login', { email: 'verify-lifecycle@example.com', password: 'correct horse 42' })).status, 403);
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

test('PayPal.Me payments stay pending until an administrator approves the unique transaction', async () => {
  const admin = agent(), customer = agent(), other = agent();
  const priorAdminEmail = process.env.MORGAN_ADMIN_EMAIL;
  process.env.MORGAN_ADMIN_EMAIL = 'paypal-admin@example.com';
  await reg(admin, 'paypal-admin@example.com');
  process.env.MORGAN_ADMIN_EMAIL = priorAdminEmail;
  await reg(customer, 'paypal-customer@example.com');
  await reg(other, 'paypal-other@example.com');
  assert.equal((await agent().call('GET', '/admin/payments')).status, 401);
  const checkout = await customer.call('POST', '/billing/checkouts', { ...acceptedPurchase, planId: 'pro', interval: 'annual', amountCents: 1, currency: 'EGP' });
  assert.equal(checkout.status, 201);
  assert.equal(checkout.body.amountCents, 49900, 'the server chooses the amount from central plan configuration');
  assert.equal(checkout.body.paymentUrl, 'https://paypal.me/seifroyale/499USD');
  assert.equal(checkout.body.autoRenew, false);
  const checkoutRecord = await db.collection('planPayments').findOne({ _id: checkout.body.reference });
  assert.equal(checkoutRecord.policyAcceptances.length, policies.length);
  assert.ok(checkoutRecord.policyAcceptedAt instanceof Date);
  assert.ok(checkoutRecord.purchaseTermsAcceptedAt instanceof Date);
  assert.match(checkoutRecord.purchaseTermsText, /no automatic renewal/i);
  assert.equal((await customer.call('POST', '/billing/checkouts', { planId: 'pro', interval: 'monthly', purchaseTermsAccepted: false })).status, 400, 'checkout requires policy and purchase-term acceptance');
  assert.equal((await other.call('POST', `/billing/checkouts/${checkout.body.reference}/transaction`, { transactionId: 'OTHER_ACCOUNT_TXN' })).status, 404);
  assert.equal((await admin.call('POST', `/admin/payments/${checkout.body.reference}/decision`, { action: 'approve' })).status, 409, 'a checkout visit without a submitted transaction ID cannot be approved');
  assert.equal((await customer.call('POST', `/billing/checkouts/${checkout.body.reference}/transaction`, { transactionId: 'PAYPAL-BAD-EMAIL', paypalIdentifier: 'bad@email' })).status, 400, 'invalid PayPal email/username information is rejected');
  const submitted = await customer.call('POST', `/billing/checkouts/${checkout.body.reference}/transaction`, { transactionId: 'PAYPAL-UNIQUE-001', paypalIdentifier: 'owner@example.com' });
  assert.equal(submitted.status, 202);
  const customerPayments = await customer.call('GET', '/billing/checkouts');
  assert.equal(customerPayments.body.find((item) => item.reference === checkout.body.reference).paypalIdentifier, undefined, 'PayPal identity data is only available to authorized admins');
  const heldIdentifier = await db.collection('paypalPaymentIdentifiers').findOne({ paymentId: checkout.body.reference });
  assert.equal(heldIdentifier.paypalIdentifier, 'owner@example.com');
  assert.ok(heldIdentifier.purgeAt instanceof Date);
  assert.equal((await other.call('POST', `/billing/checkouts/${(await other.call('POST', '/billing/checkouts', { ...acceptedPurchase, planId: 'pro', interval: 'monthly' })).body.reference}/transaction`, { transactionId: 'PAYPAL-UNIQUE-001', paypalIdentifier: 'different_user' })).status, 409, 'PayPal transaction IDs cannot be reused across accounts');
  assert.equal((await customer.call('GET', '/usage')).body.plan.id, 'starter', 'a submitted ID alone does not activate an entitlement');
  assert.equal((await customer.call('GET', '/admin/payments')).status, 403);
  const payments = await admin.call('GET', '/admin/payments');
  const review = payments.body.find((item) => item.id === checkout.body.reference);
  assert.equal(review.customerName, 'Owner');
  assert.equal(review.paypalIdentifier, 'owner@example.com');
  assert.equal(review.email, 'paypal-customer@example.com');
  assert.equal(review.transactionId, 'PAYPAL-UNIQUE-001');
  assert.equal(review.status, 'pending_verification');
  assert.equal((await admin.call('POST', `/admin/payments/${checkout.body.reference}/decision`, { action: 'approve' })).status, 400, 'approval requires explicit confirmation of PayPal verification');
  assert.equal((await admin.call('POST', `/admin/payments/${checkout.body.reference}/decision`, { action: 'approve', verificationConfirmed: true })).status, 200);
  assert.equal((await customer.call('GET', '/usage')).body.plan.id, 'pro');
  assert.equal((await customer.call('GET', '/usage')).body.usage.financialRecords.used, 1, 'upgrading does not reset prior usage');
  assert.equal((await customer.call('GET', '/usage')).body.subscription.autoRenew, false);
  assert.equal((await admin.call('POST', `/admin/payments/${checkout.body.reference}/decision`, { action: 'approve' })).status, 409, 'the same payment cannot be approved twice');
  const customerUser = await db.collection('users').findOne({ email: 'paypal-customer@example.com' });
  assert.equal(await db.collection('adminAudit').countDocuments({ action: 'manual_payment_approve', targetUserId: customerUser._id }), 1);
  const periodId = `${String(customerUser.businessId)}:${new Date().toISOString().slice(0,7)}`;
  await db.collection('usagePeriods').updateOne({ _id: periodId }, { $set: { 'counters.financialRecords': 251 } });
  assert.equal((await admin.call('PATCH', `/admin/users/${customerUser._id}/subscription`, { planId: 'starter' })).status, 200);
  assert.equal((await customer.call('GET', '/usage')).body.plan.id, 'starter', 'an administrative downgrade takes effect without removing the customer records');
  assert.equal((await customer.call('GET', '/usage')).body.usage.financialRecords.used, 251, 'downgrade preserves historical usage, including usage above the Starter cap');
  const today = (await customer.call('GET', '/financial-setup')).body.today;
  assert.equal((await customer.call('POST', '/transactions', { date: today, description: 'Over-quota after downgrade', amount: '1.00', type: 'expense' })).status, 429);

  const rejectedCheckout = await other.call('POST', '/billing/checkouts', { ...acceptedPurchase, planId: 'max', interval: 'monthly' });
  await other.call('POST', `/billing/checkouts/${rejectedCheckout.body.reference}/transaction`, { transactionId: 'PAYPAL-REJECT-001', paypalIdentifier: 'another@example.com' });
  assert.equal((await admin.call('POST', `/admin/payments/${rejectedCheckout.body.reference}/decision`, { action: 'reject' })).status, 200);
  assert.equal((await other.call('GET', '/usage')).body.plan.id, 'starter', 'rejecting a payment leaves entitlements unchanged');
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
  assert.equal(body.total, 2);
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
    const r = await fetch(url + '/auth/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-morgan-csrf': '1' }, body: JSON.stringify({ name: 'S', email: 'secure@example.com', password: 'correct horse 42', businessName: 'S', country: 'US', bankId: '628', currency: 'USD', statementCurrencyConfirmed: true, statementFilename: 'statement.csv', statementFileBase64: statementFile, openingBalanceCents: 0, closingBalanceCents: 100, statementReviewed: true, acceptedPolicies }) });
    assert.equal(r.status, 201);
    assert.equal(r.headers.get('set-cookie'), null, 'registration waits for verification before creating a session');
    const denied = await fetch(url + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-morgan-csrf': '1' }, body: JSON.stringify({ email: 'secure@example.com', password: 'correct horse 42' }) });
    assert.equal(denied.status, 403, 'unverified account cannot sign in');
    const token = await tokenFromLatest('secure@example.com');
    const verified = await fetch(url + '/auth/verify-email', { method: 'POST', headers: { 'content-type': 'application/json', 'x-morgan-csrf': '1' }, body: JSON.stringify({ token }) });
    assert.equal(verified.status, 200);
    const login = await fetch(url + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-morgan-csrf': '1' }, body: JSON.stringify({ email: 'secure@example.com', password: 'correct horse 42' }) });
    assert.equal(login.status, 200);
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
  assert.equal((await a.call('GET', '/overview')).body.cash, 100, 'the imported statement provides the dated starting cash position');
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
  assert.equal((await a.call('GET', '/overview')).body.cash, 1100, 'invoice payment activity rolls forward from the statement closing balance');
  const p2 = await a.call('POST', `/invoices/${id}/payments`, { amountCents: 1165, date: '2026-10-21' });
  assert.equal(p2.body.status, 'paid');
  assert.equal(p2.body.balanceDue, 0);
  assert.equal((await a.call('GET', '/overview')).body.cash, 2265);

  const txns = await a.call('GET', '/transactions');
  assert.equal(txns.body.total, 3);
  assert.equal(txns.body.income, 2165);
  // Linked payment transactions cannot be edited directly.
  assert.equal((await a.call('DELETE', `/transactions/${txns.body.items[0].id}`)).status, 400);
  // Removing a payment reopens the invoice and removes its transaction.
  const reopened = await a.call('DELETE', `/invoices/${id}/payments/${p2.body.payments[1].id}`);
  assert.equal(reopened.body.status, 'sent');
  assert.equal((await a.call('GET', '/transactions')).body.total, 2, 'the onboarding statement and the remaining payment are still recorded');
});

test('opening cash edited in Settings is the shared Overview, cash flow and forecast starting balance', async () => {
  const a = agent(); await reg(a, 'cash-sync@example.com');
  const today = (await a.call('GET', '/financial-setup')).body.today;
  const prior = new Date(`${today}T00:00:00Z`); prior.setUTCDate(prior.getUTCDate() - 1);
  const openingDate = prior.toISOString().slice(0, 10);
  const saved = await a.call('PATCH', '/business', { name: 'Cash Sync', currency: 'USD', invoicePrefix: 'CS-', openingBalanceCents: 2000000, openingBalanceDate: openingDate, defaultTaxRateBps: 0, paymentTermsDays: 14 });
  assert.equal(saved.status, 200);
  assert.equal((await a.call('GET', '/overview')).body.cash, 2000000);
  assert.equal((await a.call('GET', '/cashflow')).body.opening, 2000000);
  await a.call('POST', '/transactions', { date: today, description: 'After opening checkpoint', amount: '500.00', type: 'expense' });
  assert.equal((await a.call('GET', '/overview')).body.cash, 1950000);
  assert.equal((await a.call('GET', '/cashflow')).body.opening, 1950000);
  const future = new Date(`${today}T00:00:00Z`); future.setUTCDate(future.getUTCDate() + 3);
  await a.call('POST', '/planning-items', { name: 'Planned hosting renewal', type: 'expense', category: 'Software', amountCents: 10000, cadence: 'once', nextDate: future.toISOString().slice(0, 10), confidence: 'planned' });
  assert.equal((await a.call('GET', '/overview')).body.financialPlan.forecast.days30, 1940000);
  assert.ok((await a.call('GET', '/cashflow')).body.weeks.flatMap((week) => week.items).some((item) => item.label === 'Planned hosting renewal'));
});

test('Horizon scenarios persist, recalculate the real forecast, and stay business-isolated', async () => {
  const a = agent(), b = agent(); await reg(a, 'horizon-a@example.com'); await reg(b, 'horizon-b@example.com');
  const today = (await a.call('GET', '/financial-setup')).body.today;
  const start = new Date(`${today}T00:00:00Z`); start.setUTCDate(start.getUTCDate() + 5);
  const startDate = start.toISOString().slice(0, 10);
  const saved = await a.call('POST', '/horizon/scenarios', { name: 'Studio equipment', assumptions: [{ type: 'large-purchase', name: 'Camera kit', startDate, amountCents: 500000, cadence: 'once' }] });
  assert.equal(saved.status, 201);
  assert.equal((await a.call('GET', '/horizon/scenarios')).body[0].name, 'Studio equipment');
  assert.equal((await b.call('GET', `/horizon?scenarioId=${saved.body.id}`)).status, 404);
  const base = await a.call('GET', '/horizon?days=30');
  const scenario = await a.call('GET', `/horizon?days=30&scenarioId=${saved.body.id}`);
  assert.equal(scenario.status, 200);
  assert.equal(scenario.body.forecasts.base.length, 30, 'Starter does not receive forecast points beyond its allowance');
  assert.equal(scenario.body.checkpoints.length, 1);
  assert.equal(scenario.body.forecasts.base[29].balanceCents, base.body.forecasts.base[29].balanceCents - 500000, 'saved scenario assumptions are applied exactly, without probability discounts');
  assert.equal((await b.call('GET', '/horizon/scenarios')).body.length, 0);
  assert.equal((await a.call('PATCH', `/horizon/scenarios/${saved.body.id}`, { name: 'Updated equipment', assumptions: [{ type: 'large-purchase', name: 'Camera kit', startDate, amountCents: 600000, cadence: 'once' }] })).status, 200);
  assert.equal((await a.call('GET', '/horizon/scenarios')).body[0].name, 'Updated equipment');
  assert.equal((await a.call('DELETE', `/horizon/scenarios/${saved.body.id}`)).status, 200);
  assert.equal((await a.call('POST', '/horizon/scenarios', { name: 'Replacement', assumptions: [{ type: 'large-purchase', name: 'Purchase', startDate, amountCents: 100, cadence: 'once' }] })).status, 201, 'deleting a scenario frees its slot');
});

test('Starter entitlements are server enforced and usage is visible with a UTC reset', async () => {
  const a = agent(); await reg(a, 'entitlements-starter@example.com');
  const before = await a.call('GET', '/usage');
  assert.equal(before.status, 200); assert.equal(before.body.plan.id, 'starter');
  assert.equal(before.body.usage.financialRecords.limit, 250);
  assert.equal(before.body.usage.financialRecords.used, 1, 'the accepted registration statement row counts');
  assert.equal(before.body.period.timezone, 'UTC'); assert.match(before.body.period.resetsAt, /^2026-12-01T00:00:00\.000Z$/);
  await a.call('PATCH', '/account', { name: 'Starter owner', planId: 'max', price: 0, limits: { financialRecords: 999999 } });
  assert.equal((await a.call('GET', '/usage')).body.plan.id, 'starter', 'browser supplied plan and price do not alter the server entitlement');
  const user = await db.collection('users').findOne({ email: 'entitlements-starter@example.com' });
  const periodId = `${String(user.businessId)}:${new Date().toISOString().slice(0, 7)}`;
  await db.collection('usagePeriods').updateOne({ _id: periodId }, { $set: { 'counters.financialRecords': 249 } });
  const today = (await a.call('GET', '/financial-setup')).body.today;
  const body = { date: today, description: 'Quota boundary record', amount: '1.00', type: 'expense' };
  const results = await Promise.all(Array.from({ length: 6 }, () => a.call('POST', '/transactions', body)));
  assert.equal(results.filter((result) => result.status === 201).length, 1);
  assert.equal(results.filter((result) => result.status === 429).length, 5);
  assert.equal((await a.call('GET', '/usage')).body.usage.financialRecords.used, 250);
  assert.equal((await a.call('GET', '/horizon')).body.forecasts.base.length, 30);
  const starterCashFlow = await a.call('GET', '/cashflow');
  const horizonEnd = new Date(`${today}T00:00:00Z`); horizonEnd.setUTCDate(horizonEnd.getUTCDate() + 30);
  assert.ok(starterCashFlow.body.weeks.every((week) => week.end <= horizonEnd.toISOString().slice(0, 10)));
  assert.ok(starterCashFlow.body.weeks.flatMap((week) => week.items).every((item) => item.date <= horizonEnd.toISOString().slice(0, 10)));
  assert.equal((await a.call('GET', '/horizon?days=90')).status, 403);
  const startDate = today;
  const scenario = { name: 'Boundary', assumptions: [{ type: 'large-purchase', name: 'Purchase', startDate, amountCents: 100, cadence: 'once' }] };
  assert.equal((await a.call('POST', '/horizon/scenarios', scenario)).status, 201);
  assert.equal((await a.call('POST', '/horizon/scenarios', scenario)).status, 429);
  assert.equal((await a.call('GET', '/usage')).body.capabilities.scenariosPerWorkspace.used, 1);
});

test('Pro and Max backend boundaries cover records, forecasts, scenarios and reports', async () => {
  for (const [planId, interval] of [['pro','monthly'], ['max','annual']]) {
    const a = agent(), email = `entitlement-${planId}-api@example.com`;
    await reg(a, email);
    const user = await db.collection('users').findOne({ email });
    const end = new Date(); end.setUTCDate(end.getUTCDate() + 30);
    await db.collection('users').updateOne({ _id: user._id }, { $set: { planId, billingStatus: 'active', billingInterval: interval, currentPeriodEnd: end } });
    const usage = await a.call('GET', '/usage');
    assert.equal(usage.body.plan.id, planId);
    assert.equal(usage.body.capabilities.forecastDays, 90);
    assert.equal(usage.body.usage.financialRecords.limit, plans[planId].limits.financialRecords);
    const forecast = await a.call('GET', '/horizon?days=90');
    assert.equal(forecast.status, 200);
    assert.equal(forecast.body.forecasts.base.length, 90);

    const month = new Date().toISOString().slice(0, 7), periodId = `${String(user.businessId)}:${month}`;
    const recordLimit = plans[planId].limits.financialRecords, pdfLimit = plans[planId].limits.pdfReports, scenarioLimit = plans[planId].limits.scenariosPerWorkspace;
    await db.collection('usagePeriods').updateOne({ _id: periodId }, { $set: { 'counters.financialRecords': recordLimit - 1, 'counters.pdfReports': pdfLimit - 1 } });
    const today = (await a.call('GET', '/financial-setup')).body.today;
    const record = { date: today, description: `${planId} boundary`, amount: '1.00', type: 'expense' };
    assert.equal((await a.call('POST', '/transactions', record)).status, 201);
    assert.equal((await a.call('POST', '/transactions', { ...record, description: `${planId} beyond boundary` })).status, 429);
    assert.equal((await a.call('GET', '/reports/pdf?year=2026')).status, 200);
    assert.equal((await a.call('GET', '/reports/pdf?year=2026')).status, 429);

    const biz = await db.collection('businesses').findOne({ _id: user.businessId });
    await db.collection('businesses').updateOne({ _id: biz._id }, { $set: { scenarioSlotsInitialized: true, activeScenarioIds: Array.from({ length: scenarioLimit - 1 }, (_, n) => `occupied-${n}`) } });
    const todayDate = today;
    const scenario = { name: `${planId} capacity`, assumptions: [{ type: 'large-purchase', name: 'Test purchase', startDate: todayDate, amountCents: 100, cadence: 'once' }] };
    const lastScenario = await a.call('POST', '/horizon/scenarios', scenario);
    assert.equal(lastScenario.status, 201);
    assert.equal((await a.call('POST', '/horizon/scenarios', scenario)).status, 429);
    assert.equal((await a.call('PATCH', `/horizon/scenarios/${lastScenario.body.id}`, { ...scenario, name: `${planId} edited` })).status, 200);
    assert.equal((await a.call('DELETE', `/horizon/scenarios/${lastScenario.body.id}`)).status, 200);
    assert.equal((await a.call('POST', '/horizon/scenarios', scenario)).status, 201, 'deleting the saved scenario frees its slot');
    assert.equal((await a.call('GET', '/usage')).body.usage.financialRecords.used, recordLimit);
    assert.equal((await a.call('GET', '/usage')).body.usage.pdfReports.used, pdfLimit);
    assert.equal((await a.call('GET', '/usage')).body.capabilities.scenariosPerWorkspace.used, 1);
  }
});

test('Morgan Intelligence monthly cap is atomic and failed provider calls release their reservation', async () => {
  const a = agent(); await reg(a, 'entitlements-ai@example.com');
  const user = await db.collection('users').findOne({ email: 'entitlements-ai@example.com' });
  const periodId = `${String(user.businessId)}:${new Date().toISOString().slice(0, 7)}`;
  await db.collection('usagePeriods').updateOne({ _id: periodId }, { $set: { 'counters.intelligenceRequests': 9 } });
  geminiStatus = 503;
  const failed = await a.call('POST', '/gemini/ask', { question: 'Will fail', requestId: 'failed-request-0001' });
  assert.equal(failed.status, 502);
  assert.equal((await a.call('GET', '/usage')).body.usage.intelligenceRequests.used, 9);
  geminiStatus = 200;
  const requests = await Promise.all(Array.from({ length: 5 }, (_, index) => a.call('POST', '/gemini/ask', { question: `Concurrent question ${index}`, requestId: `concurrent-request-${String(index).padStart(4, '0')}` })));
  assert.equal(requests.filter((result) => result.status === 200).length, 1);
  assert.equal(requests.filter((result) => result.status === 429).length, 4);
  const successfulIndex = requests.findIndex((result) => result.status === 200);
  const requestId = `concurrent-request-${String(successfulIndex).padStart(4, '0')}`;
  const providerCalls = geminiRequests.length;
  assert.equal((await a.call('POST', '/gemini/ask', { question: `Concurrent question ${successfulIndex}`, requestId })).status, 200);
  assert.equal(geminiRequests.length, providerCalls, 'replaying the same completed request returns its stored answer without another provider call');
  assert.equal((await a.call('GET', '/usage')).body.usage.intelligenceRequests.used, 10);
});

test('PDF report allowance counts successful generations and releases failed generations', async () => {
  const a = agent(); await reg(a, 'entitlements-pdf@example.com');
  assert.equal((await a.call('GET', '/reports/pdf?year=9999')).status, 400);
  assert.equal((await a.call('GET', '/usage')).body.usage.pdfReports.used, 0);
  assert.equal((await a.call('GET', '/reports/pdf?year=2026')).status, 200);
  assert.equal((await a.call('GET', '/reports/pdf?year=2026')).status, 200);
  assert.equal((await a.call('GET', '/reports/pdf?year=2026')).status, 429);
  assert.equal((await a.call('GET', '/usage')).body.usage.pdfReports.used, 2);
});

test('Monitor shows forecast reserve pressure from the saved cash balance and configured reserve', async () => {
  const a = agent(); await reg(a, 'monitor-pressure@example.com');
  const saved = await a.call('PATCH', '/financial-setup', { minimumCashCents: 1000000 });
  assert.equal(saved.status, 200);
  const response = await a.call('GET', '/insights');
  assert.equal(response.status, 200);
  const alert = response.body.insights.find((item) => item.kind === 'cash-shortage');
  assert.ok(alert);
  assert.match(alert.detail, /estimate/);
});

test('Gemini receives tenant financial context, retains follow-up context, and fails clearly; PDF report uses stored records', async () => {
  const a = agent(); await reg(a, 'horizon-ai@example.com');
  const today = (await a.call('GET', '/financial-setup')).body.today;
  await a.call('POST', '/transactions', { date: today, description: 'Confirmed design retainer receipt', vendor: 'Northwind', category: 'Client income', amount: '750.25', type: 'income' });
  geminiPayload = { answer: 'The retainer receipt is in the recent recorded activity.', citations: [{ recordId: 'source-1', label: 'Retainer' }], recommendations: ['Compare future expected receipts with invoice due dates.'], unsupported: false };
  geminiStatus = 200;
  const first = await a.call('POST', '/gemini/ask', { question: 'What happened to cash today?' });
  assert.equal(first.status, 200); assert.equal(first.body.citations.length, 1); assert.ok(first.body.threadId);
  const firstPrompt = geminiRequests.at(-1).body.contents[0].parts[0].text;
  assert.match(firstPrompt, /Confirmed design retainer receipt/); assert.match(firstPrompt, /recordedCash/); assert.doesNotMatch(firstPrompt, /cashBalanceCents/);
  const followup = await a.call('POST', '/gemini/ask', { question: 'How does that compare with the forecast?', threadId: first.body.threadId });
  assert.equal(followup.status, 200);
  assert.match(geminiRequests.at(-1).body.contents[0].parts[0].text, /What happened to cash today\?/);
  const aiUser = await db.collection('users').findOne({ email: 'horizon-ai@example.com' });
  assert.equal(await db.collection('geminiThreads').countDocuments({ businessId: aiUser.businessId }), 1);
  geminiStatus = 429;
  assert.equal((await a.call('POST', '/gemini/ask', { question: 'Try again' })).status, 429);
  geminiStatus = 200;
  const report = await a.call('GET', '/reports/pdf?year=2026');
  assert.equal(report.status, 200); assert.equal(report.headers.get('content-type'), 'application/pdf');
  assert.equal(report.body.subarray(0, 5).toString(), '%PDF-');
  assert.match(report.body.toString('latin1'), /FINANCIAL REPORT/);
  assert.match(report.body.toString('latin1'), /Client income/);
  assert.match(report.body.toString('latin1'), /750\.25/);
  const b = agent(); await reg(b, 'horizon-pdf-other@example.com');
  assert.doesNotMatch((await b.call('GET', '/reports/pdf?year=2026')).body.toString('latin1'), /750\.25/);
});

test('public contact form is gated by configuration, rate-limited, and sends plain text to the configured inbox', async () => {
  const previousRecipient = process.env.MORGAN_CONTACT_EMAIL;
  const a = agent();
  try {
    delete process.env.MORGAN_CONTACT_EMAIL;
    assert.deepEqual((await a.call('GET', '/contact/status')).body, { available: false });
    assert.equal((await a.call('POST', '/contact', { name: 'Sample Visitor', email: 'visitor@example.test', topic: 'Other', message: 'A sufficiently long contact message.' })).status, 503);
    assert.equal((await a.call('POST', '/contact', { website: 'automated-bot' })).status, 200);
    process.env.MORGAN_CONTACT_EMAIL = 'contact@example.test';
    assert.deepEqual((await a.call('GET', '/contact/status')).body, { available: true });
    const sent = await a.call('POST', '/contact', { name: 'Sample Visitor', email: 'visitor@example.test', topic: 'Product question', message: 'Please tell me more about Horizon.' });
    assert.equal(sent.status, 202);
    const message = resendRequests.at(-1);
    assert.deepEqual(message.to, ['contact@example.test']);
    assert.equal(message.reply_to, 'visitor@example.test');
    assert.match(message.text, /Please tell me more about Horizon/);
    assert.equal(message.html, undefined);
  } finally {
    if (previousRecipient === undefined) delete process.env.MORGAN_CONTACT_EMAIL;
    else process.env.MORGAN_CONTACT_EMAIL = previousRecipient;
  }
});

test('business data is strictly isolated between accounts', async () => {
  const a = agent(), b = agent();
  await reg(a, 'carol@example.com');
  await reg(b, 'dave@example.com');
  const t = await a.call('POST', '/transactions', { date: '2026-10-01', description: 'Rent', vendor: 'Harbor', category: 'Rent', amount: '1850.00', type: 'expense' });
  assert.equal(t.body.amountCents, -185000);
  const c = await a.call('POST', '/customers', { name: 'Private Co' });
  const inv = await a.call('POST', '/invoices', { customerId: c.body.id, issueDate: '2026-10-01', dueDate: '2026-11-01', items: [{ description: 'x', quantity: 1, unitCents: 500 }] });

  assert.equal((await b.call('GET', '/transactions')).body.total, 1, 'the other account contains only its own onboarding statement');
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
  assert.equal((await a.call('GET', '/transactions')).body.total, 2);
});

test('bank accounts isolate data and statement imports are reviewed, persistent and deduplicated', async () => {
  const a = agent(), b = agent();
  await reg(a, 'bank-a@example.com'); await reg(b, 'bank-b@example.com');
  const created = await a.call('POST', '/bank-accounts', { institution: 'North Bank', name: 'Operating', type: 'checking', currency: 'USD', accountNumber: '001234', openingBalanceCents: 100000, openingBalanceDate: '2026-09-01' });
  assert.equal(created.status, 201); assert.equal(created.body.maskedIdentifier, '•••• 1234'); assert.equal('accountNumber' in created.body, false);
  const rows = [{ date: '2026-09-12', description: 'Studio rent', vendor: 'Studio', amountCents: -25000, currency: 'USD', reference: 'R-12', runningBalanceCents: 75000 }];
  const verifiedUpload = statementUpload(rows);
  const preview = await a.call('POST', '/bank-statements/preview', { accountId: created.body.id, filename: 'october.csv', ...verifiedUpload, statementPeriodStart: '2026-09-01', statementPeriodEnd: '2026-09-30' });
  assert.equal(preview.status, 200); assert.equal(preview.body.summary.discrepancyCents, 0); assert.equal(preview.body.rows[0].duplicate, false);
  const invalidFile = await a.call('POST', '/bank-statements/import', { accountId: created.body.id, filename: 'statement.pdf', sourceFileBase64: statementFile, openingBalanceCents: 100000, closingBalanceCents: 75000, rows });
  assert.equal(invalidFile.status, 400, 'file contents must match their extension before anything is persisted');
  assert.equal(await db.collection('statementImports').countDocuments({ filename: 'statement.pdf' }), 0);
  const imported = await a.call('POST', '/bank-statements/import', { accountId: created.body.id, filename: 'october.csv', ...verifiedUpload, statementPeriodStart: '2026-09-01', statementPeriodEnd: '2026-09-30' });
  assert.equal(imported.status, 201); assert.equal(imported.body.imported, 1);
  assert.equal(imported.body.emailNotification.status, 'accepted', 'statement import confirmation was accepted by the provider');
  const repeat = await a.call('POST', '/bank-statements/import', { accountId: created.body.id, filename: 'different-name.csv', ...verifiedUpload, statementPeriodStart: '2026-09-01', statementPeriodEnd: '2026-09-30' });
  assert.equal(repeat.status, 201); assert.equal(repeat.body.imported, 0); assert.equal(repeat.body.duplicates, 1);
  const txns = await a.call('GET', '/transactions'); assert.equal(txns.body.total, 2); assert.ok(txns.body.items.some((item) => item.source === 'bank-statement'));
  assert.equal(txns.body.income, 0); assert.equal(txns.body.expenses, 0); assert.equal(txns.body.unclassified, 2);
  const importedTxn = txns.body.items.find((item) => item.description === 'Studio rent');
  assert.equal((await a.call('PATCH', `/bank-transactions/${importedTxn.id}/classification`, { financialClass: 'expense', category: 'Rent' })).status, 200);
  const classified = await a.call('GET', '/transactions');
  assert.equal(classified.body.expenses, 25000); assert.equal(classified.body.unclassified, 1);
  assert.equal((await a.call('GET', '/reports/pnl?year=2026')).body.expenses[0].total, 25000);
  const accounts = await a.call('GET', '/bank-accounts'); assert.equal(accounts.body[0].calculatedBalanceCents, 75000); assert.equal(accounts.body[0].latestImport.duplicateCount, 1);
  const storedStatement = await db.collection('statementImports').findOne({ businessId: (await db.collection('users').findOne({ email: 'bank-a@example.com' })).businessId, filename: 'october.csv' });
  assert.deepEqual(Buffer.from(storedStatement.sourceFile.buffer), Buffer.from(verifiedUpload.sourceFileBase64, 'base64'));
  assert.equal(storedStatement.sourceFileSha256.length, 64);
  const imports = await a.call('GET', `/bank-accounts/${created.body.id}/imports`);
  assert.equal(imports.body.find((x) => x.filename === 'october.csv').sourceFileStored, true);
  assert.equal('sourceFile' in imports.body.find((x) => x.filename === 'october.csv'), false);
  const coverage = await a.call('GET', '/reports/coverage?year=2026');
  assert.equal(coverage.body.months.find((m) => m.month === '2026-09').accounts[0].status, 'complete');
  assert.equal((await a.call('GET', '/overview')).body.cash, 75100, 'all complete statement-backed cash accounts are consolidated');
  assert.equal((await b.call('GET', '/reports/coverage?year=2026')).body.accounts.length, 1, 'the other workspace contains only its own registration account');
  const withoutBaseline = await a.call('POST', '/bank-accounts', { institution: 'North Bank', name: 'No opening point', type: 'checking', currency: 'USD' });
  assert.equal((await a.call('GET', '/bank-accounts')).body.find((item) => item.id === withoutBaseline.body.id).calculatedBalanceCents, null, 'transaction movement alone is not presented as an account balance');
  const partialCash = await a.call('GET', '/overview');
  assert.equal(partialCash.body.cash, null, 'a partial set of account balances is not presented as the total available cash');
  assert.deepEqual(partialCash.body.cashDetails.missingAccounts, ['No opening point']);
  assert.equal((await b.call('PATCH', `/bank-transactions/${txns.body.items[0].id}/classification`, { financialClass: 'expense', category: 'Rent' })).status, 404);
  const refund = { date: '2026-10-14', description: 'Studio rent refund', vendor: 'Studio', amountCents: 5000, currency: 'USD', reference: 'R-REFUND' };
  const refundUpload = statementUpload([refund], 75000);
  await a.call('POST', '/bank-statements/import', { accountId: created.body.id, filename: 'refund.csv', ...refundUpload });
  const refundTxn = (await a.call('GET', '/transactions')).body.items.find((t) => t.description === refund.description);
  assert.equal((await a.call('PATCH', `/bank-transactions/${refundTxn.id}/classification`, { financialClass: 'refund', category: 'Rent' })).status, 200);
  assert.equal((await a.call('GET', '/transactions')).body.expenses, 20000);
  assert.equal((await a.call('GET', `/bank-accounts/${created.body.id}/imports`)).body.length, 3);
  assert.equal((await b.call('GET', '/bank-accounts')).body.length, 1, 'the other workspace contains only its own statement-backed account');
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
  const accountBalances = new Map([[account.body.id, 100000]]);
  const importOne = (rows, filename, accountId = account.body.id) => { const upload = statementUpload(rows, accountBalances.get(accountId) ?? 100000); accountBalances.set(accountId, upload.closingBalanceCents); return a.call('POST', '/bank-statements/import', { accountId, filename, ...upload }); };
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
  assert.equal(ov1.body.cash, 1000000 + 500000 - 19998 + 100);
  assert.equal(ov1.body.payables.outstanding, 185000);
  await a.call('POST', `/bills/${bill.body.id}/pay`, { date: today, amountCents: 50000 });
  const partialBill = (await a.call('GET', '/bills')).body.find((item) => item.id === bill.body.id);
  assert.equal(partialBill.status, 'partial'); assert.equal(partialBill.amountPaidCents, 50000); assert.equal(partialBill.balanceDueCents, 135000);
  const partialOverview = await a.call('GET', '/overview');
  assert.equal(partialOverview.body.payables.outstanding, 135000);
  assert.equal(partialOverview.body.cash, 1000000 + 500000 - 19998 - 50000 + 100);
  await a.call('POST', `/bills/${bill.body.id}/pay`, { date: today });
  const ov2 = await a.call('GET', '/overview');
  assert.equal(ov2.body.cash, 1000000 + 500000 - 19998 - 185000 + 100);
  assert.equal(ov2.body.period.income, 500000);
  assert.equal(ov2.body.period.expenses, 19998 + 185000);
  const ins = await a.call('GET', '/insights');
  assert.ok(ins.body.insights.some((i) => i.kind === 'duplicate' && i.amountCents === 9999));
  const sp = await a.call('GET', '/spending');
  assert.equal(sp.body.total, 19998 + 185000);
  assert.equal(sp.body.byCategory[0].name, 'Rent');
  const cf = await a.call('GET', '/cashflow');
  assert.equal(cf.body.opening, ov2.body.cash);
  assert.equal(cf.body.weeks.length, 5, 'Starter cash-flow forecast stops within its 30-day allowance');
});

test('password change signs out other sessions; account deletion removes data', async () => {
  const a = agent(), other = agent();
  await reg(a, 'frank@example.com');
  const frank = await db.collection('users').findOne({ email: 'frank@example.com' });
  await other.call('POST', '/auth/login', { email: 'frank@example.com', password: 'correct horse 42' });
  assert.equal((await a.call('POST', '/account/password', { currentPassword: 'bad', newPassword: 'new password 99' })).status, 401);
  const ch = await a.call('POST', '/account/password', { currentPassword: 'correct horse 42', newPassword: 'new password 99' });
  assert.equal(ch.body.signedOut, 1);
  assert.equal(ch.body.emailNotification.status, 'accepted', 'password change security email was accepted by the provider');
  assert.equal((await other.call('GET', '/auth/me')).body.user, null);
  assert.equal((await a.call('GET', '/auth/me')).body.user.email, 'frank@example.com');
  await a.call('POST', '/transactions', { date: '2026-10-01', description: 'x', amount: '5', type: 'income' });
  const retainedPaymentId = `retention-${frank._id}`;
  await db.collection('planPayments').insertOne({ _id: retainedPaymentId, userId: frank._id, status: 'pending_verification', createdAt: new Date() });
  await db.collection('paypalPaymentIdentifiers').insertOne({ paymentId: retainedPaymentId, userId: frank._id, paypalIdentifier: 'frank@example.com' });
  assert.equal((await a.call('DELETE', '/account', { password: 'new password 99' })).status, 200);
  assert.equal(await db.collection('users').countDocuments({ email: 'frank@example.com' }), 0);
  const retainedPayment = await db.collection('planPayments').findOne({ _id: retainedPaymentId });
  assert.equal(retainedPayment.status, 'cancelled');
  assert.ok(retainedPayment.purgeAt instanceof Date);
  assert.ok((await db.collection('paypalPaymentIdentifiers').findOne({ paymentId: retainedPaymentId })).purgeAt instanceof Date);
  assert.ok((await db.collection('policyAcceptances').findOne({ userId: frank._id })).purgeAt instanceof Date);
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
  const created = await rawReg(a, 'planner@example.com');
  await verifySignup(a, 'planner@example.com');
  await reg(other, 'different-planner@example.com');
  assert.equal(created.body.business.financialSetupComplete, false);
  const setup = await a.call('GET', '/financial-setup');
  assert.equal(setup.body.business.financialSetupComplete, false);
  const today = setup.body.today;
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
  assert.equal((await a.call('GET', '/overview')).status, 403, 'financial API remains unavailable during onboarding');
  assert.equal((await a.call('PATCH', '/financial-setup', { onboardingStep: 1 })).status, 200);
  assert.equal((await a.call('PATCH', '/financial-setup', { onboardingStep: 2 })).status, 400, 'expected activity requires an explicit review confirmation');
  assert.equal((await a.call('PATCH', '/financial-setup', { onboardingStep: 2, expectedActivityReviewed: true })).status, 200);
  assert.equal((await a.call('PATCH', '/financial-setup', { onboardingStep: 3 })).status, 200);
  const monthly = await a.call('POST', '/planning-items', { name: 'Software subscription', type: 'expense', category: 'Software', amountCents: 20000, cadence: 'monthly', nextDate: plus(1), confidence: 'planned' });
  const oneTime = await a.call('POST', '/planning-items', { name: 'Equipment purchase', type: 'expense', category: 'Equipment', amountCents: 50000, cadence: 'once', nextDate: plus(8), confidence: 'planned' });
  assert.equal(monthly.status, 201); assert.equal(oneTime.status, 201);
  const initiallyCompleted = await a.call('PATCH', '/financial-setup', { complete: true }); assert.equal(initiallyCompleted.status, 200);
  const forecast = await a.call('GET', '/cashflow');
  const scheduled = forecast.body.weeks.flatMap((w) => w.items).filter((i) => i.type === 'planned');
  const subRows = scheduled.filter((i) => i.id === monthly.body.id);
  assert.ok(subRows.length >= 1, 'monthly recurrence remains visible inside the 30-day Starter horizon');
  const spendPlan = await a.call('GET', '/spending');
  assert.equal(spendPlan.body.plannedRecurring.find((i) => i.id === monthly.body.id).monthlyEstimateCents, 20000, 'planned recurring costs appear separately in Spending');
  assert.equal(scheduled.find((i) => i.id === oneTime.body.id).amountCents, -50000);
  assert.equal(scheduled.find((i) => i.id === oneTime.body.id).date, plus(8));
  assert.equal(await db.collection('transactions').countDocuments({ businessId: new (await import('mongodb')).ObjectId(created.body.business.id) }), 1, 'only the imported onboarding statement is present; expected items remain planned');
  const edited = await a.call('PATCH', `/planning-items/${monthly.body.id}`, { name: 'Software subscription', type: 'expense', category: 'Software', amountCents: 25000, cadence: 'monthly', nextDate: plus(1), confidence: 'planned' });
  assert.equal(edited.body.amountCents, 25000);
  const afterEdit = await a.call('GET', '/cashflow');
  assert.ok(afterEdit.body.weeks.flatMap((w) => w.items).filter((i) => i.id === monthly.body.id).every((i) => i.amountCents === -25000));
  assert.equal((await a.call('GET', '/spending')).body.plannedRecurring.find((i) => i.id === monthly.body.id).monthlyEstimateCents, 25000, 'spending plan recalculates after edit');
  const overview = await a.call('GET', '/overview');
  assert.equal(overview.body.cash, 1200000);
  assert.equal(overview.body.financialPlan.monthlyBudgetCents, 100000);
  assert.equal(overview.body.financialPlan.forecast.days90, null, 'Starter dashboard does not expose a 90-day forecast');
  assert.deepEqual((await other.call('GET', '/planning-items')).body, []);
  assert.equal((await other.call('PATCH', `/planning-items/${monthly.body.id}`, { name: 'x', type: 'expense', category: 'x', amountCents: 1, cadence: 'once', nextDate: today })).status, 404);
  assert.equal((await a.call('DELETE', `/planning-items/${oneTime.body.id}`)).status, 200);
  assert.equal((await a.call('GET', '/planning-items')).body.length, 1);
  assert.ok(!(await a.call('GET', '/cashflow')).body.weeks.flatMap((w) => w.items).some((i) => i.id === oneTime.body.id), 'deleting a plan removes its future forecast occurrence');
  assert.equal(await db.collection('transactions').countDocuments({ businessId: new (await import('mongodb')).ObjectId(created.body.business.id) }), 1, 'removing a plan leaves the imported onboarding statement untouched');
  const done = await a.call('PATCH', '/financial-setup', { complete: true });
  assert.equal(done.body.business.financialSetupComplete, true);
  assert.equal(initiallyCompleted.body.emailNotification.status, 'accepted');
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
