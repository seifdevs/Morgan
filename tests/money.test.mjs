import test from 'node:test';
import assert from 'node:assert/strict';
import { toCents, lineTotalCents, invoiceTotals, centsToInput } from '../shared/money.js';

test('toCents parses safely', () => {
  assert.equal(toCents('1,234.56'), 123456);
  assert.equal(toCents('0.1'), 10);
  assert.equal(toCents(0.1 + 0.2 > 0.3 ? '0.30' : 'x'), 30);
  assert.equal(toCents('-12.5'), -1250);
  assert.equal(toCents('$19.99'), 1999);
  assert.equal(toCents('1.234'), null);
  assert.equal(toCents('abc'), null);
  assert.equal(toCents(''), null);
});

test('invoice math is exact in cents', () => {
  assert.equal(lineTotalCents(3, 3333), 9999);
  assert.equal(lineTotalCents(1.5, 1999), 2999); // 2998.5 -> 2999
  assert.equal(lineTotalCents(0.333, 100), 33);
  const t = invoiceTotals({ items: [{ quantity: 2, unitCents: 1005 }, { quantity: 1, unitCents: 1 }], taxRateBps: 825, discountCents: 11 });
  assert.deepEqual(t, { subtotal: 2011, discount: 11, tax: 165, total: 2165 });
  assert.equal(invoiceTotals({ items: [{ quantity: 1, unitCents: 100 }], discountCents: 500 }).total, 0);
  assert.equal(centsToInput(-5), '-0.05');
});
