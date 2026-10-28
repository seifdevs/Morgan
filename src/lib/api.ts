export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = opts.method || 'GET';
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      signal: opts.signal,
      headers: { ...(opts.body !== undefined && { 'Content-Type': 'application/json' }), ...(method !== 'GET' && { 'X-Morgan-CSRF': '1' }) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'Could not reach Morgan. Check your connection and try again.');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('morgan:unauthorized'));
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data?.errors);
  }
  return data as T;
}

/* ---------- Types mirrored from the API ---------- */
export type User = { id: string; name: string; email: string; role?: 'admin' | 'user'; createdAt: string };
export type Business = {
  id: string; name: string; currency: string; address: string; email: string; invoicePrefix: string;
  defaultTaxRateBps: number; paymentTermsDays: number; openingBalanceCents: number; openingBalanceDate: string | null; timezone: string;
  financialSetupComplete: boolean; industry: string; monthlyBudgetCents: number | null; minimumCashCents: number | null;
  cashAccounts: { id: string; name: string; type: 'checking' | 'savings' | 'cash' | 'other'; currency: string; balanceCents: number; balanceDate: string; notes: string }[];
};
export type Txn = {
  id: string; date: string; description: string; vendor: string; category: string; amountCents: number; notes: string;
  source?: string; invoiceId?: string; billId?: string; currency?: string; accountId?: string; reconciliationStatus?: string; financialClass?: string;
};
export type Customer = { id: string; name: string; email: string; address: string; invoiced?: number; outstanding?: number; invoices?: number };
export type LineItem = { description: string; quantity: number; unitCents: number };
export type Payment = { id: string; amountCents: number; date: string; method: string; transactionId: string | null };
export type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'void';
export type Invoice = {
  id: string; number: string; customerId: string; customer: { name: string; email: string; address: string };
  issueDate: string; dueDate: string; items: LineItem[]; taxRateBps: number; discountCents: number; notes: string;
  status: 'draft' | 'sent' | 'paid' | 'void'; displayStatus: InvoiceStatus; payments: Payment[];
  totals: { subtotal: number; discount: number; tax: number; total: number }; amountPaid: number; balanceDue: number;
  sentAt?: string; sentVia?: string; sentTo?: string;
};
export type Bill = {
  id: string; vendor: string; description: string; category: string; amountCents: number; issueDate: string; dueDate: string;
  status: 'unpaid' | 'partial' | 'paid'; paidDate?: string; amountPaidCents: number; balanceDueCents: number;
  payments?: { id: string; amountCents: number; date: string; method: string; transactionId: string | null }[];
};
export type MonthRow = { month: string; income: number; expenses: number; net: number };
export type Overview = {
  period: { from: string; to: string; income: number; expenses: number; net: number };
  prior: { from: string; to: string; income: number; expenses: number; net: number };
  cash: number | null; cashDetails: { source: string | null; asOf: string | null; missingAccounts: string[]; knownBalanceCents: number | null }; hasOpeningBalance: boolean; balanceHistory: { month: string; balance: number | null }[];
  monthly: MonthRow[];
  receivables: { outstanding: number; count: number; overdue: number; overdueCount: number };
  payables: { outstanding: number; count: number; dueSoon: Bill[] };
  aging: { key: string; label: string; amount: number; count: number }[];
  upcomingInvoices: Invoice[]; recent: Txn[];
  counts: { transactions: number; invoices: number; bills: number; unclassified: number };
  financialPlan: { monthlyBudgetCents: number | null; monthlySpend: number; monthlyRemaining: number | null; minimumCashCents: number | null; forecast: { days7: number | null; days30: number | null; days90: number | null }; upcoming: { type: 'bill' | 'planned'; id: string; label: string; amountCents: number; date: string; overdue: boolean; confidence?: string }[] };
};
export type Breakdown = { name: string; amount: number; count: number; priorAmount: number };
export type Spending = {
  from: string; to: string; prior: { from: string; to: string }; total: number; priorTotal: number; count: number;
  byCategory: Breakdown[]; byVendor: Breakdown[]; cumulative: { day: number; current: number; prior: number }[];
  plannedRecurring: { id: string; name: string; category: string; amountCents: number; cadence: string; nextDate: string; monthlyEstimateCents: number }[];
};
export type PlannedItem = { id: string; name: string; type: 'income' | 'expense'; category: string; amountCents: number; cadence: 'once' | 'weekly' | 'monthly' | 'quarterly' | 'annually'; nextDate: string; endDate: string | null; confidence: 'contracted' | 'invoiced' | 'estimated' | 'planned'; notes: string; currency: string };
export type CashWeek = { week: number; start: string; end: string; inflows: number; outflows: number; items: { type: 'invoice' | 'bill' | 'planned'; id: string; label: string; amountCents: number; date: string; overdue: boolean; confidence?: string; cadence?: string }[] };
export type CashFlow = { opening: number | null; today: string; hasOpeningBalance: boolean; cashSource?: string | null; cashAsOf?: string | null; cashMissingAccounts?: string[]; weeks: CashWeek[]; runRateWeekly: number | null; historyDays: number; overdueIn: number; overdueOut: number };
export type Insight = {
  id: string; kind: string; severity: 'high' | 'medium' | 'low'; title: string; detail: string; amountCents: number;
  evidence: string[]; evidenceType: 'transaction' | 'invoice' | 'bill';
};
export type Pnl = { year: number; months: string[]; income: PnlRow[]; expenses: PnlRow[] };
export type PnlRow = { type: string; category: string; months: number[]; total: number };
