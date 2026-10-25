// Monetary values are integer minor units (cents). Never do money math on floats.

/** Parse "1,234.56" / 1234.56 into integer cents. Returns null when invalid or >2 decimals. */
export function toCents(input) {
  if (typeof input === 'number') input = String(input);
  if (typeof input !== 'string') return null;
  const s = input.trim().replace(/[,\s]/g, '').replace(/^\$/, '');
  const m = /^(-)?(\d{1,13})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] || '').padEnd(2, '0'));
  return m[1] && cents ? -cents : cents;
}

/** Quantity is limited to 3 decimals; line total rounds half away from zero to the cent. */
export function lineTotalCents(quantity, unitCents) {
  const milli = Math.round(Number(quantity) * 1000);
  return roundDiv(milli * unitCents, 1000);
}

function roundDiv(n, d) {
  const q = Math.abs(n) / d;
  const r = Math.floor(q + 0.5 + 1e-9);
  return n < 0 ? -r : r;
}

/** taxRateBps: basis points (8.25% = 825). Discount applies before tax. */
export function invoiceTotals({ items = [], taxRateBps = 0, discountCents = 0 }) {
  const subtotal = items.reduce((s, it) => s + lineTotalCents(it.quantity, it.unitCents), 0);
  const discount = Math.min(Math.max(0, discountCents || 0), subtotal);
  const taxable = subtotal - discount;
  const tax = roundDiv(taxable * (taxRateBps || 0), 10000);
  return { subtotal, discount, tax, total: taxable + tax };
}

export function sumCents(list, pick = (x) => x) {
  return list.reduce((s, x) => s + pick(x), 0);
}

export function formatMoney(cents, currency = 'USD', opts = {}) {
  const { compact = false, sign = false } = opts;
  const value = cents / 100;
  const f = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 2,
    minimumFractionDigits: compact ? 0 : 2,
    signDisplay: sign ? 'exceptZero' : 'auto',
  });
  return f.format(value);
}

/** Cents -> "1234.56" for editable inputs. */
export function centsToInput(cents) {
  const neg = cents < 0;
  const a = Math.abs(cents);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}
