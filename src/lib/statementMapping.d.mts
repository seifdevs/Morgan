export const statementColumnRules: { key: string; re: RegExp }[];
export function detectStatementColumns(headers: string[]): Partial<Record<string, number>>;
