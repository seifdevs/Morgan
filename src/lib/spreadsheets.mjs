import ExcelJS from 'exceljs';

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const cell = value;
    if ('text' in cell && typeof cell.text === 'string') return cell.text;
    if ('richText' in cell && Array.isArray(cell.richText)) return cell.richText.map((part) => part.text || '').join('');
    if ('result' in cell) return cellText(cell.result);
    if ('hyperlink' in cell && typeof cell.text === 'string') return cell.text;
  }
  return String(value).trim();
}

/** Read the first worksheet of an XLSX statement into the same tabular shape as CSV. */
export async function parseXlsx(buffer, maxRows = 5001) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('The workbook has no worksheets.');
  if (sheet.rowCount > maxRows) throw new Error(`The workbook exceeds the ${maxRows - 1} row limit.`);
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values;
    rows.push(Array.from(values.slice(1), cellText));
  });
  return rows;
}
