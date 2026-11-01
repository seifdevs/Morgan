export type SampleEntry = { who: string; what: string; cents: number };
export type SampleWeek = { start: string; est: boolean; entries: SampleEntry[] };

/** One illustrative ledger powers the homepage overview and the cash-flow statement. */
export const SAMPLE_OPENING_CENTS = 5_840_000;
export const SAMPLE_LAST_RECORDED_WEEK = 4;
export const SAMPLE_WEEKS: SampleWeek[] = [
  { start: 'Sep 15', est: false, entries: [{ who: 'Meridian Labs', what: 'Retainer', cents: 1_120_000 }, { who: 'Harbor Workspace', what: 'Rent', cents: -185_000 }, { who: 'Cloudline', what: 'Hosting', cents: -68_400 }] },
  { start: 'Sep 22', est: false, entries: [{ who: 'Aster & Row', what: 'Project payment', cents: 740_000 }, { who: 'Gusto', what: 'Payroll', cents: -1_420_000 }] },
  { start: 'Sep 29', est: false, entries: [{ who: 'Cedar House', what: 'INV-0101', cents: 970_000 }, { who: 'Figma', what: 'Design tools', cents: -18_000 }, { who: 'West & Pine', what: 'Supplies', cents: -41_250 }] },
  { start: 'Oct 6', est: false, entries: [{ who: 'Meridian Labs', what: 'Retainer', cents: 1_120_000 }, { who: 'Harbor Workspace', what: 'Rent', cents: -185_000 }, { who: 'Alaska Air', what: 'Team travel', cents: -127_540 }] },
  { start: 'Oct 13', est: false, entries: [{ who: 'Cedar House', what: 'INV-0108', cents: 1_234_050 }, { who: 'Gusto', what: 'Payroll', cents: -1_420_000 }] },
  { start: 'Oct 20', est: true, entries: [{ who: 'Meridian Labs', what: 'NW-0002 due Oct 22', cents: 692_500 }, { who: 'Harbor Workspace', what: 'Bill due Oct 26', cents: -185_000 }] },
  { start: 'Oct 27', est: true, entries: [{ who: 'Aster & Row', what: 'NW-0003 due Oct 30', cents: 450_000 }, { who: 'Fieldwork Creative', what: 'Bill due Oct 31', cents: -320_000 }] },
  { start: 'Nov 3', est: true, entries: [{ who: 'Meridian Labs', what: 'NW-0004 due Nov 7', cents: 58_249 }, { who: 'Gusto', what: 'Payroll (recurring)', cents: -1_420_000 }] },
];

function total(entries: SampleEntry[], positive: boolean) {
  return entries.reduce((sum, entry) => sum + (positive ? Math.max(0, entry.cents) : Math.max(0, -entry.cents)), 0);
}

const posted = SAMPLE_WEEKS.slice(0, SAMPLE_LAST_RECORDED_WEEK + 1);
const future = SAMPLE_WEEKS.slice(SAMPLE_LAST_RECORDED_WEEK + 1);
const closingCents = SAMPLE_OPENING_CENTS + posted.reduce((sum, week) => sum + week.entries.reduce((weekSum, entry) => weekSum + entry.cents, 0), 0);

export const SAMPLE_OVERVIEW = {
  balanceCents: closingCents,
  balanceDate: posted.at(-1)?.start ?? '',
  incomeCents: total(posted.flatMap((week) => week.entries), true),
  expenseCents: total(posted.flatMap((week) => week.entries), false),
  receivablesCents: total(future.flatMap((week) => week.entries), true),
  obligationsCents: total(future.flatMap((week) => week.entries), false),
  receivableCount: future.flatMap((week) => week.entries).filter((entry) => entry.cents > 0).length,
  obligationCount: future.flatMap((week) => week.entries).filter((entry) => entry.cents < 0).length,
  through: posted.at(-1)?.start ?? '',
};
