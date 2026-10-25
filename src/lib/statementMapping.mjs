export const statementColumnRules = [
  { key: 'date', re: /date|posted/i },
  { key: 'description', re: /desc|memo|detail|narrative|transaction/i },
  { key: 'amount', re: /^(?!.*(?:debit|credit|withdraw|deposit|money\s*(?:in|out))).*(?:signed\s*)?(?:transaction\s*)?(?:amount|value|sum).*$/i },
  { key: 'debit', re: /debit|withdraw|money out/i },
  { key: 'credit', re: /credit|deposit|money in/i },
  { key: 'vendor', re: /vendor|merchant|payee|counterparty/i },
  { key: 'currency', re: /currency|ccy/i },
  { key: 'reference', re: /reference|ref( no)?|trace|id/i },
  { key: 'balance', re: /balance/i },
];

/** Map unambiguous headers once; directional debit/credit columns always beat a generic amount guess. */
export function detectStatementColumns(headers) {
  const found = {};
  for (const field of statementColumnRules) {
    const index = headers.findIndex((header, i) => field.re.test(String(header).trim()) && !Object.values(found).includes(i));
    if (index >= 0) found[field.key] = index;
  }
  if (found.amount !== undefined) { delete found.debit; delete found.credit; }
  return found;
}
