import plans from '../../shared/plans.json' with { type: 'json' };
import { randomUUID } from 'node:crypto';
import { HttpError } from './validate.mjs';

export { plans };
const metricLimits = { financialRecords: 'financialRecords', intelligenceRequests: 'intelligenceRequests', pdfReports: 'pdfReports' };
const financialCollections = ['transactions', 'invoices', 'bills', 'planningItems'];
export const utcMonth = (date = new Date()) => date.toISOString().slice(0, 7);
export const nextUtcMonth = (month) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString();
export const accountPlan = (user) => plans[user?.planId] ? user.planId : 'starter';
const periodId = (businessId, month) => `${String(businessId)}:${month}`;

export async function recoverExpiredReservations(db, businessId, now = new Date()) {
  const month = utcMonth(now), id = periodId(businessId, month), periods = db.collection('usagePeriods');
  const beforeCleanup = await periods.findOne({ _id: id }, { projection: { reservations: 1 } });
  for (const expired of (beforeCleanup?.reservations || []).filter((item) => item.expiresAt <= now && item.metric === 'financialRecords')) {
    const counts = await Promise.all(financialCollections.map((name) => db.collection(name).countDocuments({ businessId, quotaReservationId: expired.id })));
    const persisted = counts.reduce((sum, count) => sum + count, 0);
    if (!persisted) continue;
    const recovered = { id, token: expired.id, businessId, month, metric: expired.metric, amount: persisted, planId: expired.planId };
    const renewed = await periods.updateOne({ _id: id, reservations: { $elemMatch: { id: expired.id, expiresAt: expired.expiresAt } } }, { $set: { 'reservations.$.amount': persisted, 'reservations.$.expiresAt': new Date(now.getTime() + 60_000) } });
    if (renewed.modifiedCount) await finalizeUsage(db, recovered, { entity: 'recovered-persisted-financial-records' });
  }
  await periods.updateOne({ _id: id }, [{ $set: { reservations: { $filter: { input: { $ifNull: ['$reservations', []] }, as: 'reservation', cond: { $gt: ['$$reservation.expiresAt', now] } } } } }]);
}

export async function reserveUsage(db, { businessId, planId = 'starter', metric, amount = 1, now = new Date() }) {
  const limitKey = metricLimits[metric];
  if (!limitKey || !Number.isSafeInteger(amount) || amount < 1) throw new Error('Invalid usage reservation');
  const plan = plans[planId] || plans.starter;
  const limit = plan.limits[limitKey];
  const month = utcMonth(now), id = periodId(businessId, month), token = randomUUID(), expiresAt = new Date(now.getTime() + 5 * 60_000);
  const periods = db.collection('usagePeriods');
  try { await periods.updateOne({ _id: id }, { $setOnInsert: { businessId, month, planId, createdAt: now, counters: { financialRecords: 0, intelligenceRequests: 0, pdfReports: 0 }, reservations: [] } }, { upsert: true }); }
  catch (error) { if (error.code !== 11000) throw error; }
  await recoverExpiredReservations(db, businessId, now);
  const reserved = { id: token, metric, amount, expiresAt };
  const totalReserved = { $sum: { $map: { input: { $filter: { input: { $ifNull: ['$reservations', []] }, as: 'reservation', cond: { $eq: ['$$reservation.metric', metric] } } }, as: 'reservation', in: '$$reservation.amount' } } };
  const result = await periods.updateOne({ _id: id, $expr: { $lt: [{ $add: [{ $ifNull: [`$counters.${metric}`, 0] }, totalReserved] }, limit] } }, { $push: { reservations: reserved }, $set: { planId, updatedAt: now } });
  if (!result.modifiedCount) throw new HttpError(429, `${metric === 'financialRecords' ? 'Financial record' : metric === 'intelligenceRequests' ? 'Morgan Intelligence' : 'PDF report'} monthly limit reached for ${plan.name}. Your allowance resets ${nextUtcMonth(month)}.`);
  return { id, token, businessId, month, metric, amount, planId, expiresAt };
}

export async function finalizeUsage(db, reservation, details = {}) {
  const now = new Date();
  const event = { id: reservation.token, metric: reservation.metric, amount: reservation.amount, planId: reservation.planId, createdAt: now, ...details };
  const result = await db.collection('usagePeriods').updateOne({ _id: reservation.id, 'reservations.id': reservation.token }, { $pull: { reservations: { id: reservation.token } }, $inc: { [`counters.${reservation.metric}`]: reservation.amount }, $push: { events: event }, $set: { updatedAt: now } });
  if (!result.modifiedCount) throw new Error('Usage reservation expired before completion');
  try { await db.collection('usageEvents').updateOne({ _id: reservation.token }, { $setOnInsert: { businessId: reservation.businessId, month: reservation.month, ...event } }, { upsert: true }); }
  catch (error) { console.error('[usage event index]', error); }
}
export async function releaseUsage(db, reservation) {
  if (reservation) await db.collection('usagePeriods').updateOne({ _id: reservation.id, 'reservations.id': reservation.token }, { $pull: { reservations: { id: reservation.token } }, $set: { updatedAt: new Date() } });
}
export async function usageSummary(db, businessId, planId = 'starter', now = new Date()) {
  const month = utcMonth(now), plan = plans[planId] || plans.starter;
  await recoverExpiredReservations(db, businessId, now);
  const period = await db.collection('usagePeriods').findOne({ _id: periodId(businessId, month) });
  const savedScenarios = await db.collection('horizonScenarios').countDocuments({ businessId });
  const counters = period?.counters || {};
  const usage = Object.fromEntries(['financialRecords', 'intelligenceRequests', 'pdfReports'].map((metric) => [metric, { used: counters[metric] || 0, limit: plan.limits[metric], remaining: Math.max(0, plan.limits[metric] - (counters[metric] || 0)) }]));
  return { plan, period: { month, resetsAt: nextUtcMonth(month), timezone: 'UTC' }, usage, capabilities: { workspaces: { used: 1, limit: plan.limits.workspaces }, seats: { used: 1, limit: plan.limits.seats }, scenariosPerWorkspace: { used: savedScenarios, limit: plan.limits.scenariosPerWorkspace }, forecastDays: plan.limits.forecastDays, monitor: plan.monitor }, paymentConfigured: false, subscriptionStatus: 'free' };
}
