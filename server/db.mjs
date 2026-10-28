import { MongoClient } from 'mongodb';

export async function connectDb(uri, dbName) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, appName: 'morgan' });
  await client.connect();
  const db = client.db(dbName);
  await Promise.all([
    db.collection('users').createIndex({ email: 1 }, { unique: true }),
    db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('resetTokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('verificationTokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('emailEvents').createIndex({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }),
    db.collection('sessions').createIndex({ userId: 1 }),
    db.collection('transactions').createIndex({ businessId: 1, date: -1 }),
    db.collection('transactions').createIndex({ businessId: 1, invoiceId: 1 }),
    db.collection('bankAccounts').createIndex({ businessId: 1, status: 1, name: 1 }),
    db.collection('statementImports').createIndex({ businessId: 1, accountId: 1, importedAt: -1 }),
    db.collection('transactions').createIndex({ businessId: 1, accountId: 1, fingerprint: 1 }, { unique: true, partialFilterExpression: { fingerprint: { $type: 'string' } } }),
    db.collection('invoices').createIndex({ businessId: 1, number: 1 }, { unique: true }),
    db.collection('customers').createIndex({ businessId: 1, name: 1 }),
    db.collection('bills').createIndex({ businessId: 1, dueDate: 1 }),
    db.collection('planningItems').createIndex({ businessId: 1, nextDate: 1 }),
    db.collection('financialAudit').createIndex({ businessId: 1, createdAt: -1 }),
  ]);
  return { client, db };
}
