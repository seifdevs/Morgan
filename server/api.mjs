import express from 'express';
import { ObjectId } from 'mongodb';
import { randomBytes, createHash } from 'node:crypto';
import { invoiceTotals, formatMoney } from '../shared/money.js';
import {
  HttpError, bad, str, email, date, cents, int, oneOf, oid, today, addDays, escapeRegex,
} from './lib/validate.mjs';
import {
  hashPassword, verifyPassword, DUMMY_HASH, createSession, sessionCookie, validatePassword,
  loadSession, requireAuth, requireAdmin, rateLimit, hashToken,
} from './lib/auth.mjs';
import { invoicePdf } from './lib/pdf.mjs';
import { financialReportPdf } from './lib/reportPdf.mjs';
import { mailConfigured, sendMail, notifyMail, localEmailPreviewEnabled, listLocalEmailPreviews } from './lib/mail.mjs';
import * as A from './lib/analytics.mjs';
import { horizonForecast } from './lib/horizon.mjs';
import { askGemini, formattedMoneyValues, validateGeminiAnswer } from './lib/gemini.mjs';
import { parseRegistrationStatement, parseMappedStatement } from './lib/registrationStatement.mjs';
import { accountPlan, finalizeUsage, plans, releaseUsage, reserveUsage, usageSummary } from './lib/entitlements.mjs';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'EGP', 'AED', 'SAR', 'CHF', 'JPY'];
const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'void'];
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const publicUser = (u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role === 'admin' ? 'admin' : 'user', createdAt: u.createdAt });
const publicBusiness = (b) => ({
  id: String(b._id), name: b.name, currency: b.currency, address: b.address || '', email: b.email || '',
  invoicePrefix: b.invoicePrefix, defaultTaxRateBps: b.defaultTaxRateBps || 0, paymentTermsDays: b.paymentTermsDays ?? 14,
  openingBalanceCents: b.openingBalanceCents || 0, openingBalanceDate: b.openingBalanceDate || null, timezone: b.timezone || 'UTC',
  financialSetupComplete: b.financialSetupComplete ?? true, onboardingStep: b.onboardingStep ?? 0, isDemo: b.isDemo === true, industry: b.industry || '', monthlyBudgetCents: b.monthlyBudgetCents ?? null, minimumCashCents: b.minimumCashCents ?? null,
  cashAccounts: (b.cashAccounts || []).map(({ _id, ...a }) => ({ id: String(_id), ...a })),
});
const pub = ({ _id, businessId, quotaReservationId, ...rest }) => ({ id: String(_id), ...rest });

export function decorateInvoice(inv, now = today()) {
  const totals = invoiceTotals(inv);
  const amountPaid = (inv.payments || []).reduce((s, p) => s + p.amountCents, 0);
  const balanceDue = totals.total - amountPaid;
  let displayStatus = inv.status;
  if (inv.status === 'sent') displayStatus = amountPaid > 0 ? 'partial' : 'sent';
  if (inv.status === 'sent' && inv.dueDate < now) displayStatus = 'overdue';
  const { _id, businessId, quotaReservationId, ...rest } = inv;
  return {
    id: String(_id), ...rest, totals, amountPaid, balanceDue, displayStatus,
    payments: (inv.payments || []).map((p) => ({ ...p, id: String(p.id), transactionId: p.transactionId ? String(p.transactionId) : null })),
    customerId: inv.customerId ? String(inv.customerId) : null,
  };
}

export function decorateBill(bill) {
  const { _id, businessId, quotaReservationId, ...rest } = bill;
  const legacyPaid = bill.status === 'paid' && !(bill.payments || []).length;
  const amountPaidCents = legacyPaid ? bill.amountCents : (bill.payments || []).reduce((sum, p) => sum + p.amountCents, 0);
  const balanceDueCents = Math.max(0, bill.amountCents - amountPaidCents);
  const status = balanceDueCents === 0 ? 'paid' : amountPaidCents > 0 ? 'partial' : 'unpaid';
  return { id: String(_id), ...rest, status, amountPaidCents, balanceDueCents, payments: (bill.payments || []).map((p) => ({ ...p, id: String(p.id), transactionId: p.transactionId ? String(p.transactionId) : null })) };
}

const validTz = (tz) => { try { return typeof tz === 'string' && !!new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { return false; } };
export const todayIn = (tz) => (validTz(tz) ? new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()) : today());
const dec = (req, inv) => decorateInvoice(inv, req.today);

export function createApi(db, { secureCookies }) {
  const r = express.Router();
  const C = (n) => db.collection(n);
  // Base64 expands a 10 MB statement to roughly 13.4 MB. Keep the larger bound
  // scoped to the authenticated statement import endpoint.
  r.use(['/bank-statements/import', '/bank-statements/preview', '/auth/register', '/auth/statement-preview'], express.json({ limit: '17mb' }));
  r.use(express.json({ limit: '2mb' }));

  // CSRF defence: state-changing requests must carry a custom header, which cross-site forms cannot set
  // without a CORS preflight (no CORS is enabled). Combined with SameSite=Lax cookies.
  r.use((req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-morgan-csrf') !== '1') return next(new HttpError(403, 'Missing request header'));
    next();
  });
  r.use(loadSession(db));

  const setCookie = (res, token, maxAgeMs) => res.setHeader('Set-Cookie', sessionCookie(token, { secure: secureCookies, maxAgeMs }));
  const scoped = (req, extra = {}) => ({ businessId: req.businessId, ...extra });
  const business = (req) => C('businesses').findOne({ _id: req.businessId });
  const planFor = (req) => accountPlan(req.user);
  const createWithUsage = async (req, metric, amount, create, details = {}) => {
    const reservation = amount ? await reserveUsage(db, { businessId: req.businessId, planId: planFor(req), metric, amount }) : null;
    try {
      const value = await create(reservation?.token);
      if (reservation) await finalizeUsage(db, reservation, details);
      return value;
    } catch (error) {
      await releaseUsage(db, reservation);
      throw error;
    }
  };
  const claimScenarioSlot = async (req, scenarioId) => {
    const bizId = req.businessId, limit = plans[planFor(req)].limits.scenariosPerWorkspace;
    const existing = await C('horizonScenarios').find(scoped(req), { projection: { _id: 1 } }).toArray();
    const ids = existing.map((item) => String(item._id));
    await C('businesses').updateOne({ _id: bizId, scenarioSlotsInitialized: { $ne: true } }, { $set: { activeScenarioIds: ids, scenarioSlotsInitialized: true } });
    const result = await C('businesses').updateOne({ _id: bizId, $expr: { $lt: [{ $size: { $ifNull: ['$activeScenarioIds', []] } }, limit] } }, { $addToSet: { activeScenarioIds: String(scenarioId) } });
    if (!result.modifiedCount) throw new HttpError(429, `Saved scenario limit reached for ${plans[planFor(req)].name}. Remove a scenario or upgrade your plan.`);
  };
  const appOrigin = () => (process.env.APP_URL || '').replace(/\/$/, '');
  const emailLink = (path, token) => `${appOrigin()}/${path}?token=${encodeURIComponent(token)}`;
  const sendVerification = async (user) => {
    const token = randomBytes(32).toString('base64url');
    await C('verificationTokens').deleteMany({ userId: user._id });
    await C('verificationTokens').insertOne({ _id: hashToken(token), userId: user._id, expiresAt: new Date(Date.now() + 24 * 3600e3) });
    try {
      return await sendMail({ db, kind: 'verification', to: user.email, subject: 'Verify your Morgan email', text: `Hi ${user.name},\n\nVerify your email address to finish creating your Morgan account. This link expires in 24 hours and can only be used once:\n${emailLink('verify-email', token)}\n\nIf you did not create this account, you can ignore this message.` });
    } catch (error) {
      return { status: error.deliveryStatus || 'unknown', code: error.code || 'DELIVERY_FAILED', providerStatus: error.providerStatus ?? null, message: error.message, retryable: Boolean(error.retryable) };
    }
  };
  const notifyAccount = (user, subject, text, kind = 'account_notification') => notifyMail({ db, kind, to: user.email, subject, text });

  /* ---------------- Auth ---------------- */
  r.get('/bank-directory', wrap(async (req, res) => {
    const country = String(req.query.country || '');
    if (country !== 'US') throw bad('Morgan currently supports bank selection for the United States (US).');
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
    const query = { country };
    if (q) query.name = { $regex: escapeRegex(q), $options: 'i' };
    const banks = await C('bankDirectory').find(query, { projection: { _id: 0, id: 1, name: 1, state: 1, rank: 1 } }).sort({ rank: 1 }).limit(100).toArray();
    const meta = await C('bankDirectory').findOne({ country }, { projection: { source: 1, sourceName: 1, sourceUpdatedAt: 1 } });
    res.json({ country, currency: 'USD', banks, source: meta?.source || 'https://api.fdic.gov/banks/institutions', sourceName: meta?.sourceName || 'FDIC BankFind Suite', sourceUpdatedAt: meta?.sourceUpdatedAt || null });
  }));
  r.get('/contact/status', (_req, res) => {
    res.json({ available: Boolean(process.env.MORGAN_CONTACT_EMAIL && mailConfigured()) });
  });
  r.post('/contact', rateLimit({ key: 'public-contact', limit: 5, windowMs: 60 * 60e3 }), wrap(async (req, res) => {
    const body = req.body || {};
    // Quietly accept honeypot submissions without forwarding them.
    if (typeof body.website === 'string' && body.website.trim()) return res.json({ ok: true });
    const recipient = String(process.env.MORGAN_CONTACT_EMAIL || '').trim();
    if (!recipient || !mailConfigured()) throw new HttpError(503, 'The contact form is not available right now. Please try again later.');
    const name = str(body.name, 'Name', { required: true, max: 100 });
    const sender = email(body.email);
    const topic = oneOf(body.topic, 'Topic', ['Product question', 'Technical support', 'Partnership', 'Other']);
    const message = str(body.message, 'Message', { required: true, min: 10, max: 4000 });
    await sendMail({ db, to: recipient, replyTo: sender, kind: 'contact', subject: `Morgan contact · ${topic}`, text: `From: ${name}\nReply to: ${sender}\nTopic: ${topic}\n\n${message}` });
    res.status(202).json({ ok: true });
  }));
  const statementBalanceReview = async (parsed, b) => {
    const openingBalanceCents = cents(b.openingBalanceCents, 'Statement opening balance');
    const closingBalanceCents = cents(b.closingBalanceCents, 'Statement closing balance');
    const uniqueRows = dedupeRegistrationRows(parsed.rows).filter((row) => !row.duplicate);
    const sum = uniqueRows.reduce((n, row) => n + row.amountCents, 0);
    const calculatedClosingBalanceCents = openingBalanceCents + sum;
    const running = uniqueRows.filter((row) => row.runningBalanceCents !== null);
    if (running.length && running.length !== uniqueRows.length) throw bad('The statement has a running balance on only some transaction rows. Review the source or upload a consistent export.');
    if (running.length) {
      let current = openingBalanceCents;
      for (const [i, row] of uniqueRows.entries()) {
        current += row.amountCents;
        if (Math.abs(current - row.runningBalanceCents) > 1) throw bad(`Statement running balance does not reconcile at transaction row ${row.sourceRowNumber}.`);
      }
    }
    if (Math.abs(calculatedClosingBalanceCents - closingBalanceCents) > 1) throw bad(`Statement totals do not reconcile: opening balance plus ${uniqueRows.length} non-duplicate transactions gives ${calculatedClosingBalanceCents} cents, not the supplied closing balance. Check your statement period and balances.`);
    const periodStart = uniqueRows.reduce((a, r) => r.date < a ? r.date : a, uniqueRows[0].date);
    const periodEnd = uniqueRows.reduce((a, r) => r.date > a ? r.date : a, uniqueRows[0].date);
    return { openingBalanceCents, closingBalanceCents, calculatedClosingBalanceCents, discrepancyCents: closingBalanceCents - calculatedClosingBalanceCents, periodStart, periodEnd, count: parsed.rows.length, duplicates: parsed.rows.length - uniqueRows.length, creditsCents: uniqueRows.reduce((s, r) => s + Math.max(0, r.amountCents), 0), debitsCents: uniqueRows.reduce((s, r) => s + Math.max(0, -r.amountCents), 0) };
  };
  const dedupeRegistrationRows = (rows, accountKey = 'registration') => {
    const seen = new Set();
    return rows.map((row) => {
      const key = [accountKey, row.date, row.currency, row.reference ? `ref:${row.reference.toLowerCase()}` : `${row.amountCents}:${row.description.toLowerCase().replace(/\s+/g, ' ').trim()}`].join('|');
      const duplicate = seen.has(key); seen.add(key); return { ...row, duplicate };
    });
  };
  r.post('/auth/statement-preview', rateLimit({ key: 'statement-preview', limit: 10, windowMs: 3600e3 }), wrap(async (req, res) => {
    const currency = oneOf(req.body?.currency, 'Currency', ['USD']);
    let parsed;
    try { parsed = await parseRegistrationStatement({ filename: req.body?.filename, base64: req.body?.sourceFileBase64, currency }); }
    catch (error) { throw bad(error.message || 'The statement could not be processed.'); }
    const rows = dedupeRegistrationRows(parsed.rows);
    const uniqueRows = rows.filter((r) => !r.duplicate);
    res.json({ rows, headers: parsed.columns, fileType: parsed.fileType, summary: { count: rows.length, duplicates: rows.length - uniqueRows.length, periodStart: uniqueRows.reduce((a, r) => r.date < a ? r.date : a, uniqueRows[0].date), periodEnd: uniqueRows.reduce((a, r) => r.date > a ? r.date : a, uniqueRows[0].date), creditsCents: uniqueRows.reduce((s, r) => s + Math.max(0, r.amountCents), 0), debitsCents: uniqueRows.reduce((s, r) => s + Math.max(0, -r.amountCents), 0) } });
  }));
  r.post('/auth/register', rateLimit({ key: 'register', limit: 5, windowMs: 3600e3 }), wrap(async (req, res) => {
    const b = req.body || {};
    const name = str(b.name, 'Name', { required: true, max: 100 });
    const mail = email(b.email);
    const password = validatePassword(b.password);
    const businessName = str(b.businessName, 'Business name', { required: true, max: 120 });
    const currency = oneOf(b.currency || 'USD', 'Currency', CURRENCIES);
    const country = oneOf(b.country, 'Country', ['US']);
    if (currency !== 'USD') throw bad('United States bank statement registration requires USD.');
    if (b.statementCurrencyConfirmed !== true) throw bad('Confirm the statement is denominated in USD before registering it.');
    const bank = await C('bankDirectory').findOne({ country, id: str(b.bankId, 'Bank', { required: true, max: 32 }) });
    if (!bank) throw bad('Select a bank from the current bank directory.');
    const filename = str(b.statementFilename, 'Statement filename', { required: true, max: 180 });
    let parsed, statementSummary;
    try { parsed = await parseRegistrationStatement({ filename, base64: b.statementFileBase64, currency }); statementSummary = await statementBalanceReview(parsed, b); }
    catch (error) { throw bad(error.message || 'The statement could not be validated.'); }
    if (b.statementReviewed !== true) throw bad('Review the extracted statement transactions and confirm before creating your account.');
    const reviewedRows = dedupeRegistrationRows(parsed.rows, b.bankId);
    const duplicateCount = reviewedRows.filter((row) => row.duplicate).length;
    if (duplicateCount && b.duplicatesReviewed !== true) throw bad('Confirm that repeated statement rows should be skipped before creating the account.');
    const timezone = validTz(b.timezone) ? b.timezone : 'UTC';
    if (await C('users').findOne({ email: mail })) throw new HttpError(409, 'An account with this email already exists');
    const businessId = new ObjectId();
    const isConfiguredAdmin = mail === String(process.env.MORGAN_ADMIN_EMAIL || '').trim().toLowerCase();
    // Email confirmation is temporarily disabled. Password validation and the normal
    // server-side session remain required for access.
    const user = { _id: new ObjectId(), name, email: mail, role: isConfiguredAdmin ? 'admin' : 'user', planId: 'starter', billingStatus: 'free', passwordHash: await hashPassword(password), businessId, emailVerified: true, emailVerificationDisabled: true, createdAt: new Date() };
    const accountId = new ObjectId(), importId = new ObjectId(), importedAt = new Date();
    const statementQuery = { businessId };
    let registrationReservation;
    try {
    await C('businesses').insertOne({
      _id: businessId, name: businessName, currency, timezone, invoicePrefix: 'INV-', invoiceSeq: 0, defaultTaxRateBps: 0,
      paymentTermsDays: 14, openingBalanceCents: statementSummary.closingBalanceCents, openingBalanceDate: statementSummary.periodEnd, financialSetupComplete: false, onboardingStep: 0, country, monthlyBudgetCents: null, minimumCashCents: null, ownerId: user._id, createdAt: new Date(),
    });
    await C('bankAccounts').insertOne({ _id: accountId, businessId, institution: bank.name, directoryId: bank.id, country, name: 'Primary business account', type: 'checking', currency, accountNumber: '', openingBalanceCents: statementSummary.openingBalanceCents, openingBalanceDate: statementSummary.periodStart, status: 'active', createdAt: importedAt, updatedAt: importedAt });
    const docs = reviewedRows.filter((row) => !row.duplicate).map((row) => {
      const fingerprint = createHash('sha256').update([String(accountId), row.date, currency, row.reference ? `ref:${row.reference.toLowerCase()}` : `${row.amountCents}:${row.description.toLowerCase().replace(/\s+/g, ' ').trim()}`].join('|')).digest('hex');
      return { businessId, accountId, date: row.date, description: row.description, vendor: row.vendor || '', category: 'Uncategorized', financialClass: 'unclassified', amountCents: row.amountCents, currency, reference: row.reference, runningBalanceCents: row.runningBalanceCents, sourceRowNumber: row.sourceRowNumber, source: 'bank-statement', importId, fingerprint, reconciliationStatus: 'unmatched', createdAt: importedAt, updatedAt: importedAt };
    });
    if (docs.length) registrationReservation = await reserveUsage(db, { businessId, planId: 'starter', metric: 'financialRecords', amount: docs.length, now: importedAt });
    if (registrationReservation) docs.forEach((doc) => { doc.quotaReservationId = registrationReservation.token; });
    await C('transactions').insertMany(docs);
    await C('statementImports').insertOne({ _id: importId, businessId, accountId, filename, fileType: parsed.fileType, sourceFile: parsed.sourceFile, sourceFileSha256: parsed.sourceFileSha256, importedAt, status: 'complete', ...statementSummary, transactionCount: parsed.rows.length, importedCount: docs.length, duplicateCount });
    await C('users').insertOne(user);
    if (registrationReservation) await finalizeUsage(db, registrationReservation, { entity: 'registration-statement-import' });
    } catch (e) {
      await releaseUsage(db, registrationReservation);
      await Promise.all([
        C('transactions').deleteMany(statementQuery), C('statementImports').deleteMany(statementQuery),
        C('bankAccounts').deleteMany(statementQuery), C('businesses').deleteOne({ _id: businessId }),
        C('users').deleteOne({ _id: user._id }),
      ]);
      if (e.code === 11000) throw new HttpError(409, 'An account with this email already exists');
      throw e;
    }
    setCookie(res, await createSession(db, user, req));
    res.status(201).json({ user: publicUser(user), business: publicBusiness(await business({ businessId: user.businessId })) });
  }));

  r.post('/auth/demo', rateLimit({ key: 'demo-account', limit: 10, windowMs: 3600e3 }), wrap(async (req, res) => {
    const id = new ObjectId(), businessId = new ObjectId(), now = new Date();
    const user = { _id: id, name: 'Morgan Demo User', email: `demo-${id}@example.invalid`, role: 'user', planId: 'starter', billingStatus: 'free', passwordHash: '', businessId, emailVerified: true, isDemo: true, createdAt: now };
    const openingDate = today();
    const businessDoc = { _id: businessId, name: 'Northstar Creative Studio', currency: 'USD', timezone: 'America/New_York', invoicePrefix: 'DEMO-', invoiceSeq: 0, defaultTaxRateBps: 0, paymentTermsDays: 30, openingBalanceCents: 8426000, openingBalanceDate: openingDate, financialSetupComplete: true, onboardingStep: 4, isDemo: true, monthlyBudgetCents: 6000000, minimumCashCents: 1500000, cashAccounts: [{ _id: new ObjectId(), name: 'Operating account · simulated', type: 'checking', currency: 'USD', balanceCents: 8426000, balanceDate: openingDate, notes: 'Simulated demo data' }], ownerId: id, createdAt: now };
    await C('businesses').insertOne(businessDoc); await C('users').insertOne(user);
    const sample = [
      [addDays(openingDate, -32),'Retainer · Acme Studio',1250000],[addDays(openingDate, -28),'Payroll · Monthly',-2480000],[addDays(openingDate, -23),'Cloud software',-18400],[addDays(openingDate, -18),'Project milestone · Pine & Co',850000],[addDays(openingDate, -12),'Office and production',-324000],[addDays(openingDate, -6),'Retainer · Northstar Media',1620000],
    ];
    await C('transactions').insertMany(sample.map(([dateValue, description, amountCents]) => ({ _id: new ObjectId(), businessId, date: dateValue, description, vendor: '', category: amountCents > 0 ? 'Client income' : 'Operating expenses', financialClass: amountCents > 0 ? 'income' : 'expense', amountCents, currency: 'USD', source: 'demo-simulated', simulated: true, createdAt: now })));
    await C('planningItems').insertMany([{ businessId, name: 'Monthly payroll', type: 'expense', category: 'Payroll', amountCents: 2480000, cadence: 'monthly', nextDate: addDays(openingDate, 7), endDate: null, confidence: 'estimated', notes: 'Simulated demo assumption', currency: 'USD', simulated: true, createdAt: now }, { businessId, name: 'Client retainer', type: 'income', category: 'Client income', amountCents: 1250000, cadence: 'monthly', nextDate: addDays(openingDate, 14), endDate: null, confidence: 'contracted', notes: 'Simulated demo assumption', currency: 'USD', simulated: true, createdAt: now }]);
    const demoCustomerId = new ObjectId(), invoiceId = new ObjectId(), billId = new ObjectId(), demoAccountId = new ObjectId();
    await C('customers').insertOne({ _id: demoCustomerId, businessId, name: 'Acme Studio · Sample Client', email: 'finance@example.invalid', address: 'Sample record', simulated: true, createdAt: now });
    await C('invoices').insertOne({ _id: invoiceId, businessId, customerId: demoCustomerId, customer: { name: 'Acme Studio · Sample Client', email: 'finance@example.invalid', address: 'Sample record' }, number: 'DEMO-0001', issueDate: addDays(openingDate, -14), dueDate: addDays(openingDate, 7), items: [{ description: 'Monthly creative services · simulated', quantity: 1, unitCents: 1250000 }], taxRateBps: 0, discountCents: 0, notes: 'Simulated demonstration record.', status: 'sent', payments: [], sentAt: now, sentVia: 'demo-simulated', createdAt: now, updatedAt: now, simulated: true });
    await C('bills').insertOne({ _id: billId, businessId, vendor: 'Cloudline Systems · Sample Vendor', description: 'Production software · simulated', category: 'Software', amountCents: 68400, issueDate: addDays(openingDate, -3), dueDate: addDays(openingDate, 3), status: 'unpaid', payments: [], notes: 'Simulated demonstration record.', simulated: true, createdAt: now, updatedAt: now });
    await C('bankAccounts').insertOne({ _id: demoAccountId, businessId, institution: 'Simulated account', name: 'Operating account · sample', type: 'checking', currency: 'USD', accountNumber: '', openingBalanceCents: 8426000, openingBalanceDate: openingDate, status: 'active', simulated: true, createdAt: now, updatedAt: now });
    setCookie(res, await createSession(db, user, req));
    res.status(201).json({ user: publicUser(user), business: publicBusiness(businessDoc) });
  }));

  r.post('/auth/verify-email', rateLimit({ key: 'verify-email', limit: 10, windowMs: 3600e3 }), wrap(async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const entry = token && await C('verificationTokens').findOneAndDelete({ _id: hashToken(token), expiresAt: { $gt: new Date() } });
    if (!entry) throw new HttpError(400, 'This verification link is invalid or has expired. Request a new one.');
    const user = await C('users').findOne({ _id: entry.userId });
    if (!user) throw new HttpError(400, 'This verification link is invalid or has expired. Request a new one.');
    if (user.emailVerified) throw new HttpError(409, 'This email address is already verified.');
    await C('users').updateOne({ _id: user._id, emailVerified: false }, { $set: { emailVerified: true, emailVerifiedAt: new Date() } });
    const welcome = await notifyAccount(user, 'Welcome to Morgan', `Hi ${user.name},\n\nYour email is verified and your Morgan workspace is ready. Sign in to finish setting up your financial profile.\n\n${appOrigin()}/login`, 'welcome');
    res.json({ ok: true, welcomeEmail: welcome });
  }));

  r.post('/auth/resend-verification', rateLimit({ key: 'resend-verification', limit: 3, windowMs: 3600e3, byEmail: true }), wrap(async (req, res) => {
    const mail = email(req.body?.email);
    const user = await C('users').findOne({ email: mail, emailVerified: { $ne: true } });
    const result = user ? await sendVerification(user) : null;
    res.json({ ok: true, emailStatus: result?.status || 'unknown', ...(result?.testRecipient && { developmentCopy: true, emailMessage: 'Resend accepted a development test copy. Check the configured test inbox and the local admin email preview; inbox delivery is not confirmed.' }), ...(result && result.status !== 'accepted' ? { emailMessage: result.message, category: result.code, providerStatus: result.providerStatus, retryable: result.retryable } : {}) });
  }));

  r.post('/auth/login', rateLimit({ key: 'login-ip', limit: 30, windowMs: 15 * 60e3, failuresOnly: true }), rateLimit({ key: 'login', limit: 8, windowMs: 15 * 60e3, byEmail: true, failuresOnly: true }), wrap(async (req, res) => {
    const mail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' && req.body.password.length <= 200 ? req.body.password : '';
    const user = mail ? await C('users').findOne({ email: mail }) : null;
    const ok = await verifyPassword(password, user?.passwordHash || DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, 'Email or password is incorrect');
    if (user.disabledAt || user.status === 'disabled') throw new HttpError(403, 'This account is disabled. Contact the workspace administrator.');
    // Allow accounts created before confirmation was paused to sign in as well.
    if (user.emailVerified !== true) await C('users').updateOne({ _id: user._id }, { $set: { emailVerified: true, emailVerificationDisabled: true } });
    const sessionUser = user.emailVerified === true ? user : { ...user, emailVerified: true, emailVerificationDisabled: true };
    setCookie(res, await createSession(db, sessionUser, req));
    res.json({ user: publicUser(sessionUser), business: publicBusiness(await business({ businessId: user.businessId })) });
  }));

  r.post('/auth/logout', wrap(async (req, res) => {
    if (req.sessionId) await C('sessions').deleteOne({ _id: req.sessionId });
    res.setHeader('Set-Cookie', sessionCookie('', { secure: secureCookies, maxAgeMs: 0 }));
    res.json({ ok: true });
  }));

  r.get('/auth/me', wrap(async (req, res) => {
    if (!req.user) return res.json({ user: null, passwordResetAvailable: resetAvailable() });
    res.json({ user: publicUser(req.user), business: publicBusiness(await business(req)), mailConfigured: mailConfigured(), passwordResetAvailable: resetAvailable() });
  }));

  // Password reset: links are built only from the configured APP_URL (never the Host header) to prevent reset-link poisoning.
  const resetAvailable = () => (mailConfigured() || localEmailPreviewEnabled()) && Boolean(process.env.APP_URL);
  r.post('/auth/forgot', rateLimit({ key: 'forgot', limit: 5, windowMs: 3600e3 }), wrap(async (req, res) => {
    if (!resetAvailable()) throw new HttpError(503, 'Password reset by email is not available on this server.');
    const mail = email(req.body?.email);
    const user = await C('users').findOne({ email: mail });
    if (user) {
      const token = randomBytes(32).toString('base64url');
      await C('resetTokens').deleteMany({ userId: user._id });
      await C('resetTokens').insertOne({ _id: hashToken(token), userId: user._id, expiresAt: new Date(Date.now() + 30 * 60e3) });
      const link = `${process.env.APP_URL.replace(/\/$/, '')}/reset-password?token=${token}`;
      try {
        await sendMail({ db, kind: 'password_reset', to: user.email, subject: 'Reset your Morgan password', text: `Someone asked to reset the password for this Morgan account.\n\nReset it here (valid for 30 minutes, single use):\n${link}\n\nIf this wasn't you, ignore this email — your password stays the same.` });
      } catch {
        // Preserve account enumeration protection; the outcome is kept in emailEvents.
      }
    }
    // Same response whether or not the account exists.
    res.json({ ok: true });
  }));
  r.post('/auth/reset', rateLimit({ key: 'reset', limit: 10, windowMs: 3600e3, failuresOnly: true }), wrap(async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const pw = validatePassword(req.body?.password);
    const t = token && await C('resetTokens').findOneAndDelete({ _id: hashToken(token), expiresAt: { $gt: new Date() } });
    if (!t) throw new HttpError(400, 'This reset link is invalid or has expired. Request a new one.');
    await C('users').updateOne({ _id: t.userId }, { $set: { passwordHash: await hashPassword(pw) } });
    await C('sessions').deleteMany({ userId: t.userId });
    const user = await C('users').findOne({ _id: t.userId });
    const emailNotification = user ? await notifyAccount(user, 'Your Morgan password was changed', `The password for your Morgan account was changed at ${new Date().toISOString()}. All active sessions were signed out. If you did not make this change, reset your password immediately: ${appOrigin()}/forgot-password`) : { status: 'unknown', code: 'ACCOUNT_NOT_FOUND' };
    res.json({ ok: true, emailNotification });
  }));

  // Everything below requires a session. "Today" is the business's local date, not the server's.
  r.use(requireAuth);
  r.use(wrap(async (req, _res, next) => {
    const b = await business(req);
    if (!b) throw new HttpError(403, 'This account has no active business workspace.');
    if (b.isDemo !== true && b.financialSetupComplete !== true && req.path !== '/financial-setup' && req.path !== '/planning-items' && !req.path.startsWith('/planning-items/')) throw new HttpError(403, 'Complete the required financial onboarding before opening this workspace.');
    next();
  }));

  r.get('/plans', (_req, res) => res.json({ plans, paidCheckoutAvailable: false, trialsAvailable: false }));
  r.get('/usage', wrap(async (req, res) => res.json(await usageSummary(db, req.businessId, planFor(req)))));
  r.use(wrap(async (req, _res, next) => {
    const b = await C('businesses').findOne({ _id: req.businessId }, { projection: { timezone: 1 } });
    req.today = todayIn(b?.timezone);
    next();
  }));

  r.get('/admin/email-previews', requireAdmin, wrap(async (_req, res) => {
    if (!localEmailPreviewEnabled()) return res.json({ enabled: false, items: [] });
    res.json({ enabled: true, items: listLocalEmailPreviews() });
  }));

  r.get('/admin/overview', requireAdmin, wrap(async (_req, res) => {
    const [users, businesses, transactions, invoices, bills, statementImports] = await Promise.all([
      C('users').countDocuments({}), C('businesses').countDocuments({}), C('transactions').countDocuments({}),
      C('invoices').countDocuments({}), C('bills').countDocuments({}), C('statementImports').countDocuments({}),
    ]);
    res.json({ users, businesses, transactions, invoices, bills, statementImports });
  }));

  /* ---------------- Account & business ---------------- */
  r.patch('/account', wrap(async (req, res) => {
    const b = req.body || {};
    const set = { name: str(b.name, 'Name', { required: true, max: 100 }) };
    const newEmail = email(b.email);
    if (newEmail !== req.user.email) {
      if (!(await verifyPassword(String(b.currentPassword || ''), req.user.passwordHash))) throw new HttpError(401, 'Current password is incorrect');
      if (await C('users').findOne({ email: newEmail })) throw new HttpError(409, 'That email is already in use');
      set.email = newEmail;
    }
    await C('users').updateOne({ _id: req.user._id }, { $set: set });
    if (set.email) await notifyAccount({ ...req.user, email: req.user.email }, 'Your Morgan account email was changed', `The sign-in email for your Morgan account was changed to ${set.email} at ${new Date().toISOString()}. If you did not make this change, contact Morgan support.`);
    res.json({ user: publicUser({ ...req.user, ...set }) });
  }));

  r.post('/account/password', rateLimit({ key: 'password', limit: 10, windowMs: 3600e3 }), wrap(async (req, res) => {
    if (!(await verifyPassword(String(req.body?.currentPassword || ''), req.user.passwordHash))) throw new HttpError(401, 'Current password is incorrect');
    const pw = validatePassword(req.body?.newPassword);
    await C('users').updateOne({ _id: req.user._id }, { $set: { passwordHash: await hashPassword(pw) } });
    // Invalidate every other session after a password change.
    const { deletedCount } = await C('sessions').deleteMany({ userId: req.user._id, _id: { $ne: req.sessionId } });
    const emailNotification = await notifyAccount(req.user, 'Morgan security update: password changed', `Your Morgan password was changed at ${new Date().toISOString()}. ${deletedCount} other session(s) were signed out. If you did not make this change, reset your password immediately: ${appOrigin()}/forgot-password`);
    res.json({ ok: true, signedOut: deletedCount, emailNotification });
  }));

  r.get('/account/sessions', wrap(async (req, res) => {
    const list = await C('sessions').find({ userId: req.user._id, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).toArray();
    res.json(list.map((s) => ({ current: s._id === req.sessionId, createdAt: s.createdAt, userAgent: s.userAgent })));
  }));

  r.post('/account/sessions/revoke-others', wrap(async (req, res) => {
    const { deletedCount } = await C('sessions').deleteMany({ userId: req.user._id, _id: { $ne: req.sessionId } });
    const emailNotification = await notifyAccount(req.user, 'Morgan security update: sessions signed out', `${deletedCount} other session(s) on your Morgan account were signed out at ${new Date().toISOString()}. If you did not request this, change your password: ${appOrigin()}/forgot-password`);
    res.json({ ok: true, signedOut: deletedCount, emailNotification });
  }));

  r.delete('/account', rateLimit({ key: 'delete-account', limit: 5, windowMs: 3600e3, failuresOnly: true }), wrap(async (req, res) => {
    if (!(await verifyPassword(String(req.body?.password || ''), req.user.passwordHash))) throw new HttpError(401, 'Password is incorrect');
    const q = { businessId: req.businessId };
    await Promise.all(['transactions', 'invoices', 'customers', 'bills', 'planningItems', 'bankAccounts', 'statementImports', 'financialAudit', 'horizonScenarios', 'geminiThreads', 'usagePeriods', 'usageEvents', 'intelligenceRequests'].map((c) => C(c).deleteMany(q)));
    await C('sessions').deleteMany({ userId: req.user._id });
    await C('businesses').deleteOne({ _id: req.businessId });
    await C('users').deleteOne({ _id: req.user._id });
    res.setHeader('Set-Cookie', sessionCookie('', { secure: secureCookies, maxAgeMs: 0 }));
    res.json({ ok: true });
  }));

  r.patch('/business', wrap(async (req, res) => {
    const b = req.body || {};
    const set = {
      name: str(b.name, 'Business name', { required: true, max: 120 }),
      currency: oneOf(b.currency, 'Currency', CURRENCIES),
      address: str(b.address, 'Address', { max: 400 }),
      email: email(b.email, 'Business email', false),
      invoicePrefix: str(b.invoicePrefix, 'Invoice prefix', { required: true, max: 12 }),
      defaultTaxRateBps: int(b.defaultTaxRateBps ?? 0, 'Default tax rate', { min: 0, max: 10000 }),
      paymentTermsDays: int(b.paymentTermsDays ?? 14, 'Payment terms', { min: 0, max: 365 }),
      timezone: validTz(b.timezone) ? b.timezone : 'UTC',
      openingBalanceCents: cents(b.openingBalanceCents ?? 0, 'Opening balance'),
      openingBalanceDate: date(b.openingBalanceDate, 'Opening balance date', false),
    };
    if (!/^[A-Za-z0-9-_/]+$/.test(set.invoicePrefix)) throw bad('Invoice prefix may only contain letters, numbers, - _ /');
    const current = await business(req);
    if (set.openingBalanceCents !== current.openingBalanceCents || set.openingBalanceDate !== current.openingBalanceDate) {
      set.cashAccounts = set.openingBalanceDate ? [{ _id: new ObjectId(), name: 'Business cash balance', type: 'other', currency: set.currency, balanceCents: set.openingBalanceCents, balanceDate: set.openingBalanceDate, notes: 'Updated in business settings' }] : [];
    } else if (set.currency !== current.currency && current.cashAccounts?.length) {
      // Settings explicitly say changing currency relabels amounts without conversion.
      set.cashAccounts = current.cashAccounts.map((a) => ({ ...a, currency: set.currency }));
    }
    await C('businesses').updateOne({ _id: req.businessId }, { $set: set });
    res.json({ business: publicBusiness(await business(req)) });
  }));

  /* ---------------- Financial setup and planned cash movements ---------------- */
  const planningFields = (b) => ({
    name: str(b.name, 'Name', { required: true, max: 120 }),
    type: oneOf(b.type, 'Type', ['income', 'expense']),
    category: str(b.category || 'Other', 'Category', { required: true, max: 60 }),
    amountCents: cents(b.amountCents, 'Amount', { min: 1, max: 1e11 }),
    cadence: oneOf(b.cadence, 'Frequency', ['once', 'weekly', 'monthly', 'quarterly', 'annually']),
    nextDate: date(b.nextDate, 'Next date'),
    endDate: date(b.endDate, 'End date', false),
    confidence: oneOf(b.confidence || 'planned', 'Confidence', ['contracted', 'invoiced', 'estimated', 'planned']),
    notes: str(b.notes, 'Notes', { max: 500 }),
  });
  r.get('/financial-setup', wrap(async (req, res) => {
    const biz = await business(req);
    const items = await C('planningItems').find(scoped(req)).sort({ nextDate: 1 }).toArray();
    res.json({ business: publicBusiness(biz), items: items.map((i) => pub(i)), today: req.today });
  }));
  r.patch('/financial-setup', wrap(async (req, res) => {
    const b = req.body || {};
    const before = await business(req);
    const set = {};
    if (b.industry !== undefined) set.industry = str(b.industry, 'Industry', { max: 80 });
    if (b.openingBalanceCents !== undefined) set.openingBalanceCents = cents(b.openingBalanceCents, 'Available cash');
    if (b.openingBalanceDate !== undefined) set.openingBalanceDate = date(b.openingBalanceDate, 'Balance date', false);
    if (b.monthlyBudgetCents !== undefined) set.monthlyBudgetCents = b.monthlyBudgetCents === null ? null : cents(b.monthlyBudgetCents, 'Monthly budget', { min: 0, max: 1e12 });
    if (b.minimumCashCents !== undefined) set.minimumCashCents = b.minimumCashCents === null ? null : cents(b.minimumCashCents, 'Minimum cash reserve', { min: 0, max: 1e12 });
    if (b.financialYearStartMonth !== undefined) set.financialYearStartMonth = int(b.financialYearStartMonth, 'Financial year start month', { min: 1, max: 12 });
    if (b.cashAccounts !== undefined) {
      if (!Array.isArray(b.cashAccounts) || b.cashAccounts.length > 10) throw bad('Add at most 10 cash accounts');
      const biz = await business(req);
      const accounts = b.cashAccounts.map((a, index) => ({
        _id: new ObjectId(), name: str(a.name, `Account ${index + 1} name`, { required: true, max: 100 }),
        type: oneOf(a.type, 'Account type', ['checking', 'savings', 'cash', 'other']),
        currency: oneOf(a.currency || biz.currency, 'Account currency', CURRENCIES),
        balanceCents: cents(a.balanceCents, `Account ${index + 1} balance`, { min: -1e11, max: 1e11 }),
        balanceDate: date(a.balanceDate, `Account ${index + 1} balance date`), notes: str(a.notes, 'Account notes', { max: 200 }),
      }));
      if (accounts.some((a) => a.currency !== biz.currency)) throw bad(`Cash accounts must use the business currency (${biz.currency}). Morgan does not convert balances.`);
      if (new Set(accounts.map((a) => a.balanceDate)).size > 1) throw bad('Use the same balance date for each account so the combined cash figure is comparable.');
      if (accounts.some((a) => a.balanceDate > req.today)) throw bad('Cash account balance dates cannot be in the future.');
      const total = accounts.reduce((s, a) => s + a.balanceCents, 0);
      if (!Number.isSafeInteger(total)) throw bad('Combined account balance is out of range');
      set.cashAccounts = accounts;
      set.openingBalanceCents = total;
      set.openingBalanceDate = accounts[0]?.balanceDate || null;
    }
    if (before?.isDemo !== true && before?.financialSetupComplete !== true) {
      if (b.onboardingStep !== undefined) {
        const step = int(b.onboardingStep, 'Onboarding step', { min: 0, max: 4 });
        const currentStep = before.onboardingStep || 0;
        if (step < currentStep || step > currentStep + 1) throw bad('Complete each onboarding step in order.');
        if (step > currentStep && currentStep === 0 && await C('statementImports').countDocuments(scoped(req)) < 1) throw bad('A reviewed statement is required before onboarding can continue.');
        if (step > currentStep && currentStep === 1 && b.expectedActivityReviewed !== true) throw bad('Confirm that you reviewed expected income and recurring expenses, including if you have none to add.');
        if (step > currentStep && currentStep === 2) {
          const budgetCents = b.monthlyBudgetCents === undefined ? before.monthlyBudgetCents : set.monthlyBudgetCents;
          const reserveCents = b.minimumCashCents === undefined ? before.minimumCashCents : set.minimumCashCents;
          if (budgetCents === null || budgetCents === undefined || reserveCents === null || reserveCents === undefined) throw bad('Enter a monthly budget and a minimum cash reserve. Use zero if you do not set a limit.');
        }
        set.onboardingStep = step;
      }
      if (b.complete === true) {
        if ((before.onboardingStep || 0) !== 3) throw bad('Complete the required onboarding steps before opening Morgan.');
        if (before.monthlyBudgetCents === null || before.minimumCashCents === null) throw bad('A monthly budget and minimum cash reserve are required.');
        set.financialSetupComplete = true; set.onboardingStep = 4;
      }
    } else if (b.complete === true) { set.financialSetupComplete = true; }
    await C('businesses').updateOne({ _id: req.businessId }, { $set: set });
    const updated = await business(req);
    const emailNotification = b.complete === true && before?.financialSetupComplete !== true
      ? await notifyAccount(req.user, 'Your Morgan workspace is ready', `Hi ${req.user.name},\n\nYour initial Morgan financial setup is complete for ${updated.name}. You can return to review cash, invoices, bills, and your saved planning assumptions at any time.\n\n${appOrigin()}/app` , 'onboarding_complete')
      : undefined;
    res.json({ business: publicBusiness(updated), ...(emailNotification && { emailNotification }) });
  }));
  r.get('/planning-items', wrap(async (req, res) => {
    const items = await C('planningItems').find(scoped(req)).sort({ nextDate: 1, createdAt: -1 }).toArray();
    res.json(items.map((i) => pub(i)));
  }));
  r.post('/planning-items', wrap(async (req, res) => {
    const fields = planningFields(req.body || {});
    if (fields.nextDate < req.today) throw bad('Next expected date must be today or later');
    if (fields.endDate && fields.endDate < fields.nextDate) throw bad('End date cannot be before the next expected date');
    const doc = { ...fields, businessId: req.businessId, currency: (await business(req)).currency, createdAt: new Date(), updatedAt: new Date() };
    const { insertedId } = await createWithUsage(req, 'financialRecords', 1, (token) => C('planningItems').insertOne({ ...doc, quotaReservationId: token }), { entity: 'planning-item' });
    res.status(201).json(pub({ _id: insertedId, ...doc }));
  }));
  r.patch('/planning-items/:id', wrap(async (req, res) => {
    const _id = oid(req.params.id), fields = planningFields(req.body || {});
    if (fields.nextDate < req.today) throw bad('Next expected date must be today or later');
    if (fields.endDate && fields.endDate < fields.nextDate) throw bad('End date cannot be before the next expected date');
    const result = await C('planningItems').findOneAndUpdate(scoped(req, { _id }), { $set: { ...fields, updatedAt: new Date() } }, { returnDocument: 'after' });
    if (!result) throw new HttpError(404, 'Financial item not found');
    res.json(pub(result));
  }));
  r.delete('/planning-items/:id', wrap(async (req, res) => {
    const { deletedCount } = await C('planningItems').deleteOne(scoped(req, { _id: oid(req.params.id) }));
    if (!deletedCount) throw new HttpError(404, 'Financial item not found');
    res.json({ ok: true });
  }));

  /* ---------------- Transactions ---------------- */
  const validateClassDirection = (financialClass, amountCents) => {
    const positive = ['income', 'owner-contribution', 'refund'].includes(financialClass);
    const negative = ['expense', 'owner-withdrawal', 'card-payment'].includes(financialClass);
    if (positive && amountCents <= 0) throw bad(`${financialClass.replaceAll('-', ' ')} must be an incoming cash movement`);
    if (negative && amountCents >= 0) throw bad(`${financialClass.replaceAll('-', ' ')} must be an outgoing cash movement`);
  };
  const txnFields = (b) => {
    const amount = cents(b.amountCents ?? b.amount, 'Amount');
    if (amount === 0) throw bad('Amount cannot be zero');
    const type = oneOf(b.type || (amount >= 0 ? 'income' : 'expense'), 'Type', ['income', 'expense']);
    const financialClass = oneOf(b.financialClass || type, 'Financial treatment', ['income', 'expense', 'transfer', 'financing', 'owner-contribution', 'owner-withdrawal', 'refund', 'reversal', 'card-payment', 'unclassified']);
    const signedAmount = type === 'expense' ? -Math.abs(amount) : Math.abs(amount);
    validateClassDirection(financialClass, signedAmount);
    return {
      date: date(b.date, 'Date'),
      description: str(b.description, 'Description', { required: true, max: 200 }),
      vendor: str(b.vendor, 'Vendor / payer', { max: 120 }),
      category: str(b.category, 'Category', { max: 60 }) || 'Uncategorized',
      amountCents: signedAmount,
      financialClass,
      notes: str(b.notes, 'Notes', { max: 1000 }),
    };
  };

  r.get('/transactions', wrap(async (req, res) => {
    const q = scoped(req);
    const biz = await business(req);
    const { search, from, to, type, category, vendor } = req.query;
    if (from || to) q.date = { ...(from && { $gte: date(from, 'From') }), ...(to && { $lte: date(to, 'To') }) };
    if (type === 'income' || type === 'expense') {
      const sign = type === 'income' ? { $gt: 0 } : { $lt: 0 };
      const classes = [{ financialClass: type, amountCents: sign }];
      if (type === 'expense') classes.push({ financialClass: 'refund', amountCents: { $gt: 0 } });
      classes.push({ financialClass: { $exists: false }, source: { $ne: 'bank-statement' }, amountCents: sign });
      if (type === 'income') classes.push({ financialClass: { $exists: false }, invoiceId: { $exists: true }, amountCents: sign });
      if (type === 'expense') classes.push({ financialClass: { $exists: false }, billId: { $exists: true }, amountCents: sign });
      q.$and = [...(q.$and || []), { $or: classes }];
    }
    if (typeof category === 'string' && category) q.category = category;
    if (typeof vendor === 'string' && vendor) q.vendor = vendor;
    if (typeof req.query.currency === 'string' && CURRENCIES.includes(req.query.currency)) q.currency = req.query.currency;
    if (typeof search === 'string' && search.trim()) {
      const rx = new RegExp(escapeRegex(search.trim().slice(0, 100)), 'i');
      q.$or = [{ description: rx }, { vendor: rx }, { category: rx }, { notes: rx }];
    }
    const sortKey = { date: 'date', amount: 'amountCents' }[req.query.sort] || 'date';
    const dir = req.query.dir === 'asc' ? 1 : -1;
    const limit = Math.min(int(req.query.limit ?? 50, 'Limit', { min: 1, max: 500 }), 500);
    const page = int(req.query.page ?? 0, 'Page', { min: 0, max: 100000 });
    const totalsQuery = { ...q, currency: q.currency ? q.currency : { $in: [biz.currency, null] }, excludedFromTotals: { $ne: true } };
    const [items, agg, totalCount] = await Promise.all([
      C('transactions').find(q).sort({ [sortKey]: dir, _id: dir }).skip(page * limit).limit(limit).toArray(),
      C('transactions').aggregate([{ $match: totalsQuery }, { $group: {
        _id: null, count: { $sum: 1 },
        income: { $sum: { $cond: [{ $and: [{ $gt: ['$amountCents', 0] }, { $or: [{ $eq: ['$financialClass', 'income'] }, { $and: [{ $eq: [{ $type: '$financialClass' }, 'missing'] }, { $or: [{ $ne: ['$source', 'bank-statement'] }, { $ne: [{ $type: '$invoiceId' }, 'missing'] }] }] }] }] }, '$amountCents', 0] } },
        expenses: { $sum: { $cond: [{ $and: [{ $lt: ['$amountCents', 0] }, { $or: [{ $eq: ['$financialClass', 'expense'] }, { $and: [{ $eq: [{ $type: '$financialClass' }, 'missing'] }, { $or: [{ $ne: ['$source', 'bank-statement'] }, { $ne: [{ $type: '$billId' }, 'missing'] }] }] }] }] }, '$amountCents', 0] } },
        refunds: { $sum: { $cond: [{ $and: [{ $eq: ['$financialClass', 'refund'] }, { $gt: ['$amountCents', 0] }] }, '$amountCents', 0] } },
        unclassified: { $sum: { $cond: [{ $and: [{ $ne: ['$excludedFromTotals', true] }, { $or: [{ $eq: ['$financialClass', 'unclassified'] }, { $and: [{ $eq: [{ $type: '$financialClass' }, 'missing'] }, { $eq: ['$source', 'bank-statement'] }, { $eq: [{ $type: '$invoiceId' }, 'missing'] }, { $eq: [{ $type: '$billId' }, 'missing'] }, { $ne: ['$matchedRecordType', 'transfer'] }] }] }] }, 1, 0] } },
      } }]).toArray(),
      C('transactions').countDocuments(q),
    ]);
    const s = agg[0] || { count: 0, income: 0, expenses: 0 };
    res.json({ items: items.map(pub), total: totalCount, income: s.income, expenses: -s.expenses - (s.refunds || 0), unclassified: s.unclassified || 0, page, limit });
  }));

  r.get('/transactions/facets', wrap(async (req, res) => {
    const [categories, vendors, currencies] = await Promise.all([
      C('transactions').distinct('category', scoped(req)),
      C('transactions').distinct('vendor', scoped(req)),
      C('transactions').distinct('currency', scoped(req)),
    ]);
    res.json({ categories: categories.filter(Boolean).sort(), vendors: vendors.filter(Boolean).sort(), currencies: currencies.filter(Boolean).sort() });
  }));

  r.post('/transactions', wrap(async (req, res) => {
    const doc = { ...txnFields(req.body || {}), businessId: req.businessId, source: 'manual', createdAt: new Date() };
    const { insertedId } = await createWithUsage(req, 'financialRecords', 1, (token) => C('transactions').insertOne({ ...doc, quotaReservationId: token }), { entity: 'transaction' });
    res.status(201).json(pub({ _id: insertedId, ...doc }));
  }));

  r.post('/transactions/import', wrap(async (req, res) => {
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || !rows.length) throw bad('No rows to import');
    if (rows.length > 5000) throw bad('Import at most 5,000 rows at a time');
    const docs = [], errors = [];
    rows.forEach((row, i) => {
      try { docs.push({ ...txnFields(row), businessId: req.businessId, source: 'import', createdAt: new Date() }); }
      catch (e) { errors.push({ row: i + 1, message: e.message }); }
    });
    if (errors.length) return res.status(400).json({ error: `${errors.length} row(s) are invalid. Nothing was imported.`, errors: errors.slice(0, 50) });
    const importId = new ObjectId(); docs.forEach((doc) => { doc.importId = importId; });
    await createWithUsage(req, 'financialRecords', docs.length, async (token) => {
      docs.forEach((doc) => { doc.quotaReservationId = token; });
      try { return await C('transactions').insertMany(docs); }
      catch (error) { await C('transactions').deleteMany(scoped(req, { importId })); throw error; }
    }, { entity: 'transaction-import' });
    res.status(201).json({ imported: docs.length });
  }));

  /* ---------------- Bank accounts and statement imports ---------------- */
  const publicBankAccount = (a) => {
    const { _id, businessId, accountNumber, ...rest } = a;
    return { id: String(_id), ...rest, maskedIdentifier: accountNumber ? `•••• ${accountNumber.slice(-4)}` : '' };
  };
  const dateWithin = (a, b, days) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000) <= days;
  const sameParty = (a, b) => !a || !b || a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());
  const calculateAccountBalance = (account, records, statements, asOf) => {
    const statement = statements.find((item) => item.closingBalanceCents !== null && item.periodEnd <= asOf);
    const openingIsCurrent = account.openingBalanceCents !== null && account.openingBalanceCents !== undefined && account.openingBalanceDate && account.openingBalanceDate <= asOf;
    const statementIsCurrent = statement && (!openingIsCurrent || statement.periodEnd >= account.openingBalanceDate);
    const baseCents = statementIsCurrent ? statement.closingBalanceCents : openingIsCurrent ? account.openingBalanceCents : null;
    const baseDate = statementIsCurrent ? statement.periodEnd : openingIsCurrent ? account.openingBalanceDate : null;
    const latestDate = records.filter((item) => item.date <= asOf).reduce((latest, item) => item.date > latest ? item.date : latest, '');
    if (baseCents === null || !baseDate) return { balance: null, latestDate: latestDate || null, balanceSource: null, balanceAsOf: null };
    const later = records.filter((item) => item.date > baseDate && item.date <= asOf);
    const balance = later.reduce((sum, item) => sum + item.amountCents, baseCents);
    const balanceAsOf = later.reduce((latest, item) => item.date > latest ? item.date : latest, baseDate);
    return { balance, latestDate: latestDate || baseDate, balanceSource: statementIsCurrent ? 'statement' : 'opening-balance', balanceAsOf };
  };
  r.get('/bank-accounts', wrap(async (req, res) => {
    const accounts = await C('bankAccounts').find(scoped(req)).sort({ status: 1, name: 1 }).toArray();
    const ids = accounts.map((a) => a._id);
    const [imports, balances] = await Promise.all([
      C('statementImports').find(scoped(req, { accountId: { $in: ids } }), { projection: { sourceFile: 0 } }).sort({ importedAt: -1 }).toArray(),
      Promise.all(accounts.map(async (a) => {
        const [records, accountImports] = await Promise.all([
          C('transactions').find(scoped(req, { accountId: a._id })).toArray(),
          C('statementImports').find(scoped(req, { accountId: a._id, closingBalanceCents: { $ne: null } }), { projection: { sourceFile: 0 } }).sort({ periodEnd: -1, importedAt: -1 }).toArray(),
        ]);
        return { _id: a._id, ...calculateAccountBalance(a, records, accountImports, req.today) };
      })),
    ]);
    const importByAccount = new Map();
    for (const item of imports) if (!importByAccount.has(String(item.accountId))) importByAccount.set(String(item.accountId), item);
    const balanceByAccount = new Map(balances.map((b) => [String(b._id), b]));
    res.json(accounts.map((a) => {
      const latest = importByAccount.get(String(a._id)), calc = balanceByAccount.get(String(a._id));
      return { ...publicBankAccount(a), latestImport: latest ? { id: String(latest._id), filename: latest.filename, fileType: latest.fileType || 'csv', importedAt: latest.importedAt, periodStart: latest.periodStart, periodEnd: latest.periodEnd, closingBalanceCents: latest.closingBalanceCents, importedCount: latest.importedCount, duplicateCount: latest.duplicateCount, discrepancyCents: latest.discrepancyCents } : null, calculatedBalanceCents: calc?.balance ?? null, balanceSource: calc?.balanceSource ?? null, balanceAsOf: calc?.balanceAsOf ?? null, latestTransactionDate: calc?.latestDate ?? null };
    }));
  }));
  r.post('/bank-accounts', wrap(async (req, res) => {
    const b = req.body || {};
    const doc = {
      businessId: req.businessId,
      institution: str(b.institution, 'Bank name', { required: true, max: 120 }),
      name: str(b.name, 'Account name', { required: true, max: 100 }),
      type: oneOf(b.type, 'Account type', ['checking', 'savings', 'credit-card', 'other']),
      currency: oneOf(b.currency, 'Currency', CURRENCIES),
      accountNumber: str(b.accountNumber, 'Account identifier', { max: 80 }).replace(/\s/g, ''),
      openingBalanceCents: b.openingBalanceCents === '' || b.openingBalanceCents === undefined || b.openingBalanceCents === null ? null : cents(b.openingBalanceCents, 'Opening balance'),
      openingBalanceDate: date(b.openingBalanceDate, 'Opening balance date', false),
      status: 'active', createdAt: new Date(), updatedAt: new Date(),
    };
    if (doc.openingBalanceCents !== null && !doc.openingBalanceDate) throw bad('Opening balance date is required when you enter an opening balance');
    if (doc.openingBalanceDate && doc.openingBalanceDate > req.today) throw bad('Opening balance date cannot be in the future');
    const { insertedId } = await C('bankAccounts').insertOne(doc);
    res.status(201).json(publicBankAccount({ _id: insertedId, ...doc }));
  }));
  r.patch('/bank-accounts/:id', wrap(async (req, res) => {
    const _id = oid(req.params.id), existing = await C('bankAccounts').findOne(scoped(req, { _id }));
    if (!existing) throw new HttpError(404, 'Bank account not found');
    const b = req.body || {}, set = { updatedAt: new Date() };
    if (b.institution !== undefined) set.institution = str(b.institution, 'Bank name', { required: true, max: 120 });
    if (b.name !== undefined) set.name = str(b.name, 'Account name', { required: true, max: 100 });
    if (b.type !== undefined) set.type = oneOf(b.type, 'Account type', ['checking', 'savings', 'credit-card', 'other']);
    if (b.currency !== undefined) {
      set.currency = oneOf(b.currency, 'Currency', CURRENCIES);
      if (set.currency !== existing.currency && await C('transactions').findOne(scoped(req, { accountId: _id }))) throw bad('Account currency cannot change after transactions have been imported. Create another account for the other currency.');
    }
    if (b.accountNumber !== undefined) set.accountNumber = str(b.accountNumber, 'Account identifier', { max: 80 }).replace(/\s/g, '');
    if (b.status !== undefined) set.status = oneOf(b.status, 'Status', ['active', 'archived']);
    if (b.openingBalanceCents !== undefined) set.openingBalanceCents = b.openingBalanceCents === null ? null : cents(b.openingBalanceCents, 'Opening balance');
    if (b.openingBalanceDate !== undefined) set.openingBalanceDate = date(b.openingBalanceDate, 'Opening balance date', false);
    if ((set.openingBalanceCents ?? existing.openingBalanceCents) !== null && !(set.openingBalanceDate ?? existing.openingBalanceDate)) throw bad('Opening balance date is required when an opening balance is set');
    if ((set.openingBalanceDate || existing.openingBalanceDate) > req.today) throw bad('Opening balance date cannot be in the future');
    await C('bankAccounts').updateOne(scoped(req, { _id }), { $set: set });
    res.json(publicBankAccount({ ...existing, ...set }));
  }));
  r.get('/bank-accounts/:id/imports', wrap(async (req, res) => {
    const accountId = oid(req.params.id);
    if (!await C('bankAccounts').findOne(scoped(req, { _id: accountId }))) throw new HttpError(404, 'Bank account not found');
    const imports = await C('statementImports').find(scoped(req, { accountId }), { projection: { sourceFile: 0 } }).sort({ importedAt: -1 }).limit(100).toArray();
    res.json(imports.map((i) => {
      const { _id, businessId, accountId: _account, sourceFile: _sourceFile, ...rest } = i;
      return { id: String(_id), ...rest, sourceFileStored: Boolean(i.sourceFileSha256) };
    }));
  }));
  r.get('/bank-accounts/:id/transactions', wrap(async (req, res) => {
    const accountId = oid(req.params.id);
    if (!await C('bankAccounts').findOne(scoped(req, { _id: accountId }))) throw new HttpError(404, 'Bank account not found');
    const biz = await business(req);
    const transactions = await C('transactions').find(scoped(req, { accountId })).sort({ date: -1 }).limit(500).toArray();
    const [bills, invoices] = await Promise.all([
      C('bills').find(scoped(req, { status: { $in: ['unpaid', 'partial'] } })).toArray(),
      C('invoices').find(scoped(req, { status: 'sent' })).toArray(),
    ]);
    const otherTransactions = await C('transactions').find(scoped(req, { source: { $ne: 'bank-statement' }, reconciliationStatus: { $ne: 'matched' } })).sort({ date: -1 }).limit(1000).toArray();
    const otherAccounts = await C('bankAccounts').find(scoped(req, { _id: { $ne: accountId }, status: 'active' })).toArray();
    const transfers = await C('transactions').find(scoped(req, { accountId: { $in: otherAccounts.map((a) => a._id) }, source: 'bank-statement', reconciliationStatus: { $ne: 'matched' } })).sort({ date: -1 }).limit(500).toArray();
    res.json(transactions.map((t) => {
      const matches = [];
      if (t.reconciliationStatus !== 'matched') {
        if (t.amountCents > 0) for (const inv of invoices) {
          const remaining = invoiceTotals(inv).total - (inv.payments || []).reduce((s, p) => s + p.amountCents, 0);
          if (t.currency === biz.currency && remaining >= t.amountCents && dateWithin(t.date, inv.dueDate, 30) && sameParty(t.vendor, inv.customer?.name)) matches.push({ kind: 'invoice', id: String(inv._id), label: `${inv.number} · ${inv.customer?.name || 'Customer'}`, amountCents: remaining });
        }
        if (t.amountCents < 0 && t.currency === biz.currency) for (const bill of bills) {
          const due = Math.max(0, bill.amountCents - (bill.payments || []).reduce((sum, p) => sum + p.amountCents, 0));
          if (due >= -t.amountCents && due > 0 && dateWithin(t.date, bill.dueDate, 30) && sameParty(t.vendor, bill.vendor)) matches.push({ kind: 'bill', id: String(bill._id), label: `${bill.vendor} · ${bill.description || 'Bill'} · ${formatMoney(due, biz.currency)} due`, amountCents: due });
        }
        for (const x of otherTransactions) if (String(x._id) !== String(t._id) && x.amountCents === t.amountCents && (x.currency || biz.currency) === t.currency && dateWithin(t.date, x.date, 7) && sameParty(t.vendor, x.vendor || x.description)) matches.push({ kind: 'existing', id: String(x._id), label: `${x.vendor || x.description} · existing transaction`, amountCents: Math.abs(x.amountCents) });
        for (const x of transfers) if (Math.abs(x.amountCents) === Math.abs(t.amountCents) && x.amountCents === -t.amountCents && x.currency === t.currency && dateWithin(t.date, x.date, 7)) matches.push({ kind: 'transfer', id: String(x._id), label: `${x.description} · other account`, amountCents: Math.abs(x.amountCents) });
      }
      return { ...pub(t), matches: matches.slice(0, 6) };
    }));
  }));
  r.post('/bank-transactions/:id/reconcile', wrap(async (req, res) => {
    const _id = oid(req.params.id), txn = await C('transactions').findOne(scoped(req, { _id, source: 'bank-statement' }));
    if (!txn) throw new HttpError(404, 'Imported bank transaction not found');
    if (txn.reconciliationStatus === 'matched') throw bad('This bank transaction is already matched');
    const kind = oneOf(req.body?.kind, 'Match type', ['invoice', 'bill', 'existing', 'transfer']);
    const targetId = oid(String(req.body?.recordId || ''));
    if (kind === 'invoice') {
      if (txn.currency !== (await business(req)).currency) throw bad('Invoice matching is available when the statement currency is the business currency.');
      if (txn.amountCents <= 0) throw bad('An outgoing transaction cannot match an invoice payment');
      const inv = await C('invoices').findOne(scoped(req, { _id: targetId, status: 'sent' }));
      if (!inv) throw new HttpError(404, 'Open invoice not found');
      const due = invoiceTotals(inv).total - (inv.payments || []).reduce((s, p) => s + p.amountCents, 0);
      if (txn.amountCents > due) throw bad('This transaction is greater than the invoice balance. Match a smaller payment or review the invoice.');
      const paymentId = new ObjectId(), payment = { id: paymentId, amountCents: txn.amountCents, date: txn.date, method: 'Imported statement', transactionId: _id };
      const fullyPaid = txn.amountCents === due;
      const { modifiedCount } = await C('invoices').updateOne({ _id: inv._id, businessId: req.businessId, status: 'sent', payments: inv.payments || [] }, { $push: { payments: payment }, $set: { ...(fullyPaid && { status: 'paid', paidAt: new Date() }) } });
      if (!modifiedCount) throw new HttpError(409, 'Invoice changed during matching. Refresh and retry.');
      await C('transactions').updateOne(scoped(req, { _id }), { $set: { invoiceId: inv._id, paymentId, category: 'Client revenue', financialClass: 'income', vendor: inv.customer?.name || txn.vendor, reconciliationStatus: 'matched', matchedRecordId: inv._id, matchedRecordType: 'invoice', paymentEvidence: 'user-supplied-statement', updatedAt: new Date() } });
    } else if (kind === 'bill') {
      if (txn.currency !== (await business(req)).currency) throw bad('Bill matching is available when the statement currency is the business currency.');
      if (txn.amountCents >= 0) throw bad('An incoming transaction cannot match a supplier bill payment');
      const bill = await C('bills').findOne(scoped(req, { _id: targetId, status: { $in: ['unpaid', 'partial'] } }));
      if (!bill) throw new HttpError(404, 'Open bill not found');
      const payments = bill.payments || [];
      const paidCents = payments.reduce((sum, p) => sum + p.amountCents, 0);
      const dueCents = bill.amountCents - paidCents;
      if (-txn.amountCents > dueCents) throw bad('This statement amount is greater than the bill balance. Match a smaller payment or review the bill.');
      const paymentId = new ObjectId();
      const nextStatus = -txn.amountCents === dueCents ? 'paid' : 'partial';
      const { modifiedCount } = await C('bills').updateOne(scoped(req, { _id: targetId, status: bill.status, payments }), { $push: { payments: { id: paymentId, amountCents: -txn.amountCents, date: txn.date, method: 'Imported statement', transactionId: _id } }, $set: { status: nextStatus, ...(nextStatus === 'paid' && { paidDate: txn.date }), transactionId: _id } });
      if (!modifiedCount) throw new HttpError(409, 'Bill changed during matching. Refresh and retry.');
      await C('transactions').updateOne(scoped(req, { _id }), { $set: { billId: targetId, category: bill.category, financialClass: 'expense', vendor: bill.vendor, reconciliationStatus: 'matched', matchedRecordId: targetId, matchedRecordType: 'bill', paymentEvidence: 'user-supplied-statement', updatedAt: new Date() } });
    } else if (kind === 'existing') {
      const existing = await C('transactions').findOne(scoped(req, { _id: targetId, source: { $ne: 'bank-statement' }, reconciliationStatus: { $ne: 'matched' } }));
      if (!existing || existing.amountCents !== txn.amountCents || (existing.currency || (await business(req)).currency) !== txn.currency || !dateWithin(existing.date, txn.date, 7)) throw bad('Choose an unlinked transaction with the same amount, currency, and a date within seven days.');
      await C('transactions').updateOne(scoped(req, { _id: targetId }), { $set: { reconciliationStatus: 'matched', bankTransactionId: _id, paymentEvidence: 'user-supplied-statement', updatedAt: new Date() } });
      await C('transactions').updateOne(scoped(req, { _id }), { $set: { reconciliationStatus: 'matched', excludedFromTotals: true, matchedRecordId: targetId, matchedRecordType: 'existing', paymentEvidence: 'user-supplied-statement', updatedAt: new Date() } });
    } else {
      const target = await C('transactions').findOne(scoped(req, { _id: targetId, accountId: { $ne: txn.accountId }, source: 'bank-statement', reconciliationStatus: { $ne: 'matched' } }));
      if (!target || target.amountCents !== -txn.amountCents || target.currency !== txn.currency || !dateWithin(target.date, txn.date, 7)) throw bad('Choose an unmatched opposite transaction in another bank account with the same currency and amount within seven days.');
      await C('transactions').updateOne(scoped(req, { _id: targetId }), { $set: { financialClass: 'transfer', reconciliationStatus: 'matched', excludedFromTotals: true, matchedRecordId: _id, matchedRecordType: 'transfer', updatedAt: new Date() } });
      await C('transactions').updateOne(scoped(req, { _id }), { $set: { financialClass: 'transfer', reconciliationStatus: 'matched', excludedFromTotals: true, matchedRecordId: targetId, matchedRecordType: 'transfer', updatedAt: new Date() } });
    }
    res.json({ ok: true, reconciliationStatus: 'matched', paymentEvidence: 'user-supplied-statement' });
  }));

  const statementRows = (req, account) => {
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || !rows.length) throw bad('No statement transactions were found');
    if (rows.length > 5000) throw bad('Statements are limited to 5,000 rows');
    return rows.map((row, i) => {
      const dateValue = date(row.date, `Row ${i + 1} date`);
      const description = str(row.description, `Row ${i + 1} description`, { required: true, max: 200 });
      const amountCents = cents(row.amountCents, `Row ${i + 1} amount`, { min: -1e13, max: 1e13 });
      if (!amountCents) throw bad(`Row ${i + 1} has a zero amount`);
      const currency = oneOf(row.currency || account.currency, `Row ${i + 1} currency`, CURRENCIES);
      if (currency !== account.currency) throw bad(`Row ${i + 1} currency (${currency}) does not match the selected account (${account.currency})`);
      const reference = str(row.reference, `Row ${i + 1} reference`, { max: 120 });
      const fingerprint = createHash('sha256').update([String(account._id), dateValue, currency, reference ? `ref:${reference.toLowerCase()}` : `${amountCents}:${description.toLowerCase().replace(/\s+/g, ' ').trim()}`].join('|')).digest('hex');
      return { date: dateValue, description, amountCents, currency, reference, runningBalanceCents: row.runningBalanceCents === null || row.runningBalanceCents === undefined || row.runningBalanceCents === '' ? null : cents(row.runningBalanceCents, `Row ${i + 1} balance`), vendor: str(row.vendor, `Row ${i + 1} vendor`, { max: 120 }), category: str(row.category, `Row ${i + 1} category`, { max: 60 }) || 'Uncategorized', sourceRowNumber: int(row.sourceRowNumber ?? i + 2, `Row ${i + 1} source row`, { min: 1, max: 5001 }), financialClass: 'unclassified', fingerprint };
    });
  };
  const findStatementAccount = async (req) => {
    const accountId = oid(String(req.body?.accountId || ''));
    const account = await C('bankAccounts').findOne(scoped(req, { _id: accountId, status: 'active' }));
    if (!account) throw new HttpError(404, 'Active bank account not found');
    return account;
  };
  const getStatementReview = async (req, account) => {
    const filename = str(req.body.filename, 'Filename', { required: true, max: 180 });
    let parsed;
    try {
      parsed = req.body.columnMap
        ? await parseMappedStatement({ filename, base64: req.body.sourceFileBase64, currency: account.currency, mapping: req.body.columnMap })
        : await parseRegistrationStatement({ filename, base64: req.body.sourceFileBase64, currency: account.currency });
    } catch (error) { throw bad(error.message || 'The statement could not be processed.'); }
    req.statementSource = parsed;
    const rows = statementRows({ ...req, body: { ...req.body, rows: parsed.rows } }, account);
    const found = await C('transactions').find(scoped(req, { accountId: account._id, fingerprint: { $in: rows.map((r) => r.fingerprint) } }), { projection: { fingerprint: 1 } }).toArray();
    const prior = new Set(found.map((t) => t.fingerprint));
    const bills = await C('bills').find(scoped(req, { status: { $in: ['unpaid', 'partial'] } })).toArray();
    const invoices = await C('invoices').find(scoped(req, { status: 'sent' })).toArray();
    const candidates = [...bills.map((b) => ({ kind: 'bill', id: String(b._id), amountCents: -Math.max(0, b.amountCents - (b.payments || []).reduce((s, p) => s + p.amountCents, 0)), date: b.dueDate, party: b.vendor })), ...invoices.map((inv) => ({ kind: 'invoice', id: String(inv._id), amountCents: invoiceTotals(inv).total - (inv.payments || []).reduce((s, p) => s + p.amountCents, 0), date: inv.dueDate, party: inv.customer?.name || '' }))];
    const review = rows.map((row) => {
      const duplicate = prior.has(row.fingerprint);
      prior.add(row.fingerprint);
      const match = candidates.find((c) => Math.sign(c.amountCents) === Math.sign(row.amountCents) && Math.abs(row.amountCents) <= Math.abs(c.amountCents) && Math.abs((Date.parse(row.date) - Date.parse(c.date)) / 86400000) <= 14 && (!row.vendor || !c.party || row.vendor.toLowerCase().includes(c.party.toLowerCase()) || c.party.toLowerCase().includes(row.vendor.toLowerCase())));
      return { ...row, duplicate, suggestedMatch: match ? { kind: match.kind, id: match.id, party: match.party } : null };
    });
    const openingBalanceCents = req.body.openingBalanceCents === '' || req.body.openingBalanceCents === undefined || req.body.openingBalanceCents === null ? null : cents(req.body.openingBalanceCents, 'Statement opening balance');
    const closingBalanceCents = req.body.closingBalanceCents === '' || req.body.closingBalanceCents === undefined || req.body.closingBalanceCents === null ? null : cents(req.body.closingBalanceCents, 'Statement closing balance');
    const sum = rows.reduce((s, row) => s + row.amountCents, 0);
    const expected = openingBalanceCents === null ? null : openingBalanceCents + sum;
    const rowStart = rows.reduce((a, r) => r.date < a ? r.date : a, rows[0].date), rowEnd = rows.reduce((a, r) => r.date > a ? r.date : a, rows[0].date);
    const periodStart = req.body.statementPeriodStart ? date(req.body.statementPeriodStart, 'Statement period start') : rowStart;
    const periodEnd = req.body.statementPeriodEnd ? date(req.body.statementPeriodEnd, 'Statement period end') : rowEnd;
    if (periodStart > rowStart || periodEnd < rowEnd || periodStart > periodEnd) throw bad('Statement period must include every imported transaction date.');
    if (periodEnd > req.today) throw bad('Statement period end cannot be in the future.');
    return { rows: review, summary: { count: rows.length, duplicates: review.filter((r) => r.duplicate).length, creditsCents: rows.reduce((s, r) => s + Math.max(0, r.amountCents), 0), debitsCents: rows.reduce((s, r) => s + Math.max(0, -r.amountCents), 0), periodStart, periodEnd, openingBalanceCents, closingBalanceCents, calculatedClosingBalanceCents: expected, discrepancyCents: expected === null || closingBalanceCents === null ? null : closingBalanceCents - expected } };
  };
  r.post('/bank-statements/preview', wrap(async (req, res) => {
    const account = await findStatementAccount(req);
    const review = await getStatementReview(req, account);
    res.json({ ...review, fileType: req.statementSource.fileType, headers: req.body.columnMap || req.statementSource.columns });
  }));
  r.post('/bank-statements/import', wrap(async (req, res) => {
    const account = await findStatementAccount(req), review = await getStatementReview(req, account);
    if (review.summary.openingBalanceCents === null || review.summary.closingBalanceCents === null) throw bad('Enter the statement opening and closing balances before importing.');
    if (Math.abs(review.summary.discrepancyCents) > 1) throw bad('The statement does not reconcile. Review the balances and transaction mapping before importing.');
    const importId = new ObjectId(), importedAt = new Date();
    const filename = str(req.body.filename || 'Statement.csv', 'Filename', { required: true, max: 180 });
    const fileType = oneOf(req.statementSource.fileType, 'File type', ['csv', 'xlsx', 'pdf']);
    const encodedFile = req.body.sourceFileBase64;
    let sourceFile = null, sourceFileSha256 = null;
    if (typeof encodedFile !== 'string' || !encodedFile.length) throw bad('The original statement file is required to complete the import.');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedFile)) throw bad('The statement file could not be read. Choose it again and retry.');
    sourceFile = Buffer.from(encodedFile, 'base64');
    if (!sourceFile.length || sourceFile.length > 10 * 1024 * 1024) throw bad('Statement files must be 10 MB or smaller.');
    if (req.statementSource.sourceFileSha256 !== createHash('sha256').update(sourceFile).digest('hex')) throw bad('The statement changed after review. Upload and review the file again.');
    sourceFileSha256 = req.statementSource.sourceFileSha256;
    const rows = review.rows.filter((r) => !r.duplicate);
    const docs = rows.map((row) => ({ businessId: req.businessId, accountId: account._id, date: row.date, description: row.description, vendor: row.vendor, category: row.category, financialClass: row.financialClass, amountCents: row.amountCents, currency: row.currency, reference: row.reference, runningBalanceCents: row.runningBalanceCents, sourceRowNumber: row.sourceRowNumber, source: 'bank-statement', importId, fingerprint: row.fingerprint, reconciliationStatus: 'unmatched', createdAt: importedAt, updatedAt: importedAt }));
    const reservation = docs.length ? await reserveUsage(db, { businessId: req.businessId, planId: planFor(req), metric: 'financialRecords', amount: docs.length, now: importedAt }) : null;
    if (reservation) docs.forEach((doc) => { doc.quotaReservationId = reservation.token; });
    const session = db.client?.startSession?.();
    let transactionalImport = false;
    try {
      const hello = await db.admin().command({ hello: 1 });
      if (session && (hello.setName || hello.msg === 'isdbgrid')) {
        transactionalImport = true;
        await session.withTransaction(async () => {
          if (docs.length) await C('transactions').insertMany(docs, { session });
          await C('statementImports').insertOne({ _id: importId, businessId: req.businessId, accountId: account._id, filename, fileType, sourceFile, sourceFileSha256, importedAt, status: 'complete', periodStart: review.summary.periodStart, periodEnd: review.summary.periodEnd, openingBalanceCents: review.summary.openingBalanceCents, closingBalanceCents: review.summary.closingBalanceCents, calculatedClosingBalanceCents: review.summary.calculatedClosingBalanceCents, discrepancyCents: review.summary.discrepancyCents, transactionCount: review.summary.count, importedCount: docs.length, duplicateCount: review.summary.duplicates, creditsCents: review.summary.creditsCents, debitsCents: review.summary.debitsCents }, { session });
        });
      } else {
        if (docs.length) await C('transactions').insertMany(docs, { ordered: true });
        await C('statementImports').insertOne({ _id: importId, businessId: req.businessId, accountId: account._id, filename, fileType, sourceFile, sourceFileSha256, importedAt, status: 'complete', periodStart: review.summary.periodStart, periodEnd: review.summary.periodEnd, openingBalanceCents: review.summary.openingBalanceCents, closingBalanceCents: review.summary.closingBalanceCents, calculatedClosingBalanceCents: review.summary.calculatedClosingBalanceCents, discrepancyCents: review.summary.discrepancyCents, transactionCount: review.summary.count, importedCount: docs.length, duplicateCount: review.summary.duplicates, creditsCents: review.summary.creditsCents, debitsCents: review.summary.debitsCents });
      }
    } catch (e) {
      await releaseUsage(db, reservation);
      if (!transactionalImport) {
        await C('transactions').deleteMany(scoped(req, { importId }));
        await C('statementImports').deleteOne(scoped(req, { _id: importId }));
      }
      if (e.code === 11000) throw new HttpError(409, 'These transactions were imported in another session. Refresh the preview before retrying.');
      throw e;
    } finally { await session?.endSession(); }
    if (reservation) await finalizeUsage(db, reservation, { entity: 'bank-statement-import' });
    const emailNotification = await notifyAccount(req.user, 'Bank statement import complete', `A bank statement was imported into Morgan.\n\nAccount: ${account.name}\nFile: ${filename}\nPeriod: ${review.summary.periodStart} to ${review.summary.periodEnd}\nImported transactions: ${docs.length}\nDuplicates skipped: ${review.summary.duplicates}\nImported at: ${importedAt.toISOString()}\n\nIf you did not perform this action, review your account sessions in Morgan Settings.`);
    res.status(201).json({ importId: String(importId), imported: docs.length, duplicates: review.summary.duplicates, matchedSuggestions: review.rows.filter((r) => r.suggestedMatch).length, summary: review.summary, emailNotification });
  }));

  r.patch('/transactions/:id', wrap(async (req, res) => {
    const _id = oid(req.params.id);
    const existing = await C('transactions').findOne(scoped(req, { _id }));
    if (!existing) throw new HttpError(404, 'Transaction not found');
    if (existing.source === 'bank-statement') throw bad('Statement transactions are traceable source records and cannot be edited here. Reimport a corrected CSV instead.');
    if (existing.invoiceId || existing.billId) throw bad('This transaction was created by a payment. Edit the payment on its invoice or bill instead.');
    const set = txnFields(req.body || {});
    await C('transactions').updateOne(scoped(req, { _id }), { $set: set });
    res.json(pub({ ...existing, ...set }));
  }));

  r.patch('/bank-transactions/:id/classification', wrap(async (req, res) => {
    const _id = oid(req.params.id);
    const existing = await C('transactions').findOne(scoped(req, { _id, source: 'bank-statement' }));
    if (!existing) throw new HttpError(404, 'Imported bank transaction not found');
    if (existing.reconciliationStatus === 'matched') throw bad('Matched statement transactions inherit their classification from the linked record.');
    const financialClass = oneOf(req.body?.financialClass, 'Financial treatment', ['income', 'expense', 'transfer', 'financing', 'owner-contribution', 'owner-withdrawal', 'refund', 'reversal', 'card-payment', 'unclassified']);
    validateClassDirection(financialClass, existing.amountCents);
    const category = str(req.body?.category, 'Category', { max: 60 }) || 'Uncategorized';
    const set = { financialClass, category, updatedAt: new Date() };
    const { modifiedCount } = await C('transactions').updateOne(scoped(req, { _id, source: 'bank-statement', reconciliationStatus: { $ne: 'matched' } }), { $set: set });
    if (!modifiedCount) throw new HttpError(409, 'This transaction was reconciled during the update. Refresh and review the linked record.');
    await C('financialAudit').insertOne({ businessId: req.businessId, recordId: _id, recordType: 'transaction', action: 'classification-changed', before: { financialClass: existing.financialClass || 'unclassified', category: existing.category }, after: set, createdAt: new Date() });
    res.json(pub({ ...existing, ...set }));
  }));

  r.delete('/transactions/:id', wrap(async (req, res) => {
    const _id = oid(req.params.id);
    const existing = await C('transactions').findOne(scoped(req, { _id }));
    if (!existing) throw new HttpError(404, 'Transaction not found');
    if (existing.source === 'bank-statement') throw bad('Statement transactions are traceable source records and cannot be deleted here.');
    if (existing.invoiceId || existing.billId) throw bad('This transaction is linked to a payment. Remove the payment from its invoice or bill instead.');
    await C('transactions').deleteOne(scoped(req, { _id }));
    res.json({ ok: true });
  }));

  /* ---------------- Customers ---------------- */
  const customerFields = (b) => ({
    name: str(b.name, 'Customer name', { required: true, max: 120 }),
    email: email(b.email, 'Customer email', false),
    address: str(b.address, 'Address', { max: 400 }),
  });
  r.get('/customers', wrap(async (req, res) => {
    const [list, invs] = await Promise.all([
      C('customers').find(scoped(req)).sort({ name: 1 }).toArray(),
      C('invoices').find(scoped(req, { status: { $ne: 'void' } })).toArray(),
    ]);
    const now = req.today;
    const stats = new Map();
    for (const inv of invs.map((i) => decorateInvoice(i, now))) {
      const s = stats.get(inv.customerId) || { invoiced: 0, outstanding: 0, invoices: 0 };
      if (inv.status !== 'draft') { s.invoiced += inv.totals.total; s.outstanding += inv.status === 'sent' ? inv.balanceDue : 0; }
      s.invoices++;
      stats.set(inv.customerId, s);
    }
    res.json(list.map((c) => ({ ...pub(c), ...(stats.get(String(c._id)) || { invoiced: 0, outstanding: 0, invoices: 0 }) })));
  }));
  r.post('/customers', wrap(async (req, res) => {
    const doc = { ...customerFields(req.body || {}), businessId: req.businessId, createdAt: new Date() };
    const { insertedId } = await C('customers').insertOne(doc);
    res.status(201).json(pub({ _id: insertedId, ...doc }));
  }));
  r.patch('/customers/:id', wrap(async (req, res) => {
    const _id = oid(req.params.id);
    const set = customerFields(req.body || {});
    const { matchedCount } = await C('customers').updateOne(scoped(req, { _id }), { $set: set });
    if (!matchedCount) throw new HttpError(404, 'Customer not found');
    res.json({ id: req.params.id, ...set });
  }));
  r.delete('/customers/:id', wrap(async (req, res) => {
    const _id = oid(req.params.id);
    if (await C('invoices').findOne(scoped(req, { customerId: _id }))) throw bad('This customer has invoices. Void or delete them first.');
    const { deletedCount } = await C('customers').deleteOne(scoped(req, { _id }));
    if (!deletedCount) throw new HttpError(404, 'Customer not found');
    res.json({ ok: true });
  }));

  /* ---------------- Invoices ---------------- */
  const invoiceFields = async (req, b) => {
    const customerId = oid(String(b.customerId || ''));
    const customer = await C('customers').findOne(scoped(req, { _id: customerId }));
    if (!customer) throw bad('Choose a customer');
    if (!Array.isArray(b.items) || !b.items.length) throw bad('Add at least one line item');
    if (b.items.length > 100) throw bad('An invoice can have at most 100 line items');
    const items = b.items.map((it, i) => {
      const quantity = Number(it.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e6 || Math.round(quantity * 1000) !== quantity * 1000) throw bad(`Line ${i + 1}: quantity must be positive with at most 3 decimals`);
      return {
        description: str(it.description, `Line ${i + 1} description`, { required: true, max: 300 }),
        quantity,
        unitCents: cents(it.unitCents, `Line ${i + 1} price`, { min: 0, max: 1e11 }),
      };
    });
    const issueDate = date(b.issueDate, 'Issue date');
    const dueDate = date(b.dueDate, 'Due date');
    if (dueDate < issueDate) throw bad('Due date cannot be before the issue date');
    return {
      customerId, customer: { name: customer.name, email: customer.email || '', address: customer.address || '' },
      issueDate, dueDate, items,
      taxRateBps: int(b.taxRateBps ?? 0, 'Tax rate', { min: 0, max: 10000 }),
      discountCents: cents(b.discountCents ?? 0, 'Discount', { min: 0, max: 1e11 }),
      notes: str(b.notes, 'Notes', { max: 2000 }),
    };
  };
  const loadInvoice = async (req) => {
    const inv = await C('invoices').findOne(scoped(req, { _id: oid(req.params.id) }));
    if (!inv) throw new HttpError(404, 'Invoice not found');
    return inv;
  };

  r.get('/invoices', wrap(async (req, res) => {
    const now = req.today;
    const list = (await C('invoices').find(scoped(req)).sort({ issueDate: -1, number: -1 }).toArray()).map((i) => decorateInvoice(i, now));
    res.json(list);
  }));
  r.get('/invoices/:id', wrap(async (req, res) => res.json(dec(req, await loadInvoice(req)))));

  r.post('/invoices', wrap(async (req, res) => {
    const fields = await invoiceFields(req, req.body || {});
    const reservation = await reserveUsage(db, { businessId: req.businessId, planId: planFor(req), metric: 'financialRecords', amount: 1 });
    try {
    // A prefix change can make a new number collide with an old one; skip ahead until it's free.
    for (let attempt = 0; attempt < 20; attempt++) {
      const biz = await C('businesses').findOneAndUpdate({ _id: req.businessId }, { $inc: { invoiceSeq: 1 } }, { returnDocument: 'after' });
      const doc = {
        ...fields, businessId: req.businessId, number: `${biz.invoicePrefix}${String(biz.invoiceSeq).padStart(4, '0')}`,
        status: 'draft', payments: [], quotaReservationId: reservation.token, createdAt: new Date(), updatedAt: new Date(),
      };
      try {
        const { insertedId } = await C('invoices').insertOne(doc);
        await finalizeUsage(db, reservation, { entity: 'invoice' });
        return res.status(201).json(dec(req, { _id: insertedId, ...doc }));
      } catch (e) { if (e.code !== 11000) throw e; }
    }
    throw new HttpError(409, 'Could not allocate an invoice number. Change the invoice prefix in Settings.');
    } catch (error) { await releaseUsage(db, reservation); throw error; }
  }));

  r.patch('/invoices/:id', wrap(async (req, res) => {
    const inv = await loadInvoice(req);
    if (['paid', 'void'].includes(inv.status)) throw bad(`A ${inv.status} invoice cannot be edited`);
    const fields = await invoiceFields(req, req.body || {});
    const paid = (inv.payments || []).reduce((s, p) => s + p.amountCents, 0);
    if (invoiceTotals(fields).total < paid) throw bad('The new total is less than the amount already paid');
    await C('invoices').updateOne({ _id: inv._id, businessId: req.businessId }, { $set: { ...fields, updatedAt: new Date() } });
    res.json(dec(req, { ...inv, ...fields }));
  }));

  r.delete('/invoices/:id', wrap(async (req, res) => {
    const inv = await loadInvoice(req);
    if (inv.status !== 'draft') throw bad('Only drafts can be deleted. Void a sent invoice instead.');
    await C('invoices').deleteOne({ _id: inv._id, businessId: req.businessId });
    res.json({ ok: true });
  }));

  r.post('/invoices/:id/mark-sent', wrap(async (req, res) => {
    const inv = await loadInvoice(req);
    if (inv.status !== 'draft') throw bad('Only a draft can be marked as sent');
    await C('invoices').updateOne({ _id: inv._id, businessId: req.businessId }, { $set: { status: 'sent', sentAt: new Date(), sentVia: 'manual' } });
    res.json(dec(req, { ...inv, status: 'sent', sentAt: new Date(), sentVia: 'manual' }));
  }));

  r.post('/invoices/:id/send', rateLimit({ key: 'send', limit: 30, windowMs: 3600e3 }), wrap(async (req, res) => {
    const inv = await loadInvoice(req);
    if (['paid', 'void'].includes(inv.status)) throw bad(`A ${inv.status} invoice cannot be sent`);
    const to = email(req.body?.to || inv.customer.email, 'Recipient email');
    if (!mailConfigured()) throw new HttpError(503, 'Email delivery is not configured on this server. Download the PDF or mark the invoice as sent instead.');
    const biz = await business(req);
    const d = dec(req, inv);
    const message = str(req.body?.message, 'Message', { max: 2000 });
    const emailResult = await sendMail({
      db, kind: 'invoice', to, replyTo: biz.email || undefined,
      subject: `Invoice ${inv.number} from ${biz.name}`,
      text: `${message ? message + '\n\n' : ''}Invoice ${inv.number}\nAmount due: ${formatMoney(d.balanceDue, biz.currency)}\nDue date: ${inv.dueDate}\n\nThe invoice is attached as a PDF.\n\n${biz.name}`,
      attachments: [{ filename: `${inv.number}.pdf`, content: invoicePdf(d, biz) }],
    });
    const set = { sentAt: new Date(), sentVia: 'email', sentTo: to, ...(inv.status === 'draft' && { status: 'sent' }) };
    await C('invoices').updateOne({ _id: inv._id, businessId: req.businessId }, { $set: set });
    res.json({ ...dec(req, { ...inv, ...set }), emailStatus: emailResult.status, emailId: emailResult.id });
  }));

  r.post('/invoices/:id/void', wrap(async (req, res) => {
    const inv = await loadInvoice(req);
    if (inv.status !== 'sent') throw bad('Only a sent, unpaid invoice can be voided');
    if ((inv.payments || []).length) throw bad('Remove recorded payments before voiding');
    await C('invoices').updateOne({ _id: inv._id, businessId: req.businessId }, { $set: { status: 'void', voidedAt: new Date() } });
    res.json(dec(req, { ...inv, status: 'void' }));
  }));

  r.post('/invoices/:id/payments', wrap(async (req, res) => {
    const inv = await loadInvoice(req);
    if (inv.status !== 'sent') throw bad(inv.status === 'draft' ? 'Send or mark the invoice as sent before recording a payment' : `Cannot record a payment on a ${inv.status} invoice`);
    const d = dec(req, inv);
    const amountCents = cents(req.body?.amountCents ?? req.body?.amount, 'Payment amount', { min: 1 });
    if (amountCents > d.balanceDue) throw bad(`Payment exceeds the balance due (${formatMoney(d.balanceDue, (await business(req)).currency)})`);
    const payDate = date(req.body?.date || req.today, 'Payment date');
    const method = str(req.body?.method, 'Method', { max: 40 }) || 'Bank transfer';
    const paymentId = new ObjectId();
    const txn = {
      businessId: req.businessId, date: payDate, description: `Payment · ${inv.number}`, vendor: inv.customer.name,
      category: 'Client revenue', amountCents, notes: method, invoiceId: inv._id, paymentId, source: 'invoice-payment', createdAt: new Date(),
    };
    const reservation = await reserveUsage(db, { businessId: req.businessId, planId: planFor(req), metric: 'financialRecords', amount: 1 });
    let insertedId, paymentCommitted = false;
    try {
    txn.quotaReservationId = reservation.token;
    ({ insertedId } = await C('transactions').insertOne(txn));
    const payment = { id: paymentId, amountCents, date: payDate, method, transactionId: insertedId };
    const fullyPaid = amountCents === d.balanceDue;
    // Guard against concurrent payments: only apply if payments array is unchanged.
    const { modifiedCount } = await C('invoices').updateOne(
      { _id: inv._id, businessId: req.businessId, status: 'sent', payments: inv.payments || [] },
      { $push: { payments: payment }, $set: { ...(fullyPaid && { status: 'paid', paidAt: new Date() }) } },
    );
    if (!modifiedCount) throw new HttpError(409, 'The invoice changed. Refresh and try again.');
    paymentCommitted = true;
    await finalizeUsage(db, reservation, { entity: 'invoice-payment-transaction' });
    res.status(201).json(dec(req, { ...inv, payments: [...(inv.payments || []), payment], ...(fullyPaid && { status: 'paid' }) }));
    } catch (error) { if (!paymentCommitted) { if (insertedId) await C('transactions').deleteOne({ _id: insertedId, businessId: req.businessId }); await releaseUsage(db, reservation); } throw error; }
  }));

  r.delete('/invoices/:id/payments/:pid', wrap(async (req, res) => {
    const inv = await loadInvoice(req);
    const pid = oid(req.params.pid);
    const p = (inv.payments || []).find((x) => String(x.id) === String(pid));
    if (!p) throw new HttpError(404, 'Payment not found');
    const payments = inv.payments.filter((x) => x !== p);
    await C('invoices').updateOne({ _id: inv._id, businessId: req.businessId }, { $set: { payments, status: 'sent' }, $unset: { paidAt: '' } });
    if (p.transactionId) {
      const txn = await C('transactions').findOne({ _id: p.transactionId, businessId: req.businessId });
      if (txn?.source === 'bank-statement') await C('transactions').updateOne({ _id: p.transactionId, businessId: req.businessId }, { $set: { financialClass: 'unclassified', reconciliationStatus: 'unmatched', updatedAt: new Date() }, $unset: { invoiceId: '', paymentId: '', matchedRecordId: '', matchedRecordType: '', paymentEvidence: '' } });
      else await C('transactions').deleteOne({ _id: p.transactionId, businessId: req.businessId });
    }
    res.json(dec(req, { ...inv, payments, status: 'sent' }));
  }));

  r.get('/invoices/:id/pdf', wrap(async (req, res) => {
    const inv = dec(req, await loadInvoice(req));
    const pdf = invoicePdf(inv, await business(req));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${inv.number.replace(/[^\w.-]/g, '_')}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(pdf);
  }));

  /* ---------------- Bills (payables) ---------------- */
  const billFields = (b, now) => ({
    vendor: str(b.vendor, 'Vendor', { required: true, max: 120 }),
    description: str(b.description, 'Description', { max: 200 }),
    category: str(b.category, 'Category', { max: 60 }) || 'Uncategorized',
    amountCents: cents(b.amountCents ?? b.amount, 'Amount', { min: 1 }),
    issueDate: date(b.issueDate || now, 'Bill date'),
    dueDate: date(b.dueDate, 'Due date'),
  });
  r.get('/bills', wrap(async (req, res) => res.json((await C('bills').find(scoped(req)).sort({ status: -1, dueDate: 1 }).toArray()).map(decorateBill))));
  r.post('/bills', wrap(async (req, res) => {
    const doc = { ...billFields(req.body || {}, req.today), status: 'unpaid', payments: [], businessId: req.businessId, createdAt: new Date() };
    const { insertedId } = await createWithUsage(req, 'financialRecords', 1, (token) => C('bills').insertOne({ ...doc, quotaReservationId: token }), { entity: 'bill' });
    res.status(201).json(decorateBill({ _id: insertedId, ...doc }));
  }));
  r.patch('/bills/:id', wrap(async (req, res) => {
    const _id = oid(req.params.id);
    const bill = await C('bills').findOne(scoped(req, { _id }));
    if (!bill) throw new HttpError(404, 'Bill not found');
    const paidCents = (bill.payments || []).reduce((sum, p) => sum + p.amountCents, 0);
    if (bill.status === 'paid' || (bill.status === 'partial' && paidCents > 0)) throw bad('A bill with recorded payments cannot be edited. Remove the payments first.');
    const set = billFields(req.body || {}, req.today);
    await C('bills').updateOne(scoped(req, { _id }), { $set: set });
    res.json(decorateBill({ ...bill, ...set }));
  }));
  r.post('/bills/:id/pay', wrap(async (req, res) => {
    const _id = oid(req.params.id);
    const bill = await C('bills').findOne(scoped(req, { _id }));
    if (!bill) throw new HttpError(404, 'Bill not found');
    const payments = bill.payments || [];
    const paidCents = payments.reduce((sum, p) => sum + p.amountCents, 0);
    const balanceDueCents = bill.status === 'paid' && !payments.length ? 0 : bill.amountCents - paidCents;
    if (balanceDueCents <= 0) throw bad('This bill is already paid');
    const paidDate = date(req.body?.date || req.today, 'Payment date');
    const amountCents = req.body?.amountCents === undefined && req.body?.amount === undefined ? balanceDueCents : cents(req.body.amountCents ?? req.body.amount, 'Payment amount', { min: 1 });
    if (amountCents > balanceDueCents) throw bad('Payment exceeds the balance due');
    const paymentId = new ObjectId();
    const nextStatus = amountCents === balanceDueCents ? 'paid' : 'partial';
    const transaction = {
      businessId: req.businessId, date: paidDate, description: bill.description || `Bill · ${bill.vendor}`, vendor: bill.vendor,
      category: bill.category, financialClass: 'expense', amountCents: -amountCents, notes: '', billId: _id, paymentId, source: 'bill-payment', createdAt: new Date(),
    };
    const reservation = await reserveUsage(db, { businessId: req.businessId, planId: planFor(req), metric: 'financialRecords', amount: 1 });
    let paymentCommitted = false, insertedId;
    try {
    transaction.quotaReservationId = reservation.token;
    ({ insertedId } = await C('transactions').insertOne(transaction));
    const payment = { id: paymentId, amountCents, date: paidDate, method: 'Manual', transactionId: insertedId };
    const { modifiedCount } = await C('bills').updateOne(scoped(req, { _id, status: bill.status, payments }), { $push: { payments: payment }, $set: { status: nextStatus, ...(nextStatus === 'paid' && { paidDate }), transactionId: insertedId } });
    if (!modifiedCount) throw new HttpError(409, 'The bill changed. Refresh and try again.');
    paymentCommitted = true;
    await finalizeUsage(db, reservation, { entity: 'bill-payment-transaction' });
    res.json(decorateBill({ ...bill, status: nextStatus, payments: [...payments, payment], ...(nextStatus === 'paid' && { paidDate }), transactionId: insertedId }));
    } catch (error) { if (!paymentCommitted) { if (insertedId) await C('transactions').deleteOne({ _id: insertedId, businessId: req.businessId }); await releaseUsage(db, reservation); } throw error; }
  }));
  r.post('/bills/:id/unpay', wrap(async (req, res) => {
    const _id = oid(req.params.id);
    const bill = await C('bills').findOne(scoped(req, { _id, status: 'paid' }));
    if (!bill) throw new HttpError(404, 'Paid bill not found');
    const payments = bill.payments || [];
    const txns = payments.map((p) => p.transactionId).filter(Boolean);
    if (!txns.length && bill.transactionId) txns.push(bill.transactionId);
    if (txns.length) {
      const paymentTransactions = await C('transactions').find({ _id: { $in: txns }, businessId: req.businessId }).toArray();
      for (const txn of paymentTransactions) {
        if (txn.source === 'bank-statement') await C('transactions').updateOne({ _id: txn._id, businessId: req.businessId }, { $set: { financialClass: 'unclassified', reconciliationStatus: 'unmatched', updatedAt: new Date() }, $unset: { billId: '', paymentId: '', matchedRecordId: '', matchedRecordType: '', paymentEvidence: '' } });
        else await C('transactions').deleteOne({ _id: txn._id, businessId: req.businessId });
      }
    }
    await C('bills').updateOne(scoped(req, { _id }), { $set: { status: 'unpaid', payments: [] }, $unset: { paidDate: '', transactionId: '' } });
    res.json(decorateBill({ ...bill, status: 'unpaid', payments: [], paidDate: undefined, transactionId: undefined }));
  }));
  r.delete('/bills/:id', wrap(async (req, res) => {
    const _id = oid(req.params.id);
    const bill = await C('bills').findOne(scoped(req, { _id }));
    if (!bill) throw new HttpError(404, 'Bill not found');
    if (bill.status === 'paid' || bill.status === 'partial') throw bad('Remove recorded payments before deleting this bill');
    await C('bills').deleteOne(scoped(req, { _id }));
    res.json({ ok: true });
  }));

  /* ---------------- Analytics ---------------- */
  // shortcut: loads all of a business's records into memory per request; fine for SMB volumes, move to aggregation pipelines past ~100k rows.
  const loadAll = async (req) => {
    const now = req.today;
    const biz = await business(req);
    const [txns, invoices, bills] = await Promise.all([
      C('transactions').find(scoped(req, { currency: { $in: [biz.currency, null] }, excludedFromTotals: { $ne: true } })).toArray(),
      C('invoices').find(scoped(req)).toArray(),
      C('bills').find(scoped(req)).toArray(),
    ]);
    return { txns, invoices: invoices.map((i) => decorateInvoice(i, now)), bills: bills.map(decorateBill), biz, now };
  };
  const loadCashContext = async (req, biz, txns) => {
    const accounts = (await C('bankAccounts').find(scoped(req, { status: 'active', currency: biz.currency, type: { $ne: 'credit-card' } })).toArray());
    const sources = await Promise.all(accounts.map(async (account) => {
      const [records, statements] = await Promise.all([
        C('transactions').find(scoped(req, { accountId: account._id })).toArray(),
        C('statementImports').find(scoped(req, { accountId: account._id, closingBalanceCents: { $ne: null } }), { projection: { sourceFile: 0 } }).sort({ periodEnd: -1, importedAt: -1 }).toArray(),
      ]);
      return { account, records, statements };
    }));
    const positionAt = (asOf) => {
      // Settings/onboarding cashAccounts represent one user-confirmed aggregate starting position.
      // Use it once, then roll forward statement and manually entered transactions after its date.
      if ((biz.cashAccounts || []).length && biz.openingBalanceDate && biz.openingBalanceDate <= asOf) {
        const later = txns.filter((item) => item.date > biz.openingBalanceDate && item.date <= asOf);
        const balance = biz.openingBalanceCents + later.reduce((sum, item) => sum + item.amountCents, 0);
        const last = later.reduce((latest, item) => item.date > latest ? item.date : latest, biz.openingBalanceDate);
        return { balance, knownBalance: balance, missingAccounts: [], asOf: last, source: 'opening-balance' };
      }
      if (sources.length) {
        const parts = sources.map(({ account, records, statements }) => {
          const calculation = calculateAccountBalance(account, records, statements, asOf);
          return { account, balance: calculation.balance, asOf: calculation.balanceAsOf, source: calculation.balanceSource };
        });
        const missingAccounts = parts.filter((part) => part.balance === null).map((part) => part.account.name);
        const knownParts = parts.filter((part) => part.balance !== null);
        let knownBalance = knownParts.length ? knownParts.reduce((sum, part) => sum + part.balance, 0) : null;
        const complete = missingAccounts.length === 0;
        const sourceKinds = [...new Set(parts.map((part) => part.source).filter(Boolean))];
        const asOfDate = complete ? parts.reduce((oldest, part) => part.asOf < oldest ? part.asOf : oldest, asOf) : null;
        if (complete && knownBalance !== null) {
          const latestAccountBaseline = parts.reduce((latest, part) => part.asOf > latest ? part.asOf : latest, '');
          knownBalance += txns.filter((item) => !item.accountId && item.date > latestAccountBaseline && item.date <= asOf).reduce((sum, item) => sum + item.amountCents, 0);
        }
        return { balance: complete ? knownBalance : null, knownBalance, missingAccounts, asOf: asOfDate, source: complete ? (sourceKinds.length === 1 ? sourceKinds[0] : 'bank-accounts') : null };
      }
      const manualTxns = txns.filter((item) => !item.accountId);
      const balance = A.cashBalance(manualTxns, biz, asOf);
      if (balance === null) return { balance: null, knownBalance: null, missingAccounts: [], asOf: null, source: null };
      const lastActivity = manualTxns.reduce((latest, item) => item.date >= biz.openingBalanceDate && item.date <= asOf && item.date > latest ? item.date : latest, biz.openingBalanceDate);
      return { balance, knownBalance: balance, missingAccounts: [], asOf: lastActivity, source: 'opening-balance' };
    };
    return { positionAt };
  };
  const range = (req, now) => {
    const to = req.query.to ? date(req.query.to, 'To') : now;
    const from = req.query.from ? date(req.query.from, 'From') : `${now.slice(0, 7)}-01`;
    if (from > to) throw bad('From must be before To');
    return { from, to };
  };

  r.get('/overview', wrap(async (req, res) => {
    const { txns, invoices, bills, biz, now } = await loadAll(req);
    const cashContext = await loadCashContext(req, biz, txns);
    const currentCash = cashContext.positionAt(now);
    const { from, to } = range(req, now);
    const prior = A.priorPeriod(from, to);
    const months = A.monthsBack(now, 12);
    const open = invoices.filter((i) => ['sent', 'partial', 'overdue'].includes(i.displayStatus));
    const overdue = open.filter((i) => i.displayStatus === 'overdue');
    const unpaidBills = bills.filter((b) => b.status !== 'paid');
    const plannedItems = await C('planningItems').find(scoped(req)).toArray();
    const plan = A.cashflow({ txns, invoices: [], bills, plannedItems, business: biz, today: now, startingCash: currentCash.balance, days: plans[planFor(req)].limits.forecastDays });
    const monthlySpend = A.spending(txns, `${now.slice(0, 7)}-01`, now).total;
    const balanceAt = (count) => {
      if (currentCash.balance === null) return null;
      const movements = plan.weeks.slice(0, count).reduce((s, w) => s + w.inflows - w.outflows, 0);
      return currentCash.balance + movements;
    };
    const upcomingPlan = plan.weeks.flatMap((w) => w.items.filter((i) => i.type !== 'invoice')).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
    const balanceHistory = months.map((m) => {
      const [y, mo] = m.split('-').map(Number);
      const end = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
      return { month: m, balance: cashContext.positionAt(end < now ? end : now).balance };
    });
    res.json({
      period: { from, to, ...A.totals(txns, from, to) },
      prior: { ...prior, ...A.totals(txns, prior.from, prior.to) },
      cash: currentCash.balance,
      cashDetails: { source: currentCash.source, asOf: currentCash.asOf, missingAccounts: currentCash.missingAccounts, knownBalanceCents: currentCash.knownBalance },
      balanceHistory,
      hasOpeningBalance: currentCash.balance !== null,
      monthly: A.monthlySeries(txns, months),
      receivables: { outstanding: open.reduce((s, i) => s + i.balanceDue, 0), count: open.length, overdue: overdue.reduce((s, i) => s + i.balanceDue, 0), overdueCount: overdue.length },
      payables: { outstanding: unpaidBills.reduce((s, b) => s + b.balanceDueCents, 0), count: unpaidBills.length, dueSoon: unpaidBills.filter((b) => b.dueDate <= addDays(now, 7)).slice(0, 6) },
      aging: A.aging(invoices, now),
      upcomingInvoices: open.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6),
      recent: txns.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map(pub),
      counts: { transactions: txns.length, invoices: invoices.length, bills: bills.length, unclassified: txns.filter((t) => A.transactionClass(t) === 'unclassified').length },
      financialPlan: {
        monthlyBudgetCents: biz.monthlyBudgetCents ?? null,
        monthlySpend,
        monthlyRemaining: biz.monthlyBudgetCents == null ? null : biz.monthlyBudgetCents - monthlySpend,
        minimumCashCents: biz.minimumCashCents ?? null,
        forecast: { days7: balanceAt(1), days30: balanceAt(5), days90: plans[planFor(req)].limits.forecastDays >= 90 ? balanceAt(13) : null },
        upcoming: upcomingPlan,
      },
    });
  }));

  r.get('/spending', wrap(async (req, res) => {
    const { txns, now } = await loadAll(req);
    const { from, to } = range(req, now);
    const planned = await C('planningItems').find(scoped(req, { type: 'expense', cadence: { $ne: 'once' } })).sort({ nextDate: 1 }).toArray();
    const monthlyFactor = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, annually: 1 / 12 };
    res.json({ ...A.spending(txns, from, to), plannedRecurring: planned.map((i) => ({ id: String(i._id), name: i.name, category: i.category, amountCents: i.amountCents, cadence: i.cadence, nextDate: i.nextDate, monthlyEstimateCents: Math.round(i.amountCents * monthlyFactor[i.cadence]) })) });
  }));

  r.get('/cashflow', wrap(async (req, res) => {
    const { txns, invoices, bills, biz, now } = await loadAll(req);
    const [plannedItems, cashContext] = await Promise.all([C('planningItems').find(scoped(req)).toArray(), loadCashContext(req, biz, txns)]);
    const currentCash = cashContext.positionAt(now);
    res.json({ ...A.cashflow({ txns, invoices, bills, plannedItems, business: biz, today: now, startingCash: currentCash.balance, days: plans[planFor(req)].limits.forecastDays }), cashSource: currentCash.source, cashAsOf: currentCash.asOf, cashMissingAccounts: currentCash.missingAccounts });
  }));

  /* ---------------- Horizon: deterministic forecasts and saved scenarios ---------------- */
  const horizonContext = async (req) => {
    const { txns, invoices, bills, biz, now } = await loadAll(req);
    const [plannedItems, cashContext] = await Promise.all([C('planningItems').find(scoped(req)).toArray(), loadCashContext(req, biz, txns)]);
    return { txns, invoices, bills, plannedItems, biz, now, cash: cashContext.positionAt(now) };
  };
  const runHorizon = async (req, scenario = null) => {
    const ctx = await horizonContext(req);
    const forecast = horizonForecast({ ...ctx, today: ctx.now, startingCash: ctx.cash.balance, days: plans[planFor(req)].limits.forecastDays, scenario });
    return { ...forecast, periodDays: Number(req.query.days) || 90, cashSource: ctx.cash.source, cashAsOf: ctx.cash.asOf, cashMissingAccounts: ctx.cash.missingAccounts, hasOpeningBalance: ctx.cash.balance !== null };
  };
  r.get('/horizon', wrap(async (req, res) => {
    const maxDays = plans[planFor(req)].limits.forecastDays;
    const periodDays = int(req.query.days ?? maxDays, 'Forecast period', { min: 30, max: 90 });
    if (![30, 60, 90].includes(periodDays)) throw bad('Forecast period must be 30, 60, or 90 days');
    if (periodDays > maxDays) throw new HttpError(403, `Your ${plans[planFor(req)].name} plan includes forecasts up to ${maxDays} days. Upgrade to explore a longer period.`);
    const scenarioId = req.query.scenarioId ? oid(req.query.scenarioId) : null;
    const scenario = scenarioId ? await C('horizonScenarios').findOne(scoped(req, { _id: scenarioId })) : null;
    if (scenarioId && !scenario) throw new HttpError(404, 'Scenario not found');
    const data = await runHorizon(req, scenario);
    data.periodDays = periodDays;
    for (const key of Object.keys(data.forecasts)) data.forecasts[key] = data.forecasts[key].slice(0, periodDays);
    data.checkpoints = data.checkpoints.filter((point) => point.days <= periodDays);
    data.events = data.events.filter((event) => event.date <= addDays(req.today, periodDays));
    data.scenario = scenario ? { id: String(scenario._id), name: scenario.name, assumptions: scenario.assumptions } : null;
    if (scenario) data.baseForecast = (await runHorizon(req)).forecasts;
    res.json(data);
  }));
  const scenarioTypes = ['hire', 'lost-client', 'delayed-payments', 'new-client', 'increased-expense', 'large-purchase'];
  const scenarioFields = (body) => {
    const name = str(body?.name, 'Scenario name', { required: true, max: 100 });
    if (!Array.isArray(body?.assumptions) || !body.assumptions.length || body.assumptions.length > 12) throw bad('Add between 1 and 12 scenario assumptions');
    const assumptions = body.assumptions.map((a) => {
      const type = oneOf(a?.type, 'Scenario type', scenarioTypes);
      const startDate = date(a.startDate, 'Start date');
      const title = str(a.name || type.replaceAll('-', ' '), 'Assumption name', { required: true, max: 100 });
      if (type === 'delayed-payments') return { type, startDate, name: title, delayDays: int(a.delayDays, 'Payment delay', { min: 1, max: 90 }) };
      return { type, startDate, name: title, amountCents: cents(a.amountCents, 'Amount', { min: 1 }), cadence: oneOf(a.cadence || (type === 'large-purchase' ? 'once' : 'monthly'), 'Frequency', ['once', 'monthly', 'quarterly']), durationMonths: a.durationMonths === undefined || a.durationMonths === null || a.durationMonths === '' ? null : int(a.durationMonths, 'Duration', { min: 1, max: 36 }) };
    });
    return { name, assumptions };
  };
  r.get('/horizon/scenarios', wrap(async (req, res) => {
    const list = await C('horizonScenarios').find(scoped(req)).sort({ updatedAt: -1 }).toArray();
    res.json(list.map(({ _id, businessId, ...item }) => ({ id: String(_id), ...item })));
  }));
  r.post('/horizon/scenarios', wrap(async (req, res) => {
    const fields = scenarioFields(req.body);
    const now = new Date();
    const scenarioId = new ObjectId();
    await claimScenarioSlot(req, scenarioId);
    const doc = { _id: scenarioId, ...fields, businessId: req.businessId, createdAt: now, updatedAt: now };
    let insertedId;
    try { ({ insertedId } = await C('horizonScenarios').insertOne(doc)); }
    catch (error) { await C('businesses').updateOne({ _id: req.businessId }, { $pull: { activeScenarioIds: String(scenarioId) } }); throw error; }
    res.status(201).json({ id: String(insertedId), ...fields, createdAt: now, updatedAt: now });
  }));
  r.patch('/horizon/scenarios/:id', wrap(async (req, res) => {
    const fields = scenarioFields(req.body); const updatedAt = new Date();
    const found = await C('horizonScenarios').findOneAndUpdate(scoped(req, { _id: oid(req.params.id) }), { $set: { ...fields, updatedAt } }, { returnDocument: 'after' });
    if (!found) throw new HttpError(404, 'Scenario not found');
    const { _id, businessId, ...item } = found;
    res.json({ id: String(_id), ...item });
  }));
  r.delete('/horizon/scenarios/:id', wrap(async (req, res) => {
    const { deletedCount } = await C('horizonScenarios').deleteOne(scoped(req, { _id: oid(req.params.id) }));
    if (!deletedCount) throw new HttpError(404, 'Scenario not found');
    await C('businesses').updateOne({ _id: req.businessId }, { $pull: { activeScenarioIds: req.params.id } });
    res.json({ ok: true });
  }));

  /* ---------------- Gemini financial intelligence ---------------- */
  r.post('/gemini/ask', rateLimit({ key: 'gemini', limit: 20, windowMs: 60 * 60e3 }), wrap(async (req, res) => {
    const question = str(req.body?.question, 'Question', { required: true, max: 1200 });
    const requestId = typeof req.body?.requestId === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(req.body.requestId) ? req.body.requestId : randomBytes(18).toString('base64url');
    const requestKey = `${String(req.businessId)}:${requestId}`;
    const requests = C('intelligenceRequests');
    const previous = await requests.findOne({ _id: requestKey, businessId: req.businessId });
    if (previous?.status === 'complete') return res.json(previous.response);
    if (previous?.status === 'pending') throw new HttpError(409, 'This Morgan Intelligence request is already processing. Wait for it to finish before retrying.');
    try { await requests.insertOne({ _id: requestKey, businessId: req.businessId, requestId, status: 'pending', createdAt: new Date() }); }
    catch (error) { if (error.code === 11000) throw new HttpError(409, 'This Morgan Intelligence request is already processing.'); throw error; }
    let usageReservation;
    try {
    usageReservation = await reserveUsage(db, { businessId: req.businessId, planId: planFor(req), metric: 'intelligenceRequests' });
    const scenario = req.body?.scenarioId ? await C('horizonScenarios').findOne(scoped(req, { _id: oid(req.body.scenarioId) })) : null;
    if (req.body?.scenarioId && !scenario) throw new HttpError(404, 'Scenario not found');
    const threadId = req.body?.threadId ? oid(req.body.threadId) : new ObjectId();
    let thread = req.body?.threadId ? await C('geminiThreads').findOne(scoped(req, { _id: threadId })) : null;
    if (req.body?.threadId && !thread) throw new HttpError(404, 'Conversation not found');
    const ctx = await horizonContext(req);
    const forecast = horizonForecast({ ...ctx, today: ctx.now, startingCash: ctx.cash.balance, days: plans[planFor(req)].limits.forecastDays, scenario });
    const currency = ctx.biz.currency;
    const displayMoney = (amount, sign = false) => amount === null || amount === undefined ? null : formatMoney(amount, currency, { sign });
    const transactionRecords = ctx.txns.filter((t) => !t.excludedFromTotals).slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
    const openInvoices = ctx.invoices.filter((i) => ['sent', 'partial', 'overdue'].includes(i.displayStatus));
    const openBills = ctx.bills.filter((b) => ['unpaid', 'partial'].includes(b.status));
    const sourceRecords = [
      ...transactionRecords.map((t) => ({ id: String(t._id), kind: 'transaction', label: t.description || t.vendor || 'Recorded transaction', amountCents: t.amountCents, date: t.date })),
      ...openInvoices.map((i) => ({ id: i.id, kind: 'invoice', label: `Invoice ${i.number} · ${i.customer.name}`, amountCents: i.balanceDue, date: i.dueDate })),
      ...openBills.map((b) => ({ id: String(b._id), kind: 'bill', label: `Bill · ${b.vendor}`, amountCents: -(b.balanceDueCents ?? b.amountCents), date: b.dueDate })),
    ].map((record, index) => ({ ...record, ref: `source-${index + 1}` }));
    const sourceRef = new Map(sourceRecords.map((record) => [`${record.kind}:${record.id}`, record.ref]));
    const sourceByRef = new Map(sourceRecords.map((record) => [record.ref, record]));
    const checkpoints = (result) => (result?.checkpoints || []).map((point) => ({
      period: `${point.days}-day outlook`, conservative: displayMoney(point.conservativeCents),
      base: displayMoney(point.baseCents), optimistic: displayMoney(point.optimisticCents),
    }));
    const withoutScenario = scenario ? horizonForecast({ ...ctx, today: ctx.now, startingCash: ctx.cash.balance, days: plans[planFor(req)].limits.forecastDays }) : null;
    const cadenceLabel = (cadence) => ({ once: 'one time', monthly: 'monthly', quarterly: 'quarterly' }[cadence] || 'recurring');
    const scenarioTypes = { hire: 'Hire a team member', 'lost-client': 'Lose a client', 'delayed-payments': 'Delay client payments', 'new-client': 'Add a new client', 'increased-expense': 'Increase recurring expenses', 'large-purchase': 'Make a large purchase' };
    const scenarioContext = scenario ? {
      name: scenario.name,
      assumptions: scenario.assumptions.map((item) => ({
        change: scenarioTypes[item.type] || 'Business change', description: item.name, starts: item.startDate,
        ...(item.type === 'delayed-payments' ? { paymentDelay: `${item.delayDays} days` } : { amount: displayMoney(item.amountCents), frequency: cadenceLabel(item.cadence), duration: item.durationMonths ? `${item.durationMonths} months` : 'through the forecast' }),
      })),
    } : null;
    const sourceKind = (type) => ({ invoice: 'client payment', bill: 'bill payment', planned: 'scheduled movement', scenario: 'scenario change' }[type] || 'cash movement');
    const confidenceLabel = (value) => ({ invoiced: 'invoice issued', contracted: 'contracted', estimated: 'estimated', planned: 'planned', confirmed: 'confirmed bill', scenario: 'scenario input' }[value] || 'recorded');
    const baseEvents = forecast.events.map((event) => ({
      type: sourceKind(event.type), description: event.label, date: event.date,
      amount: displayMoney(event.amountCents, true), confidence: confidenceLabel(event.confidence),
      ...(event.type === 'invoice' && event.paymentPrediction ? { paymentTiming: event.paymentPrediction.observations ? `${event.paymentPrediction.delayDays} days average customer delay based on ${event.paymentPrediction.observations} paid invoices` : 'No paid-invoice history; due date used' } : {}),
      ...(['invoice', 'bill'].includes(event.type) && sourceRef.has(`${event.type}:${event.id}`) ? { source: sourceRef.get(`${event.type}:${event.id}`) } : {}),
    }));
    const financialContext = {
      currency,
      today: ctx.now,
      recordedCash: { amount: displayMoney(ctx.cash.balance), asOf: ctx.cash.asOf, source: ctx.cash.source ? ({ 'opening-balance': 'Business opening balance updated with later recorded activity', 'bank-accounts': 'Recorded bank account balances' }[ctx.cash.source] || 'Recorded account balance') : 'No dated cash balance available' },
      selectedScenario: scenarioContext,
      forecast: {
        case: scenario ? `Selected scenario: ${scenario.name}` : 'Business forecast',
        outcomes: checkpoints(forecast),
        ...(withoutScenario ? { businessForecastWithoutScenario: checkpoints(withoutScenario) } : {}),
        weeklyBaseCase: forecast.forecasts.base.filter((_row, index) => index % 7 === 6).map((row) => ({
          weekEnding: row.date, expectedInflow: displayMoney(row.inflowsCents), expectedOutflow: displayMoney(row.outflowsCents),
          netMovement: displayMoney(row.netCents, true), projectedCash: displayMoney(row.balanceCents),
        })),
        lowestProjectedCash: forecast.lowPoint ? { date: forecast.lowPoint.date, amount: displayMoney(forecast.lowPoint.balanceCents) } : null,
        confidence: { description: forecast.confidence.level, recordedHistoryDays: forecast.confidence.historyDays, clearlyClassifiedTransactionsPercent: Math.round(forecast.confidence.classifiedTransactions * 100) },
        assumptions: {
          receiptLikelihood: forecast.assumptions.collectionRates,
          bills: forecast.assumptions.bills,
          invoiceTiming: forecast.assumptions.paymentTiming,
          recentUnlinkedDailyNetCashActivity: displayMoney(forecast.assumptions.runRateCentsPerDay, true),
        },
        scheduledMovements: baseEvents,
      },
      outstandingInvoices: openInvoices.map((invoice) => ({
        source: sourceRef.get(`invoice:${invoice.id}`), invoice: invoice.number, customer: invoice.customer.name,
        due: invoice.dueDate, amountDue: displayMoney(invoice.balanceDue), status: invoice.displayStatus,
      })),
      unpaidBills: openBills.map((bill) => ({
        source: sourceRef.get(`bill:${String(bill._id)}`), supplier: bill.vendor, due: bill.dueDate,
        amountDue: displayMoney(bill.balanceDueCents ?? bill.amountCents), status: bill.status,
      })),
      recentRecordedActivity: transactionRecords.map((transaction) => ({
        source: sourceRef.get(`transaction:${String(transaction._id)}`), date: transaction.date,
        description: transaction.description || transaction.vendor || 'Recorded transaction',
        amount: displayMoney(transaction.amountCents, true), category: transaction.category,
      })),
    };
    const allowedIds = new Set(sourceRecords.map((record) => record.ref));
    const answer = await askGemini({ question, history: (thread?.messages || []).slice(-10), financialContext });
    const validated = validateGeminiAnswer(answer, allowedIds, formattedMoneyValues(financialContext));
    const citations = validated.citations.map((citation) => ({ ...citation, label: sourceByRef.get(citation.recordId).label }));
    const citedEvidence = citations.map((citation) => sourceByRef.get(citation.recordId)).filter(Boolean).map(({ id, label, amountCents, date }) => ({ id, label, amountCents, date }));
    const messages = [...(thread?.messages || []), { role: 'user', content: question }, { role: 'assistant', content: validated.answer }].slice(-12);
    const now = new Date();
    await C('geminiThreads').updateOne(scoped(req, { _id: threadId }), { $set: { messages, updatedAt: now }, $setOnInsert: { businessId: req.businessId, createdAt: now } }, { upsert: true });
    const response = { threadId: String(threadId), ...validated, citations, evidence: citedEvidence };
    const promptTokens = answer.usageMetadata?.promptTokenCount ?? null, outputTokens = answer.usageMetadata?.candidatesTokenCount ?? null;
    const inputRate = Number(process.env.GEMINI_INPUT_USD_PER_MILLION_TOKENS), outputRate = Number(process.env.GEMINI_OUTPUT_USD_PER_MILLION_TOKENS);
    const estimatedCostMicros = Number.isFinite(inputRate) && Number.isFinite(outputRate) && promptTokens !== null && outputTokens !== null ? Math.round(promptTokens * inputRate + outputTokens * outputRate) : null;
    await finalizeUsage(db, usageReservation, { entity: 'intelligence-response', requestId, promptTokens, outputTokens, totalTokens: answer.usageMetadata?.totalTokenCount ?? null, provider: 'gemini', estimatedCostMicros });
    await requests.updateOne({ _id: requestKey, businessId: req.businessId }, { $set: { status: 'complete', response, completedAt: new Date() } });
    res.json(response);
    } catch (error) {
      await releaseUsage(db, usageReservation);
      await requests.deleteOne({ _id: requestKey, businessId: req.businessId, status: 'pending' });
      throw error;
    }
  }));

  r.get('/insights', wrap(async (req, res) => {
    const { txns, invoices, bills, biz, now } = await loadAll(req);
    const list = A.insights({ txns, invoices, bills, today: now, currencyFmt: (c) => formatMoney(c, biz.currency) });
    const cashCtx = await horizonContext(req);
    const forecast = horizonForecast({ ...cashCtx, today: now, startingCash: cashCtx.cash.balance });
    if (forecast.lowPoint && forecast.lowPoint.balanceCents < (biz.minimumCashCents || 0)) list.unshift({ id: 'cash-shortage', kind: 'cash-shortage', severity: 'high', title: 'Projected cash falls below your reserve', detail: `Base-case cash reaches ${formatMoney(forecast.lowPoint.balanceCents, biz.currency)} on ${forecast.lowPoint.date}, below your ${formatMoney(biz.minimumCashCents || 0, biz.currency)} reserve. This is an estimate from saved records and assumptions.`, amountCents: forecast.lowPoint.balanceCents, evidence: [], evidenceType: 'transaction' });
    const ids = new Set(list.filter((i) => i.evidenceType === 'transaction').flatMap((i) => i.evidence));
    res.json({ insights: list, transactions: txns.filter((t) => ids.has(String(t._id))).map(pub), recurring: A.recurringCharges(txns, now) });
  }));

  r.get('/reports/pnl', wrap(async (req, res) => {
    const year = int(req.query.year ?? Number(req.today.slice(0, 4)), 'Year', { min: 1990, max: 2200 });
    const biz = await business(req);
    const txns = await C('transactions').find(scoped(req, { date: { $regex: `^${year}-` }, currency: { $in: [biz.currency, null] }, excludedFromTotals: { $ne: true } })).toArray();
    res.json(A.profitAndLoss(txns, year));
  }));
  r.get('/reports/coverage', wrap(async (req, res) => {
    const year = int(req.query.year ?? Number(req.today.slice(0, 4)), 'Year', { min: 1990, max: 2200 });
    const [accounts, imports] = await Promise.all([
      C('bankAccounts').find(scoped(req, { status: 'active' })).sort({ name: 1 }).toArray(),
      C('statementImports').find(scoped(req, { periodStart: { $lte: `${year}-12-31` }, periodEnd: { $gte: `${year}-01-01` } }), { projection: { sourceFile: 0 } }).toArray(),
    ]);
    const months = Array.from({ length: 12 }, (_, index) => {
      const month = `${year}-${String(index + 1).padStart(2, '0')}`;
      const start = `${month}-01`, end = new Date(Date.UTC(year, index + 1, 0)).toISOString().slice(0, 10);
      const byAccount = accounts.map((account) => {
        const ranges = imports.filter((item) => String(item.accountId) === String(account._id) && item.periodStart <= end && item.periodEnd >= start)
          .map((item) => [item.periodStart < start ? start : item.periodStart, item.periodEnd > end ? end : item.periodEnd]).sort((a, b) => a[0].localeCompare(b[0]));
        let coveredThrough = '';
        for (const [from, to] of ranges) {
          if (!coveredThrough && from > start) break;
          if (!coveredThrough && from <= start) coveredThrough = to;
          else if (coveredThrough && from <= addDays(coveredThrough, 1)) { if (to > coveredThrough) coveredThrough = to; }
          else if (coveredThrough) break;
          if (coveredThrough >= end) break;
        }
        const status = coveredThrough >= end ? 'complete' : ranges.length ? 'partial' : 'missing';
        return { accountId: String(account._id), accountName: account.name, currency: account.currency, status };
      });
      const complete = byAccount.length > 0 && byAccount.every((item) => item.status === 'complete');
      const partial = byAccount.some((item) => item.status !== 'missing');
      return { month, status: complete ? 'complete' : partial ? 'partial' : 'missing', accounts: byAccount };
    });
    const transactions = await C('transactions').countDocuments(scoped(req, { source: 'bank-statement', date: { $regex: `^${year}-` }, reconciliationStatus: { $ne: 'matched' } }));
    const discrepancies = imports.filter((item) => item.discrepancyCents !== null && item.discrepancyCents !== 0).length;
    res.json({ year, accounts: accounts.map((a) => ({ id: String(a._id), name: a.name, currency: a.currency })), months, unmatchedTransactions: transactions, statementDiscrepancies: discrepancies });
  }));
  r.get('/reports/pdf', wrap(async (req, res) => {
    const reservation = await reserveUsage(db, { businessId: req.businessId, planId: planFor(req), metric: 'pdfReports' });
    try {
    const year = int(req.query.year ?? Number(req.today.slice(0, 4)), 'Year', { min: 1990, max: 2200 });
    const { txns, invoices, bills, biz, now } = await loadAll(req);
    const pnl = A.profitAndLoss(txns.filter((t) => (t.currency || biz.currency) === biz.currency), year);
    const [cashContext, ctx] = await Promise.all([loadCashContext(req, biz, txns), horizonContext(req)]);
    const cash = cashContext.positionAt(now);
    const forecast = horizonForecast({ ...ctx, today: now, startingCash: cash.balance, days: plans[planFor(req)].limits.forecastDays });
    const report = financialReportPdf({
      business: biz, year, pnl, overview: { asOf: now, cashCents: cash.balance, cashAsOf: cash.asOf, forecastCommentary: forecast.lowPoint && forecast.lowPoint.balanceCents < (biz.minimumCashCents || 0) ? `The base-case estimate falls below the configured cash reserve on ${forecast.lowPoint.date}. Review the saved forecast assumptions.` : 'No reserve breach appears in the base-case estimate for this period.' },
      forecast, invoices, bills,
    });
    await finalizeUsage(db, reservation, { entity: 'financial-report-pdf', year });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="morgan-financial-report-${year}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(report);
    } catch (error) { await releaseUsage(db, reservation); throw error; }
  }));

  r.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  return r;
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500 && status !== 503) console.error(`[${req.method} ${req.originalUrl}]`, err);
  if (err.retryAfter) res.setHeader('Retry-After', String(err.retryAfter));
  res.status(status).json({ error: status >= 500 && status !== 502 && status !== 503 ? 'Something went wrong on our side' : err.message });
}
