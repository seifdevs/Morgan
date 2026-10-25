export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function addDaysISO(iso: string, n: number) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const fmtShort = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmtMonth = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const fmtMonthYear = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export const formatDate = (iso?: string | null) => (iso ? fmt.format(new Date(iso.slice(0, 10) + 'T00:00:00Z')) : '—');
export const formatDay = (iso: string) => fmtShort.format(new Date(iso + 'T00:00:00Z'));
export const formatMonth = (ym: string) => fmtMonth.format(new Date(ym + '-01T00:00:00Z'));
export const formatMonthYear = (ym: string) => fmtMonthYear.format(new Date(ym + '-01T00:00:00Z'));

export type RangeKey = 'month' | 'last-month' | '30d' | '90d' | 'quarter' | 'ytd' | '12m';
export const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'ytd', label: 'Year to date' },
  { key: '12m', label: 'Last 12 months' },
];

export function rangeDates(key: RangeKey, today = todayISO()): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number);
  const iso = (Y: number, M: number, D: number) => new Date(Date.UTC(Y, M - 1, D)).toISOString().slice(0, 10);
  switch (key) {
    case 'month': return { from: iso(y, m, 1), to: today };
    case 'last-month': return { from: iso(y, m - 1, 1), to: iso(y, m, 0) };
    case '30d': return { from: addDaysISO(today, -29), to: today };
    case '90d': return { from: addDaysISO(today, -89), to: today };
    case 'quarter': return { from: iso(y, Math.floor((m - 1) / 3) * 3 + 1, 1), to: today };
    case 'ytd': return { from: iso(y, 1, 1), to: today };
    case '12m': return { from: iso(y, m - 11, 1), to: today };
  }
}
