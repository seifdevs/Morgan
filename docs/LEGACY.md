# What happened to the original site (`legacy/`)

The original was a static, browser-only demo: fixed sample records, a sign-in flag in localStorage, and simulated actions.
Every URL still resolves.

| Original | Now | Status |
| --- | --- | --- |
| `/` home, founder section, Helix chat widget | `/` redesigned; founder portrait reused as-is; widget kept | Kept |
| `/features`, `/product/*` (invoicing, financial-tracking, forecasting, advisor) | `/features` with anchored sections; `/product/*` shows it | Merged into one page |
| `/pricing` (proposed Free / $49.99 Professional) | `/pricing`, same "proposed, not purchasable" wording | Kept |
| `/about` founder story | `/about` | Kept |
| `/about` team section (fictional placeholder people, flagged "not actual employees") | — | **Removed** (placeholders shouldn't ship) |
| `/resources` + 6 guides | Same slugs, same guide text | Kept |
| `/faq` | Rewritten for the real product (auth, data, email) | Updated |
| `/contact` (no form; no monitored inbox) | Same honest note | Kept |
| `/login`, `/signup` (localStorage flag) | Real accounts in MongoDB, HTTP-only sessions | Replaced |
| `/logout` | Ends the server session, then redirects to login | Kept |
| `/app` overview (sample figures) | Overview from stored records | Replaced with real data |
| `/app/invoices` (sample invoices, bills, receipts) | Invoices with editor, PDF, payments | Replaced |
| `/app/receivables` | Receivables with aging | Kept |
| `/app/payables` | Bills (`/app/payables` shows it) | Renamed |
| `/app/transactions` | Transactions with filters, CSV import/export | Replaced |
| `/app/forecast` (scenarios) | Cash flow (`/app/forecast` shows it): 13-week projection and what-if inputs | Replaced |
| `/app/reports` | Profit & loss by month/category, CSV export | Replaced |
| `/app/advisor` (prepared answers, not a model) | Cost insights (`/app/advisor` shows it): rule-based findings with evidence | **Replaced**; no chat assistant |
| Document/receipt upload with "extracted" fields (simulated) | CSV transaction import only | **Not carried over**: no file storage or OCR |
| Review queue for unmatched/uncategorised records (simulated) | Invoice/bill payments create linked transactions automatically; duplicates surface in Insights | **Not carried over** as a separate queue |
| Payment reminder drafting (preview only, never sent) | "Email again" on a sent invoice (real, only when email is configured) | Partially replaced |
| Global search modal over sample records | Search on Transactions and Invoices pages | Partially replaced |
