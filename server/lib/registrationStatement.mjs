import { createHash } from 'node:crypto';
import { parsePdfStatement } from '../../src/lib/pdfStatements.mjs';
import { detectStatementColumns } from '../../src/lib/statementMapping.mjs';
import { parseXlsx } from '../../src/lib/spreadsheets.mjs';

function csvRows(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted && c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { row.push(cell.trim()); cell = ''; if (row.some(Boolean)) rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    else cell += c;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  if (quoted) throw new Error('The CSV contains an unclosed quoted field.');
  return rows;
}
export const parseStatementDate = (v) => {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))) return s;
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) { const iso = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; if (!Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) return iso; }
  throw new Error(`Unrecognized transaction date “${s}”. Use YYYY-MM-DD or MM/DD/YYYY.`);
};
export const parseStatementMoney = (v) => {
  const s = String(v ?? '').trim().replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) throw new Error(`Unrecognized amount “${v}”.`);
  const cents = Math.round(Number(s) * 100); if (!Number.isSafeInteger(cents)) throw new Error('An amount is outside the supported range.'); return cents;
};
function normalize(rows, currency) {
  if (rows.length < 2) throw new Error('The statement needs a header row and at least one transaction.');
  if (rows.length > 5001) throw new Error('Statement files are limited to 5,000 transactions.');
  const headers = rows[0], columns = detectStatementColumns(headers);
  if (columns.date === undefined || columns.description === undefined || (columns.amount === undefined && columns.debit === undefined && columns.credit === undefined)) throw new Error('Morgan could not identify date, description, and amount columns. Use a CSV with clear headers or a selectable-text PDF statement.');
  const result = [];
  rows.slice(1).forEach((cells, i) => {
    if (!cells.some((v) => String(v || '').trim())) return;
    const get = (key) => columns[key] === undefined ? '' : cells[columns[key]];
    const description = String(get('description')).trim();
    if (!description) throw new Error(`Transaction row ${i + 2} is missing its description.`);
    const amount = columns.amount !== undefined ? parseStatementMoney(get('amount')) : parseStatementMoney(get('credit') || '0') - parseStatementMoney(get('debit') || '0');
    if (amount === 0) throw new Error(`Transaction row ${i + 2} has a zero or missing amount.`);
    const rowCurrency = String(get('currency') || currency).trim().toUpperCase();
    if (rowCurrency !== currency) throw new Error(`Transaction row ${i + 2} uses ${rowCurrency}, but this workspace is ${currency}. Mixed-currency statements need separate accounts.`);
    result.push({ date: parseStatementDate(get('date')), description: description.slice(0, 500), amountCents: amount, currency: rowCurrency, vendor: String(get('vendor') || '').trim().slice(0, 120), reference: String(get('reference') || '').trim().slice(0, 120), runningBalanceCents: get('balance') ? parseStatementMoney(get('balance')) : null, sourceRowNumber: i + 2 });
  });
  if (!result.length) throw new Error('No transaction rows were found in this statement.');
  return result;
}
export async function readStatementGrid({ filename, base64 }) {
  const ext = String(filename || '').split('.').at(-1)?.toLowerCase();
  if (!['csv', 'pdf', 'xlsx'].includes(ext)) throw new Error('Upload a PDF, CSV, or XLSX statement.');
  if (typeof base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('Choose a readable PDF or CSV statement.');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw new Error('Statement files must be 10 MB or smaller.');
  let grid;
  if (ext === 'csv') {
    if (buffer.includes(0) || !buffer.toString('utf8').trim()) throw new Error('The CSV contents are not readable text.');
    grid = csvRows(buffer.toString('utf8').replace(/^\uFEFF/, ''));
  } else if (ext === 'pdf') {
    if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('The file contents do not match a PDF.');
    grid = await parsePdfStatement(buffer);
  } else { if (!buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error('The file contents do not match an XLSX.'); grid = await parseXlsx(buffer); }
  return { grid, ext, buffer, sourceFileSha256: createHash('sha256').update(buffer).digest('hex') };
}
export async function parseRegistrationStatement({ filename, base64, currency }) {
  const { grid, ext, buffer, sourceFileSha256 } = await readStatementGrid({ filename, base64 });
  const rows = normalize(grid, currency);
  return { rows, fileType: ext, sourceFile: buffer, sourceFileSha256, columns: detectStatementColumns(grid[0]) };
}
export async function parseMappedStatement({ filename, base64, currency, mapping }) {
  const { grid, ext, buffer, sourceFileSha256 } = await readStatementGrid({ filename, base64 });
  const col = (row, key) => Number.isInteger(mapping?.[key]) && mapping[key] >= 0 ? String(row[mapping[key]] ?? '').trim() : '';
  if (!Number.isInteger(mapping?.date) || !Number.isInteger(mapping?.description) || (!Number.isInteger(mapping?.amount) && !Number.isInteger(mapping?.debit) && !Number.isInteger(mapping?.credit))) throw new Error('Map a date, description, and either amount or debit/credit columns.');
  if (grid.length < 2 || grid.length > 5001) throw new Error('The statement needs a header and between 1 and 5,000 transactions.');
  const rows = [];
  grid.slice(1).forEach((cells, i) => {
    if (!cells.some((v) => String(v || '').trim())) return;
    const description = col(cells, 'description');
    if (!description) throw new Error(`Transaction row ${i + 2} is missing its description.`);
    const amountCents = Number.isInteger(mapping.amount) ? parseStatementMoney(col(cells, 'amount')) : parseStatementMoney(col(cells, 'credit') || '0') - parseStatementMoney(col(cells, 'debit') || '0');
    if (!amountCents) throw new Error(`Transaction row ${i + 2} has a zero or missing amount.`);
    const rowCurrency = (col(cells, 'currency') || currency).toUpperCase();
    if (rowCurrency !== currency) throw new Error(`Transaction row ${i + 2} uses ${rowCurrency}; the account uses ${currency}.`);
    rows.push({ date: parseStatementDate(col(cells, 'date')), description: description.slice(0, 500), amountCents, currency, vendor: col(cells, 'vendor').slice(0, 120), reference: col(cells, 'reference').slice(0, 120), runningBalanceCents: col(cells, 'balance') ? parseStatementMoney(col(cells, 'balance')) : null, sourceRowNumber: i + 2 });
  });
  if (!rows.length) throw new Error('No transaction rows were found.');
  return { rows, fileType: ext, sourceFile: buffer, sourceFileSha256, columns: mapping };
}
