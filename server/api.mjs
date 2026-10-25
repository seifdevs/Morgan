import express from 'express';
import { ObjectId } from 'mongodb';
import { randomBytes, createHash } from 'node:crypto';
import { invoiceTotals, formatMoney } from '../shared/money.js';
import {
  HttpError, bad, str, email, date, cents, int, oneOf, oid, today, addDays, escapeRegex,
} from './lib/validate.mjs';
import {
  hashPassword, verifyPassword, DUMMY_HASH, createSession, sessionCookie, validatePassword,
  loadSession, requireAuth, rateLimit, hashToken,
} from './lib/auth.mjs';
import { invoicePdf } from './lib/pdf.mjs';
import { mailConfigured, sendMail } from './lib/mail.mjs';
import * as A from './lib/analytics.mjs';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'EGP', 'AED', 'SAR', 'CHF', 'JPY'];
const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'void'];
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const publicUser = (u) => ({ id: String(u._id), name: u.name, email: u.email, createdAt: u.createdAt });
const publicBusiness = (b) => ({
  id: String(b._id), name: b.name, currency: b.currency, address: b.address || '', email: b.email || '',
  invoicePrefix: b.invoicePrefix, defaultTaxRateBps: b.defaultTaxRateBps || 0, paymentTermsDays: b.paymentTermsDays ?? 14,
  openingBalanceCents: b.openingBalanceCents || 0, openingBalanceDate: b.openingBalanceDate || null, timezone: b.timezone || 'UTC',
  financialSetupComplete: b.financialSetupComplete ?? true, industry: b.industry || '', monthlyBudgetCents: b.monthlyBudgetCents ?? null, minimumCashCents: b.minimumCashCents ?? null,
  cashAccounts: (b.cashAccounts || []).map(({ _id, ...a }) => ({ id: String(_id), ...a })),
});
const pub = ({ _id, businessId, ...rest }) => ({ id: String(_id), ...rest });

export function decorateInvoice(inv, now = today()) {
  const totals = invoiceTotals(inv);
  const amountPaid = (inv.payments || []).reduce((s, p) => s + p.amountCents, 0);
  const balanceDue = totals.total - amountPaid;
  let displayStatus = inv.status;
  if (inv.status === 'sent') displayStatus = amountPaid > 0 ? 'partial' : 'sent';
  if (inv.status === 'sent' && inv.dueDate < now) displayStatus = 'overdue';
  const { _id, businessId, ...rest } = inv;
  return {
    id: String(_id), ...rest, totals, amountPaid, balanceDue, displayStatus,
    payments: (inv.payments || []).map((p) => ({ ...p, id: String(p.id), transactionId: p.transactionId ? String(p.transactionId) : null })),
    customerId: inv.customerId ? String(inv.customerId) : null,
  };
}

export function decorateBill(bill) {
  const { _id, businessId, ...rest } = bill;
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
  r.use('/bank-statements/import', express.json({ limit: '17mb' }));
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

  /* ---------------- Auth ---------------- */
  r.post('/auth/register', rateLimit({ key: 'register', limit: 5, windowMs: 3600e3 }), wrap(async (req, res) => {
    const b = req.body || {};
    const name = str(b.name, 'Name', { required: true, max: 100 });
    const mail = email(b.email);
    const password = validatePassword(b.password);
    const businessName = str(b.businessName, 'Business name', { required: true, max: 120 });
    const currency = oneOf(b.currency || 'USD', 'Currency', CURRENCIES);
    const timezone = validTz(b.timezone) ? b.timezone : 'UTC';
    if (await C('users').findOne({ email: mail })) throw new HttpError(409, 'An account with this email already exists');
    const businessId = new ObjectId();
    const user = { _id: new ObjectId(), name, email: mail, passwordHash: await hashPassword(password), businessId, createdAt: new Date() };
    await C('businesses').insertOne({
      _id: businessId, name: businessName, currency, timezone, invoicePrefix: 'INV-', invoiceSeq: 0, defaultTaxRateBps: 0,
      paymentTermsDays: 14, openingBalanceCents: 0, openingBalanceDate: null, financialSetupComplete: false, monthlyBudgetCents: null, minimumCashCents: null, ownerId: user._id, createdAt: new Date(),
    });
    try {
      await C('users').insertOne(user);
    } catch (e) {
      await C('businesses').deleteOne({ _id: businessId });
      if (e.code === 11000) throw new HttpError(409, 'An account with this email already exists');
      throw e;
    }
    setCookie(res, await createSession(db, user, req));
    res.status(201).json({ user: publicUser(user), business: publicBusiness(await business({ businessId })) });
  }));

  r.post('/auth/login', rateLimit({ key: 'login-ip', limit: 30, windowMs: 15 * 60e3, failuresOnly: true }), rateLimit({ key: 'login', limit: 8, windowMs: 15 * 60e3, byEmail: true, failuresOnly: true }), wrap(async (req, res) => {
    const mail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' && req.body.password.length <= 200 ? req.body.password : '';
    const user = mail ? await C('users').findOne({ email: mail }) : null;
    const ok = await verifyPassword(password, user?.passwordHash || DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, 'Email or password is incorrect');
    setCookie(res, await createSession(db, user, req));
    res.json({ user: publicUser(user), business: publicBusiness(await business({ businessId: user.businessId })) });
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
  const resetAvailable = () => mailConfigured() && Boolean(process.env.APP_URL);
  r.post('/auth/forgot', rateLimit({ key: 'forgot', limit: 5, windowMs: 3600e3 }), wrap(async (req, res) => {
    if (!resetAvailable()) throw new HttpError(503, 'Password reset by email is not available on this server.');
    const mail = email(req.body?.email);
    const user = await C('users').findOne({ email: mail });
    if (user) {
      const token = randomBytes(32).toString('base64url');
      await C('resetTokens').deleteMany({ userId: user._id });
      await C('resetTokens').insertOne({ _id: hashToken(token), userId: user._id, expiresAt: new Date(Date.now() + 30 * 60e3) });
      const link = `${process.env.APP_URL.replace(/\/$/, '')}/reset-password?token=${token}`;
      await sendMail({ to: user.email, subject: 'Reset your Morgan password', text: `Someone asked to reset the password for this Morgan account.\n\nReset it here (valid for 30 minutes, single use):\n${link}\n\nIf this wasn't you, ignore this email — your password stays the same.` });
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
    res.json({ ok: true });
  }));

  // Everything below requires a session. "Today" is the business's local date, not the server's.
  r.use(requireAuth);
  r.use(wrap(async (req, _res, next) => {
    const b = await C('businesses').findOne({ _id: req.businessId }, { projection: { timezone: 1 } });
    req.today = todayIn(b?.timezone);
    next();
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
    res.json({ user: publicUser({ ...req.user, ...set }) });
  }));

  r.post('/account/password', rateLimit({ key: 'password', limit: 10, windowMs: 3600e3 }), wrap(async (req, res) => {
    if (!(await verifyPassword(String(req.body?.currentPassword || ''), req.user.passwordHash))) throw new HttpError(401, 'Current password is incorrect');
    const pw = validatePassword(req.body?.newPassword);
    await C('users').updateOne({ _id: req.user._id }, { $set: { passwordHash: await hashPassword(pw) } });
    // Invalidate every other session after a password change.
    const { deletedCount } = await C('sessions').deleteMany({ userId: req.user._id, _id: { $ne: req.sessionId } });
    res.json({ ok: true, signedOut: deletedCount });
  }));

  r.get('/account/sessions', wrap(async (req, res) => {
    const list = await C('sessions').find({ userId: req.user._id, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).toArray();
    res.json(list.map((s) => ({ current: s._id === req.sessionId, createdAt: s.createdAt, userAgent: s.userAgent })));
  }));

  r.post('/account/sessions/revoke-others', wrap(async (req, res) => {
    const { deletedCount } = await C('sessions').deleteMany({ userId: req.user._id, _id: { $ne: req.sessionId } });
    res.json({ ok: true, signedOut: deletedCount });
  }));

  r.delete('/account', rateLimit({ key: 'delete-account', limit: 5, windowMs: 3600e3, failuresOnly: true }), wrap(async (req, res) => {
    if (!(await verifyPassword(String(req.body?.password || ''), req.user.passwordHash))) throw new HttpError(401, 'Password is incorrect');
    const q = { businessId: req.businessId };
    await Promise.all(['transactions', 'invoices', 'customers', 'bills', 'planningItems', 'bankAccounts', 'statementImports', 'financialAudit'].map((c) => C(c).deleteMany(q)));
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
    if (b.complete === true) set.financialSetupComplete = true;
    await C('businesses').updateOne({ _id: req.businessId }, { $set: set });
    res.json({ business: publicBusiness(await business(req)) });
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
    const { insertedId } = await C('planningItems').insertOne(doc);
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
    const { insertedId } = await C('transactions').insertOne(doc);
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
    await C('transactions').insertMany(docs);
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
    const rows = statementRows(req, account);
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
    res.json(await getStatementReview(req, account));
  }));
  r.post('/bank-statements/import', wrap(async (req, res) => {
    const account = await findStatementAccount(req), review = await getStatementReview(req, account);
    const importId = new ObjectId(), importedAt = new Date();
    const filename = str(req.body.filename || 'Statement.csv', 'Filename', { required: true, max: 180 });
    const fileType = oneOf(filename.split('.').at(-1)?.toLowerCase(), 'File type', ['csv', 'xlsx', 'pdf']);
    const encodedFile = req.body.sourceFileBase64;
    let sourceFile = null, sourceFileSha256 = null;
    if (typeof encodedFile !== 'string' || !encodedFile.length) throw bad('The original statement file is required to complete the import.');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedFile)) throw bad('The statement file could not be read. Choose it again and retry.');
    sourceFile = Buffer.from(encodedFile, 'base64');
    if (!sourceFile.length || sourceFile.length > 10 * 1024 * 1024) throw bad('Statement files must be 10 MB or smaller.');
    const isPdf = sourceFile.subarray(0, 1024).includes(Buffer.from('%PDF-'));
    const isXlsx = sourceFile.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const isCsv = !sourceFile.includes(0) && !sourceFile.subarray(0, 1024).includes(Buffer.from('%PDF-'));
    if ((fileType === 'pdf' && !isPdf) || (fileType === 'xlsx' && !isXlsx) || (fileType === 'csv' && !isCsv)) throw bad('The file contents do not match the selected file type.');
    sourceFileSha256 = createHash('sha256').update(sourceFile).digest('hex');
    const rows = review.rows.filter((r) => !r.duplicate && req.body.rows.find((input) => input.date === r.date && Number(input.amountCents) === r.amountCents && input.description === r.description && input.include !== false));
    const docs = rows.map((row) => ({ businessId: req.businessId, accountId: account._id, date: row.date, description: row.description, vendor: row.vendor, category: row.category, financialClass: row.financialClass, amountCents: row.amountCents, currency: row.currency, reference: row.reference, runningBalanceCents: row.runningBalanceCents, sourceRowNumber: row.sourceRowNumber, source: 'bank-statement', importId, fingerprint: row.fingerprint, reconciliationStatus: 'unmatched', createdAt: importedAt, updatedAt: importedAt }));
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
      if (!transactionalImport) {
        await C('transactions').deleteMany(scoped(req, { importId }));
        await C('statementImports').deleteOne(scoped(req, { _id: importId }));
      }
      if (e.code === 11000) throw new HttpError(409, 'These transactions were imported in another session. Refresh the preview before retrying.');
      throw e;
    } finally { await session?.endSession(); }
    res.status(201).json({ importId: String(importId), imported: docs.length, duplicates: review.summary.duplicates, matchedSuggestions: review.rows.filter((r) => r.suggestedMatch).length, summary: review.summary });
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
    // A prefix change can make a new number collide with an old one; skip ahead until it's free.
    for (let attempt = 0; attempt < 20; attempt++) {
      const biz = await C('businesses').findOneAndUpdate({ _id: req.businessId }, { $inc: { invoiceSeq: 1 } }, { returnDocument: 'after' });
      const doc = {
        ...fields, businessId: req.businessId, number: `${biz.invoicePrefix}${String(biz.invoiceSeq).padStart(4, '0')}`,
        status: 'draft', payments: [], createdAt: new Date(), updatedAt: new Date(),
      };
      try {
        const { insertedId } = await C('invoices').insertOne(doc);
        return res.status(201).json(dec(req, { _id: insertedId, ...doc }));
      } catch (e) { if (e.code !== 11000) throw e; }
    }
    throw new HttpError(409, 'Could not allocate an invoice number. Change the invoice prefix in Settings.');
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
    await sendMail({
      to, replyTo: biz.email || undefined,
      subject: `Invoice ${inv.number} from ${biz.name}`,
      text: `${message ? message + '\n\n' : ''}Invoice ${inv.number}\nAmount due: ${formatMoney(d.balanceDue, biz.currency)}\nDue date: ${inv.dueDate}\n\nThe invoice is attached as a PDF.\n\n${biz.name}`,
      attachments: [{ filename: `${inv.number}.pdf`, content: invoicePdf(d, biz) }],
    });
    const set = { sentAt: new Date(), sentVia: 'email', sentTo: to, ...(inv.status === 'draft' && { status: 'sent' }) };
    await C('invoices').updateOne({ _id: inv._id, businessId: req.businessId }, { $set: set });
    res.json(dec(req, { ...inv, ...set }));
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
    const { insertedId } = await C('transactions').insertOne(txn);
    const payment = { id: paymentId, amountCents, date: payDate, method, transactionId: insertedId };
    const fullyPaid = amountCents === d.balanceDue;
    // Guard against concurrent payments: only apply if payments array is unchanged.
    const { modifiedCount } = await C('invoices').updateOne(
      { _id: inv._id, businessId: req.businessId, status: 'sent', payments: inv.payments || [] },
      { $push: { payments: payment }, $set: { ...(fullyPaid && { status: 'paid', paidAt: new Date() }) } },
    );
    if (!modifiedCount) { await C('transactions').deleteOne({ _id: insertedId }); throw new HttpError(409, 'The invoice changed. Refresh and try again.'); }
    res.status(201).json(dec(req, { ...inv, payments: [...(inv.payments || []), payment], ...(fullyPaid && { status: 'paid' }) }));
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
    const { insertedId } = await C('bills').insertOne(doc);
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
    const { insertedId } = await C('transactions').insertOne({
      businessId: req.businessId, date: paidDate, description: bill.description || `Bill · ${bill.vendor}`, vendor: bill.vendor,
      category: bill.category, financialClass: 'expense', amountCents: -amountCents, notes: '', billId: _id, paymentId, source: 'bill-payment', createdAt: new Date(),
    });
    const payment = { id: paymentId, amountCents, date: paidDate, method: 'Manual', transactionId: insertedId };
    const { modifiedCount } = await C('bills').updateOne(scoped(req, { _id, status: bill.status, payments }), { $push: { payments: payment }, $set: { status: nextStatus, ...(nextStatus === 'paid' && { paidDate }), transactionId: insertedId } });
    if (!modifiedCount) { await C('transactions').deleteOne({ _id: insertedId }); throw new HttpError(409, 'The bill changed. Refresh and try again.'); }
    res.json(decorateBill({ ...bill, status: nextStatus, payments: [...payments, payment], ...(nextStatus === 'paid' && { paidDate }), transactionId: insertedId }));
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
      if (sources.length) {
        const parts = sources.map(({ account, records, statements }) => {
          const calculation = calculateAccountBalance(account, records, statements, asOf);
          return { account, balance: calculation.balance, asOf: calculation.balanceAsOf, source: calculation.balanceSource };
        });
        const missingAccounts = parts.filter((part) => part.balance === null).map((part) => part.account.name);
        const knownParts = parts.filter((part) => part.balance !== null);
        const knownBalance = knownParts.length ? knownParts.reduce((sum, part) => sum + part.balance, 0) : null;
        const complete = missingAccounts.length === 0;
        const sourceKinds = [...new Set(parts.map((part) => part.source).filter(Boolean))];
        const asOfDate = complete ? parts.reduce((oldest, part) => part.asOf < oldest ? part.asOf : oldest, asOf) : null;
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
    const plan = A.cashflow({ txns, invoices: [], bills, plannedItems, business: biz, today: now, startingCash: currentCash.balance });
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
        forecast: { days7: balanceAt(1), days30: balanceAt(5), days90: balanceAt(13) },
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
    res.json({ ...A.cashflow({ txns, invoices, bills, plannedItems, business: biz, today: now, startingCash: currentCash.balance }), cashSource: currentCash.source, cashAsOf: currentCash.asOf, cashMissingAccounts: currentCash.missingAccounts });
  }));

  r.get('/insights', wrap(async (req, res) => {
    const { txns, invoices, bills, biz, now } = await loadAll(req);
    const list = A.insights({ txns, invoices, bills, today: now, currencyFmt: (c) => formatMoney(c, biz.currency) });
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

  r.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  return r;
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500 && status !== 503) console.error(`[${req.method} ${req.originalUrl}]`, err);
  if (err.retryAfter) res.setHeader('Retry-After', String(err.retryAfter));
  res.status(status).json({ error: status >= 500 && status !== 502 && status !== 503 ? 'Something went wrong on our side' : err.message });
}
