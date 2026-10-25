// Minimal single-page PDF writer for invoices (standard Helvetica fonts, no dependencies).
import { formatMoney, lineTotalCents } from '../../shared/money.js';

// Helvetica widths (1/1000 em) for the characters that matter for right-aligned figures.
const W = { ' ': 278, ',': 278, '.': 278, '-': 333, '$': 556, '%': 889, '(': 333, ')': 333, '/': 278, ':': 278 };
const width = (s, size) => [...s].reduce((w, c) => w + (W[c] ?? (/[0-9]/.test(c) ? 556 : /[A-Z]/.test(c) ? 667 : /[a-z]/.test(c) ? 520 : 556)), 0) * size / 1000;

// WinAnsi-safe: escape PDF string delimiters and replace anything outside Latin-1 printable.
const pdfStr = (s) => String(s).replace(/[^\x20-\x7e\xa0-\xff]/g, '?').replace(/[\\()]/g, (c) => '\\' + c);

const hex = (h) => [1, 3, 5].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');

export function invoicePdf(inv, business) {
  const cur = business.currency || 'USD';
  const m = (c) => formatMoney(c, cur);
  const ops = [];
  const text = (x, y, s, { size = 10, bold = false, color = '#121820', align = 'left' } = {}) => {
    const str = String(s);
    const dx = align === 'right' ? width(str, size) : 0;
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${hex(color)} rg ${(x - dx).toFixed(2)} ${y} Td (${pdfStr(str)}) Tj ET`);
  };
  const rect = (x, y, w, h, color) => ops.push(`${hex(color)} rg ${x} ${y} ${w} ${h} re f`);
  const line = (x1, y1, x2, y2, color = '#d9dde1') => ops.push(`${hex(color)} RG 0.6 w ${x1} ${y1} m ${x2} ${y2} l S`);
  const wrap = (s, max) => {
    const out = []; let cur2 = '';
    for (const word of String(s).split(/\s+/)) {
      if ((cur2 + ' ' + word).trim().length > max) { if (cur2) out.push(cur2); cur2 = word; } else cur2 = (cur2 + ' ' + word).trim();
    }
    if (cur2) out.push(cur2);
    return out;
  };

  rect(0, 762, 612, 30, '#0b0f14');
  text(48, 772, 'mor', { size: 14, bold: true, color: '#c9a86a' });
  text(48 + width('mor', 14) + 1, 772, 'gan', { size: 14, bold: true, color: '#f4f6f8' });
  text(564, 772, 'INVOICE', { size: 10, bold: true, color: '#c9a86a', align: 'right' });

  let y = 720;
  text(48, y, business.name, { size: 16, bold: true });
  let by = y - 16;
  for (const l of [business.address, business.email].filter(Boolean).flatMap((a) => String(a).split('\n'))) { text(48, by, l, { size: 9, color: '#55606b' }); by -= 12; }

  text(564, y, inv.number, { size: 16, bold: true, align: 'right' });
  text(564, y - 16, `Issued ${inv.issueDate}`, { size: 9, color: '#55606b', align: 'right' });
  text(564, y - 28, `Due ${inv.dueDate}`, { size: 9, color: '#55606b', align: 'right' });

  y = Math.min(by, y - 40) - 24;
  text(48, y, 'BILL TO', { size: 8, bold: true, color: '#8d98a5' });
  y -= 15;
  text(48, y, inv.customer.name, { size: 11, bold: true });
  for (const l of [inv.customer.email, ...(inv.customer.address || '').split('\n')].filter(Boolean)) { y -= 13; text(48, y, l, { size: 9, color: '#55606b' }); }

  y -= 34;
  rect(48, y - 6, 516, 22, '#f2efe8');
  text(56, y + 1, 'DESCRIPTION', { size: 8, bold: true, color: '#55606b' });
  text(380, y + 1, 'QTY', { size: 8, bold: true, color: '#55606b', align: 'right' });
  text(470, y + 1, 'UNIT', { size: 8, bold: true, color: '#55606b', align: 'right' });
  text(556, y + 1, 'AMOUNT', { size: 8, bold: true, color: '#55606b', align: 'right' });
  y -= 26;
  for (const it of inv.items) {
    const lines = wrap(it.description, 52);
    text(56, y, lines[0] || '', { size: 10 });
    text(380, y, String(it.quantity), { size: 10, align: 'right' });
    text(470, y, m(it.unitCents), { size: 10, align: 'right' });
    text(556, y, m(lineTotalCents(it.quantity, it.unitCents)), { size: 10, align: 'right' });
    for (const extra of lines.slice(1)) { y -= 13; text(56, y, extra, { size: 10 }); }
    y -= 10; line(48, y, 564); y -= 16;
    if (y < 180) { text(56, y, '(additional lines omitted - see online invoice)', { size: 8, color: '#8d98a5' }); y -= 16; break; }
  }

  const t = inv.totals;
  const row = (label, val, opts = {}) => { text(470, y, label, { size: 10, color: '#55606b', align: 'right', ...opts }); text(556, y, val, { size: 10, align: 'right', ...opts }); y -= 16; };
  y -= 4;
  row('Subtotal', m(t.subtotal));
  if (t.discount) row('Discount', '-' + m(t.discount));
  if (inv.taxRateBps) row(`Tax (${(inv.taxRateBps / 100).toFixed(2)}%)`, m(t.tax));
  line(380, y + 8, 564, y + 8, '#121820');
  y -= 4;
  row('Total', m(t.total), { bold: true, size: 12, color: '#121820' });
  if (inv.amountPaid) { row('Paid', '-' + m(inv.amountPaid)); row('Balance due', m(inv.balanceDue), { bold: true, color: '#121820' }); }

  if (inv.notes) {
    y -= 18;
    text(48, y, 'NOTES', { size: 8, bold: true, color: '#8d98a5' });
    for (const l of String(inv.notes).split('\n').flatMap((p) => wrap(p, 95)).slice(0, 8)) { y -= 13; text(48, y, l, { size: 9, color: '#38424c' }); }
  }
  text(48, 40, `${business.name} · ${inv.number}`.replace('·', '-'), { size: 8, color: '#8d98a5' });

  const stream = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
