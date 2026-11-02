import { writeFile } from 'node:fs/promises';

const url = 'https://api.fdic.gov/banks/institutions?filters=ACTIVE:1&fields=NAME,CERT,STNAME,ASSET&sort_by=ASSET&sort_order=DESC&limit=100&offset=0&format=json';
const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error(`FDIC BankFind returned HTTP ${response.status}`);
const result = await response.json();
if (!Array.isArray(result.data) || result.data.length !== 100) throw new Error('FDIC BankFind did not return the expected 100 institution records.');
const banks = result.data.map(({ data }, index) => ({ id: String(data.CERT), name: data.NAME, state: data.STNAME, rank: index + 1 }));
if (banks.some((bank) => !bank.id || !bank.name || !bank.state)) throw new Error('FDIC BankFind returned an incomplete institution record.');
const output = { country: 'US', currency: 'USD', source: url, sourceName: 'FDIC BankFind Suite · active insured institutions ranked by reported assets', updatedAt: new Date().toISOString(), banks };
await writeFile(new URL('../server/data/us-banks.json', import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
console.log(`Updated ${banks.length} US banks from FDIC BankFind.`);
