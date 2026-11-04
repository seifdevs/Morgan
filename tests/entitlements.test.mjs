import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDb } from '../server/db.mjs';
import { accountPlan, nextUtcMonth, plans, reserveUsage, utcMonth, usageSummary } from '../server/lib/entitlements.mjs';

test('UTC month periods advance at calendar boundaries', () => {
  assert.equal(utcMonth(new Date('2026-11-30T23:59:59.999Z')), '2026-11');
  assert.equal(utcMonth(new Date('2026-12-01T00:00:00.000Z')), '2026-12');
  assert.equal(nextUtcMonth('2026-11'), '2026-12-01T00:00:00.000Z');
  assert.equal(nextUtcMonth('2026-12'), '2027-01-01T00:00:00.000Z');
});

test('plan identity defaults to Starter and ignores unknown or client supplied values', () => {
  assert.equal(accountPlan({}), 'starter');
  assert.equal(accountPlan({ planId: 'unknown', limits: { financialRecords: 999999 } }), 'starter');
  assert.equal(accountPlan({ planId: 'max' }), 'max');
});

test('published prices and all plan entitlement values match the approved schedule', () => {
  assert.deepEqual(Object.fromEntries(Object.values(plans).map((plan) => [plan.id, [plan.monthlyCents, plan.annualCents]])), { starter: [0, 0], pro: [4999, 49900], max: [19999, 149900] });
  assert.deepEqual(Object.fromEntries(Object.values(plans).map((plan) => [plan.id, plan.limits])), {
    starter: { workspaces: 1, seats: 1, financialRecords: 250, forecastDays: 30, scenariosPerWorkspace: 1, intelligenceRequests: 10, pdfReports: 2 },
    pro: { workspaces: 1, seats: 3, financialRecords: 3000, forecastDays: 90, scenariosPerWorkspace: 10, intelligenceRequests: 150, pdfReports: 20 },
    max: { workspaces: 5, seats: 10, financialRecords: 20000, forecastDays: 90, scenariosPerWorkspace: 50, intelligenceRequests: 600, pdfReports: 100 },
  });
});

test('atomic reservations admit exactly the remaining concurrent monthly quota', async () => {
  const mongod = await MongoMemoryServer.create();
  const { client, db } = await connectDb(mongod.getUri(), 'entitlements_test');
  try {
    const businessId = 'business-test', now = new Date('2026-11-04T12:00:00Z');
    const id = `${businessId}:2026-11`;
    await db.collection('usagePeriods').insertOne({ _id: id, businessId, month: '2026-11', planId: 'starter', counters: { financialRecords: 249, intelligenceRequests: 0, pdfReports: 0 }, reservations: [] });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => reserveUsage(db, { businessId, metric: 'financialRecords', now })));
    const accepted = results.filter((result) => result.status === 'fulfilled');
    assert.equal(accepted.length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 7);
    assert.equal((await db.collection('usagePeriods').findOne({ _id: id })).reservations.length, 1);
  } finally {
    await client.close(); await mongod.stop();
  }
});

test('Pro and Max monthly quota reservations enforce every advertised usage limit', async () => {
  const mongod = await MongoMemoryServer.create();
  const { client, db } = await connectDb(mongod.getUri(), 'entitlements_plans_test');
  try {
    for (const planId of ['pro', 'max']) for (const metric of ['financialRecords', 'intelligenceRequests', 'pdfReports']) {
      const businessId = `${planId}-${metric}`, month = '2026-11', limit = plans[planId].limits[metric], id = `${businessId}:${month}`;
      await db.collection('usagePeriods').insertOne({ _id: id, businessId, month, planId, counters: { financialRecords: 0, intelligenceRequests: 0, pdfReports: 0, [metric]: limit - 1 }, reservations: [] });
      assert.ok(await reserveUsage(db, { businessId, planId, metric, now: new Date('2026-11-04T12:00:00Z') }), `${planId} ${metric} admits the final allowed unit`);
      await assert.rejects(reserveUsage(db, { businessId, planId, metric, now: new Date('2026-11-04T12:00:00Z') }), { status: 429 }, `${planId} ${metric} rejects one unit above its limit`);
    }
  } finally {
    await client.close(); await mongod.stop();
  }
});

test('a persisted record is reconciled into usage if the process exits before finalizing its reservation', async () => {
  const mongod = await MongoMemoryServer.create();
  const { client, db } = await connectDb(mongod.getUri(), 'entitlements_recovery_test');
  try {
    const businessId = 'recovery-business', now = new Date('2026-11-04T12:00:00Z');
    const reservation = await reserveUsage(db, { businessId, metric: 'financialRecords', now });
    await db.collection('transactions').insertOne({ businessId, quotaReservationId: reservation.token, createdAt: now, description: 'saved before interruption' });
    await db.collection('usagePeriods').updateOne({ _id: reservation.id }, { $set: { 'reservations.$[reservation].expiresAt': new Date(now.getTime() - 1) } }, { arrayFilters: [{ 'reservation.id': reservation.token }] });
    const summary = await usageSummary(db, businessId, 'starter', now);
    assert.equal(summary.usage.financialRecords.used, 1);
    assert.equal((await db.collection('usagePeriods').findOne({ _id: reservation.id })).reservations.length, 0);
    assert.equal(await db.collection('usageEvents').countDocuments({ _id: reservation.token }), 1);
  } finally {
    await client.close(); await mongod.stop();
  }
});
