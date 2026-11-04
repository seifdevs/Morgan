import { MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';
const usBankDirectory = JSON.parse(readFileSync(new URL('./data/us-banks.json', import.meta.url), 'utf8'));

export async function connectDb(uri, dbName) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, appName: 'morgan' });
  await client.connect();
  const db = client.db(dbName);
  await Promise.all([
    db.collection('bankDirectory').createIndex({ country: 1, id: 1 }, { unique: true }),
    db.collection('bankDirectory').createIndex({ country: 1, name: 1 }),
    db.collection('users').createIndex({ email: 1 }, { unique: true }),
    db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('resetTokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('verificationTokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('emailEvents').createIndex({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }),
    db.collection('sessions').createIndex({ userId: 1 }),
    db.collection('transactions').createIndex({ businessId: 1, date: -1 }),
    db.collection('transactions').createIndex({ businessId: 1, createdAt: 1 }),
    db.collection('transactions').createIndex({ businessId: 1, invoiceId: 1 }),
    db.collection('bankAccounts').createIndex({ businessId: 1, status: 1, name: 1 }),
    db.collection('statementImports').createIndex({ businessId: 1, accountId: 1, importedAt: -1 }),
    db.collection('transactions').createIndex({ businessId: 1, accountId: 1, fingerprint: 1 }, { unique: true, partialFilterExpression: { fingerprint: { $type: 'string' } } }),
    db.collection('invoices').createIndex({ businessId: 1, number: 1 }, { unique: true }),
    db.collection('invoices').createIndex({ businessId: 1, createdAt: 1 }),
    db.collection('customers').createIndex({ businessId: 1, name: 1 }),
    db.collection('bills').createIndex({ businessId: 1, dueDate: 1 }),
    db.collection('bills').createIndex({ businessId: 1, createdAt: 1 }),
    db.collection('planningItems').createIndex({ businessId: 1, nextDate: 1 }),
    db.collection('planningItems').createIndex({ businessId: 1, createdAt: 1 }),
    db.collection('financialAudit').createIndex({ businessId: 1, createdAt: -1 }),
    db.collection('horizonScenarios').createIndex({ businessId: 1, updatedAt: -1 }),
    db.collection('geminiThreads').createIndex({ businessId: 1, updatedAt: -1 }),
    db.collection('usagePeriods').createIndex({ businessId: 1, month: 1 }, { unique: true }),
    db.collection('usageEvents').createIndex({ businessId: 1, month: 1, createdAt: -1 }),
    db.collection('planPayments').createIndex({ userId: 1, createdAt: -1 }),
    db.collection('planPayments').createIndex({ transactionId: 1 }, { unique: true, partialFilterExpression: { transactionId: { $type: 'string' } } }),
    db.collection('planPayments').createIndex({ transactionIdNormalized: 1 }, { unique: true, partialFilterExpression: { transactionIdNormalized: { $type: 'string' } } }),
    db.collection('paypalPaymentIdentifiers').createIndex({ paymentId: 1 }, { unique: true }),
    db.collection('paypalPaymentIdentifiers').createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { purgeAt: { $type: 'date' } } }),
    db.collection('planPayments').createIndex({ status: 1, createdAt: -1 }),
    db.collection('planPayments').createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { purgeAt: { $type: 'date' } } }),
    db.collection('policyAcceptances').createIndex({ userId: 1, acceptedAt: -1 }),
    db.collection('policyAcceptances').createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { purgeAt: { $type: 'date' } } }),
    db.collection('adminAudit').createIndex({ createdAt: -1 }),
    db.collection('adminAudit').createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { purgeAt: { $type: 'date' } } }),
  ]);
  // Ensure an idempotent baseline exists for each legacy account this UTC month.
  // New accounts create their period through the reservation path.
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const month = monthStart.toISOString().slice(0, 7);
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  const businesses = await db.collection('businesses').find({}, { projection: { _id: 1 } }).toArray();
  const periodIds = businesses.map(({ _id }) => `${String(_id)}:${month}`);
  const existingPeriods = new Set((await db.collection('usagePeriods').find({ _id: { $in: periodIds } }, { projection: { _id: 1 } }).toArray()).map(({ _id }) => String(_id)));
  const missingBusinesses = businesses.filter(({ _id }) => !existingPeriods.has(`${String(_id)}:${month}`));
  const baselineByBusiness = new Map(missingBusinesses.map(({ _id }) => [String(_id), { financialRecords: 0, intelligenceRequests: 0, pdfReports: 0 }]));
  const financialCollections = ['transactions', 'invoices', 'bills', 'planningItems'];
  const aggregates = missingBusinesses.length ? await Promise.all(financialCollections.map((name) => db.collection(name).aggregate([
    { $match: { businessId: { $in: missingBusinesses.map((business) => business._id) }, createdAt: { $gte: monthStart, $lt: monthEnd }, simulated: { $ne: true } } },
    { $group: { _id: '$businessId', count: { $sum: 1 } } },
  ]).toArray())) : [];
  for (const rows of aggregates) for (const row of rows) { const baseline = baselineByBusiness.get(String(row._id)); if (baseline) baseline.financialRecords += row.count; }
  const baselines = [...baselineByBusiness.entries()].map(([businessId, counters]) => ({ businessId: missingBusinesses.find((b) => String(b._id) === businessId)._id, counters }));
  if (baselines.length) {
    const now = new Date();
    const writeInsertOnly = async (collection, operations) => {
      try { await collection.bulkWrite(operations, { ordered: false }); }
      catch (error) { if (error.code !== 11000 && (!error.writeErrors?.length || error.writeErrors.some((item) => item.code !== 11000))) throw error; }
    };
    await Promise.all([
      writeInsertOnly(db.collection('usagePeriods'), baselines.map(({ businessId, counters }) => ({ updateOne: { filter: { _id: `${String(businessId)}:${month}` }, update: { $setOnInsert: { businessId, month, planId: 'starter', createdAt: now, counters, reservations: [], baselineImportedAt: now } }, upsert: true } }))),
      writeInsertOnly(db.collection('usageEvents'), baselines.map(({ businessId, counters }) => ({ updateOne: { filter: { _id: `${String(businessId)}:${month}:baseline` }, update: { $setOnInsert: { businessId, month, entity: 'pre-entitlement-baseline', financialRecords: counters.financialRecords, intelligenceRequests: 0, pdfReports: 0, createdAt: now } }, upsert: true } }))),
    ]);
  }
  // Versioned official directory snapshot. Directory refreshes are explicit data migrations.
  const bankRows = usBankDirectory.banks.map((bank) => ({ ...bank, country: 'US', currency: 'USD', sourceName: usBankDirectory.sourceName, source: usBankDirectory.source, sourceUpdatedAt: new Date(usBankDirectory.updatedAt) }));
  if (bankRows.length) await db.collection('bankDirectory').deleteMany({ country: 'US', id: { $nin: bankRows.map((bank) => bank.id) } });
  if (bankRows.length) await db.collection('bankDirectory').bulkWrite(bankRows.map((bank) => ({ updateOne: { filter: { country: bank.country, id: bank.id }, update: { $set: bank }, upsert: true } })), { ordered: false });
  return { client, db };
}
