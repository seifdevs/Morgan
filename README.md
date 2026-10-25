# Morgan — financial workspace

Spending analysis, invoicing, receivables, bills, cash-flow planning and cost insights for small businesses.
Vite + React + TypeScript frontend, Express + MongoDB backend, one Node process.

## Run

Requires Node.js 20+.

```sh
npm install
cp .env.example .env        # set MONGODB_URI (and optionally email settings)
npm run build
npm start                   # production: serves dist/ + /api on http://localhost:4173
```

Development (Vite with hot reload, mounted inside the API server):

```sh
npm run dev          # uses MONGODB_URI from .env
npm run dev:local    # always a local mongod (data in .data/mongo) — never Atlas, even if .env points there
```

Checks: `npm run typecheck`, `npm test` (API + money tests against a throwaway in-memory MongoDB), `npm run build`.

## Environment

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI`, `MONGODB_DB` | MongoDB connection (required for `dev`/`start`). |
| `PORT` | Default 4173. |
| `TRUST_PROXY=1` | Set behind a reverse proxy so rate limits see real client IPs. |
| `RESEND_API_KEY`, `MAIL_FROM` | Optional email via Resend: invoice delivery and password reset. Without them, the app says email is not configured and offers PDF download + "mark as sent". |
| `APP_URL` | Public origin used to build password-reset links (never taken from the request Host header). Reset is offered only when this and email are configured. |

Production serves the session cookie with `Secure`, so run it behind HTTPS.

## Deploying

- Needs a long-running Node 20+ process (Render, Railway, Fly.io, a VM…). It is **not** a Vercel serverless app: it calls `app.listen`, keeps a Mongo connection pool, and rate-limits in memory (run one instance, or move limits to a shared store).
- Build with `npm ci && npm run build`, run `npm start`. Health check: `GET /api/health` (pings MongoDB).
- On first start it creates its indexes (unique `users.email`, unique `invoices.businessId+number`, TTL on `sessions.expiresAt`, and lookups by `businessId`). Use a database dedicated to Morgan (`MONGODB_DB`, default `morgan`).
- Atlas: create a database user with `readWrite` on the Morgan database only, and allow the host's outbound IPs in the access list.
- Production sends a Content-Security-Policy that allows the Helix widget from `helixbots.io`; adjust `server/app.mjs` if you add third-party scripts.

See `docs/LEGACY.md` for what changed from the original static site and `docs/ATLAS.md` for the dedicated Atlas deployment, password rotation and recovery.

## How it works

- **Auth:** scrypt password hashes, random session tokens stored hashed in `sessions` (30-day TTL index), `HttpOnly; SameSite=Lax` cookie, CSRF header check on state-changing requests, rate limits on login/register/password change, all other sessions revoked on password change.
- **Isolation:** every collection is keyed by `businessId`, taken from the server-side session — never from the request.
- **Money:** integer cents everywhere (`shared/money.js`, used by both server and client). Invoice totals are recomputed on the server. Imported bank movements change cash; they enter income or expense reporting only after classification. Transfers and card repayments are kept out of operating income and expenses.
- **Dates:** "today" (overdue status, projections) uses the business time zone set at signup / in Settings.
- **Figures:** actuals come from stored records. An account balance requires a dated opening point or statement close, then later account movements. Business cash totals include only the business currency; other currencies remain separate. The cash-flow projection and run-rate are labelled estimates; what-if inputs are never saved. Cost insights list the transactions behind every finding.
- **Statement imports:** CSV, XLSX, and text-selectable PDF statements are parsed for review before confirmation. Imports are deduplicated by account and transaction fingerprint, saved with the original file and a checksum, and tracked in account history. The original file is private to the business-scoped database record and is not returned by list APIs. Statement periods can be reviewed against monthly coverage. Scanned PDF OCR and legacy XLS are not supported; convert those statements to CSV or XLSX. Imported statements are user-supplied records and do not independently verify bank payments.

Collections: `users`, `businesses`, `sessions`, `transactions`, `customers`, `invoices` (with embedded payments), `bills` (with embedded payments), `bankAccounts`, `statementImports` (including private source files), `planningItems`, `financialAudit`.

## Not included

No live bank or accounting-software integrations, payment processing, OCR service, or independent payment verification. Rate limiting is in-memory (single instance). The previous static site is kept in `legacy/` for reference.
