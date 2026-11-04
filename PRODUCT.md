# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user owns a small agency or professional-services firm, has no finance team, and does the books themselves. They use Morgan alongside their accounting software or accountant, not instead of them. They come to Morgan to see where money is going, what they're owed, what's due next and whether cash will hold up over the coming weeks, usually in short sessions between client work.

## Product Purpose

Morgan is a financial workspace. It covers spending analysis, invoicing, receivables, bills, plan-bounded cash-flow projections (30 days on Starter, up to 90 days on published paid tiers), profit and loss, saved scenario simulations, evidence-based alerts and financial explanations. It exists so owners can understand their position and the records behind their decisions. Success means an owner can answer "where do we stand and what's coming" from their own records, and trust every figure because it traces back to a transaction, invoice, payment, bill or explicit estimate.

## Positioning

Morgan sits on top of accounting software. The accounting software records what happened; Morgan shows what it means. Every figure comes from stored records or a clearly labelled deterministic estimate. Every cost insight links to its source. Gemini can explain the provided evidence and forecasts, but cannot change records, calculations or produce unsupported figures.

## Operating Context

- Records arrive by manual entry or CSV import from a bank or accounting-system export. There are no bank, accounting-software or payment integrations.
- Invoices are built in an editor with line items, discounts and tax. They go out as a PDF, by email when the server has email configured, or are marked as sent by hand. Recording a payment against an invoice or bill creates a linked transaction.
- "Today" (overdue status, projections) uses the time zone the business sets at signup or in Settings.
- Cash on hand = opening balance (set in Settings) + recorded transactions.
- Each account has one business, and only that business's signed-in users see its data.

## Capabilities and Constraints

- App routes: Dashboard, Financial Core, Monitor, Horizon, Reports, Settings. Financial Core links to the existing Transactions, Spending, Invoices (with receivables aging), Bills (`/app/payables`), Customers and Bank Accounts workflows. The legacy Cash flow / Planning route (`/app/forecast`) remains available.
- Public site: Home, Features, Pricing, About, Resources (6 guides), FAQ, Contact, Login/Signup.
- Money is stored as integer cents, and the server recomputes invoice totals.
- Horizon uses the same deterministic cash calculation engine on every plan. Starter can request 30 days; the published Pro and Max allowances are 90 days. Starter responses stop at the plan boundary, including the legacy cash-flow route and dashboard summaries.
- Scenario assumptions (hiring, lost or new clients, delayed receipts, increased costs and large purchases) are stored in a separate business-scoped collection and recomputed against the current records; they never create or modify ledger entries.
- Monitor Core (Starter) exposes overdue invoices, late bills, possible duplicates and forecast reserve pressure. Full Monitor (Pro/Max) adds unusual expenses, vendor spending increases and recurring charge changes. Findings link to supporting records.
- Gemini explanations are optional. The server sends relevant scoped records, plan-bounded deterministic forecast output, assumptions and the selected scenario; conversation context is bounded and business-scoped. Completed responses use an atomic monthly reservation, failed requests release it, request IDs replay the saved response, and provider token counts are retained internally. Cost estimates remain blank unless the server operator supplies both model token rates.
- Reports include a downloadable PDF generated from saved records and deterministic forecasts; the P&L CSV export remains available.
- Email (invoice delivery, password reset) is optional. Without it, the UI has to say email isn't configured and offer PDF download plus "mark as sent".
- Not included: live bank or accounting-software integrations, payment processing for Morgan's customers, file or receipt upload, OCR, a review queue, or global search. Search only exists on the Transactions and Invoices pages. Gemini requires a server-side API key; Horizon and Monitor work without it.
- Pricing is published as Starter (free), Pro ($49.99 monthly / $499 annual), and Max ($199.99 monthly / $1,499 annual). Paid plan requests use one-time PayPal.Me links with manually submitted transaction IDs and administrator verification; they do not renew automatically. There are no trials or automatic provider verification. New accounts default to Starter; paid plan IDs alone cannot grant access. One business and one account member are supported per customer. Additional workspace and seat capacities are published but not yet usable, so they remain a launch blocker for the full commercial plan set.
- Monthly usage uses UTC calendar periods and resets by deriving a new period at 00:00 UTC on the first. A startup baseline records current-month transactions, invoices, bills, and planning items created before this accounting shipped. New records count once when accepted: transactions (including accepted imported rows), invoices, bills, and planned items. Customer profiles, bank accounts, edits, exports, generated forecasts, Monitor findings, and linked payment views do not count separately.
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
