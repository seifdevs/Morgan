import { formatMoney } from '../../shared/money.js';

const widths = { ' ': 278, ',': 278, '.': 278, '-': 333, '$': 556, '%': 889, '(': 333, ')': 333, '/': 278, ':': 278 };
const width = (s, size) => [...s].reduce((n, c) => n + (widths[c] ?? (/[0-9]/.test(c) ? 556 : /[A-Z]/.test(c) ? 667 : /[a-z]/.test(c) ? 520 : 556)), 0) * size / 1000;
const clean = (s) => String(s ?? '').replace(/[^\x20-\x7e\xa0-\xff]/g, '?').replace(/[\\()]/g, (c) => '\\' + c);
const rgb = (h) => [1, 3, 5].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');

/** Multi-page financial summary assembled only from stored records and deterministic calculations. */
export function financialReportPdf({ business, year, pnl, overview, forecast, invoices, bills }) {
  const money = (c) => formatMoney(c, business.currency || 'USD');
  const allRows = [];
  const income = pnl.income.reduce((s, r) => s + r.total, 0);
  const expenses = pnl.expenses.reduce((s, r) => s + r.total, 0);
  allRows.push(['section', 'Financial summary']);
  allRows.push(['line', `Reporting year: ${year} · Prepared ${overview.asOf}`]);
  allRows.push(['line', `Recorded income: ${money(income)}     Recorded expenses: ${money(expenses)}     Net: ${money(income - expenses)}`]);
  allRows.push(['line', `Cash on hand: ${overview.cashCents === null ? 'Unavailable: no dated balance' : money(overview.cashCents)}${overview.cashAsOf ? ` as of ${overview.cashAsOf}` : ''}`]);
  allRows.push(['section', 'Monthly recorded activity']);
  allRows.push(['line', 'Month                         Income                  Expenses                    Net']);
  for (let i = 0; i < 12; i++) {
    const inc = pnl.income.reduce((s, r) => s + r.months[i], 0), exp = pnl.expenses.reduce((s, r) => s + r.months[i], 0);
    allRows.push(['line', `${pnl.months[i]}                      ${money(inc)}                  ${money(exp)}                    ${money(inc - exp)}`]);
  }
  allRows.push(['section', 'Income by category']);
  if (pnl.income.length) for (const r of pnl.income) allRows.push(['line', `${r.category}: ${money(r.total)}`]); else allRows.push(['line', 'No income transactions recorded for this year.']);
  allRows.push(['section', 'Expenses by category']);
  if (pnl.expenses.length) for (const r of pnl.expenses) allRows.push(['line', `${r.category}: ${money(r.total)}`]); else allRows.push(['line', 'No expense transactions recorded for this year.']);
  allRows.push(['section', 'Cash flow outlook · estimate']);
  allRows.push(['line', `Forecast confidence: ${forecast.confidence.level} (${forecast.confidence.score}%) · ${forecast.confidence.historyDays} days of record history`]);
  allRows.push(['line', `Assumptions: ${forecast.assumptions.collectionRates.base}; ${forecast.assumptions.paymentTiming} Bills counted in full.`]);
  for (const checkpoint of forecast.checkpoints) {
    const rows = forecast.forecasts.base.slice(0, checkpoint.days);
    const inflows = rows.reduce((s, r) => s + r.inflowsCents, 0), outflows = rows.reduce((s, r) => s + r.outflowsCents, 0);
    allRows.push(['line', `${checkpoint.days}-day base movements: in ${money(inflows)} · out ${money(outflows)} · net ${money(inflows - outflows)}`]);
    allRows.push(['line', `${checkpoint.days}-day projected balance — conservative ${checkpoint.conservativeCents === null ? 'Unavailable' : money(checkpoint.conservativeCents)} · base ${checkpoint.baseCents === null ? 'Unavailable' : money(checkpoint.baseCents)} · optimistic ${checkpoint.optimisticCents === null ? 'Unavailable' : money(checkpoint.optimisticCents)}`]);
  }
  allRows.push(['line', forecast.lowPoint ? `Lowest base-case point: ${forecast.lowPoint.date}, ${money(forecast.lowPoint.balanceCents)}.` : 'Cash balance forecast unavailable until a dated opening balance or statement balance is recorded.']);
  allRows.push(['line', overview.forecastCommentary]);
  allRows.push(['section', 'Open invoices']);
  const openInvoices = invoices.filter((i) => ['sent', 'partial', 'overdue'].includes(i.displayStatus)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (openInvoices.length) for (const i of openInvoices.slice(0, 18)) allRows.push(['line', `${i.number} · ${i.customer.name} · due ${i.dueDate} · ${i.displayStatus} · ${money(i.balanceDue)} due`]); else allRows.push(['line', 'No open invoices.']);
  allRows.push(['section', 'Unpaid bills']);
  const unpaid = bills.filter((b) => ['unpaid', 'partial'].includes(b.status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (unpaid.length) for (const b of unpaid.slice(0, 18)) allRows.push(['line', `${b.vendor} · due ${b.dueDate} · ${money(b.balanceDueCents)} due`]); else allRows.push(['line', 'No unpaid bills.']);
  allRows.push(['small', 'Morgan report. Recorded figures come from saved transactions, invoices, bills and dated cash balances. Forecasts are estimates, not guarantees.']);

  const pages = []; let ops = []; let y = 730; let pageNo = 0;
  const text = (x, py, str, { size = 9, bold = false, color = '#202a34' } = {}) => ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(color)} rg ${x} ${py} Td (${clean(str)}) Tj ET`);
  const rect = (x, py, w, h, color) => ops.push(`${rgb(color)} rg ${x} ${py} ${w} ${h} re f`);
  const startPage = () => { pageNo++; ops = []; rect(0, 758, 612, 34, '#0b0f14'); text(42, 771, 'MORGAN', { size: 12, bold: true, color: '#c9a86a' }); text(570, 771, 'FINANCIAL REPORT', { size: 8, bold: true, color: '#f4f6f8' }); y = 733; text(42, y, business.name, { size: 15, bold: true }); y -= 18; text(42, y, `${year} · ${business.currency} · Page ${pageNo}`, { size: 8, color: '#66717d' }); y -= 22; };
  const finishPage = () => { ops.push(`0.75 w ${rgb('#d9dde1')} RG 42 43 m 570 43 l S`); text(42, 29, 'Source: Morgan business records · Forecast values are estimates', { size: 7, color: '#66717d' }); pages.push(ops.join('\n')); };
  startPage();
  for (const [kind, value] of allRows) {
    const needed = kind === 'section' ? 23 : 16;
    if (y < 64 + needed) { finishPage(); startPage(); }
    if (kind === 'section') { y -= 3; rect(42, y - 5, 528, 17, '#edf0f2'); text(48, y, value.toUpperCase(), { size: 8, bold: true, color: '#55606b' }); y -= 19; }
    else { text(48, y, value, { size: kind === 'small' ? 7 : 8, color: kind === 'small' ? '#66717d' : '#202a34' }); y -= kind === 'small' ? 10 : 14; }
  }
  finishPage();

  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', null];
  const pageIds = pages.map((_, i) => 3 + i * 2);
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  pages.forEach((stream, i) => {
    const pageId = 3 + i * 2, contentId = pageId + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R /F2 ${4 + pages.length * 2} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'; const offsets = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1'); out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
