# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user owns a small agency or professional-services firm, has no finance team, and does the books themselves. They use Morgan alongside their accounting software or accountant, not instead of them. They come to Morgan to see where money is going, what they're owed, what's due next and whether cash will hold up over the coming weeks, usually in short sessions between client work.

## Product Purpose

Morgan is a financial workspace. It covers spending analysis, invoicing, receivables, bills, a 13-week cash-flow projection, profit and loss, and rule-based cost insights. It exists so owners can understand their financial position and the records behind their decisions. Success means an owner can answer "where do we stand and what's coming" from their own records, and trust every figure because it traces back to a transaction, invoice, payment or bill.

## Positioning

Morgan sits on top of accounting software. The accounting software records what happened; Morgan shows what it means. Every figure comes from stored records. Estimates are always labelled and look visibly different from recorded figures. Every cost insight links to the transactions behind it. Morgan never shows invented savings, simulated data or AI-written answers.

## Operating Context

- Records arrive by manual entry or CSV import from a bank or accounting-system export. There are no bank, accounting-software or payment integrations.
- Invoices are built in an editor with line items, discounts and tax. They go out as a PDF, by email when the server has email configured, or are marked as sent by hand. Recording a payment against an invoice or bill creates a linked transaction.
- "Today" (overdue status, projections) uses the time zone the business sets at signup or in Settings.
- Cash on hand = opening balance (set in Settings) + recorded transactions.
- Each account has one business, and only that business's signed-in users see its data.

## Capabilities and Constraints

- App routes: Overview, Transactions, Spending, Invoices (with receivables aging), Bills (`/app/payables`), Cash flow / Planning (`/app/forecast`), Reports (P&L), Cost insights (`/app/advisor`), Settings.
- Public site: Home, Features, Pricing, About, Resources (6 guides), FAQ, Contact, Login/Signup.
- Money is stored as integer cents, and the server recomputes invoice totals.
- What-if inputs in cash-flow planning are never saved.
- Email (invoice delivery, password reset) is optional. Without it, the UI has to say email isn't configured and offer PDF download plus "mark as sent".
- Not included: payment processing, file or receipt upload, OCR, a chat assistant, a review queue, or global search. Search only exists on the Transactions and Invoices pages.
- Pricing is proposed only: Free, and Professional at $49.99/month, an unconfirmed draft. No plan can be bought, and signup collects no payment details.
- Stack is already set: Vite + React + TypeScript frontend, Express + MongoDB backend, one long-running Node process (not serverless).

## Brand Commitments

- Name: **Morgan**. Founder: **Seif**, who appears on Home and About with the existing portrait (`src/assets/founder.svg`, reused as-is).
- Voice: "Clarity without shortcuts, confidence without overstatement." Plain, exact and honest about limits. The current copy says when a capability doesn't exist (no bank connection, no monitored inbox, prices not final).
- Public promise: "A recorded figure and an estimate should never look the same."
- The Helix chat widget from `helixbots.io` stays on the public site, and the CSP allows it.

## Evidence on Hand

- Real: product copy, the FAQ, the 6 resource guides (`src/pages/public/content.ts`), the founder story and portrait, and the working app on real stored records.
- Absent (pre-launch, no users): no customers, testimonials, logos, case studies, usage numbers, press or savings figures. Future work must not make any of these up. The removed fictional team section must not come back.

## Product Principles

1. **Every figure has a source.** If it can't be traced to a stored record, it isn't shown as fact.
2. **Estimates are never mistaken for records.** Projections, run-rates and what-ifs are always labelled and look different from recorded figures.
3. **Say what isn't there.** Missing integrations, unconfigured email and unfinished pricing are stated plainly, never hidden or simulated.
4. **Built for an owner without a finance team.** Plain language and the most urgent items first (overdue, due next), with the detail one step away.
5. **Next to the accountant, not instead of them.** Morgan explains the numbers and doesn't claim to replace accounting software or professional advice.
