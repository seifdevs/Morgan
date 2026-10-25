export function toCents(input: unknown): number | null;
export function lineTotalCents(quantity: number, unitCents: number): number;
export function invoiceTotals(i: { items?: { quantity: number; unitCents: number }[]; taxRateBps?: number; discountCents?: number }): { subtotal: number; discount: number; tax: number; total: number };
export function sumCents<T>(list: T[], pick?: (x: T) => number): number;
export function formatMoney(cents: number, currency?: string, opts?: { compact?: boolean; sign?: boolean }): string;
export function centsToInput(cents: number): string;
