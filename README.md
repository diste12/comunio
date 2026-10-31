# Comunio

AI-orchestrated condominium administration for the Portuguese market — built so a
single administrator can run ~200 buildings (~4,000 fractions) with zero admin staff.
Working name for the *GestãoAI Condomínio* PRD.

**Stack:** Next.js 16 (App Router, Cache Components) on Vercel · Supabase Postgres ·
Clerk (admin auth) · Resend (email, Day 2) · Ifthenpay (Multibanco / MB WAY) · Moloni (AT-certified receipts).

## Status — Day 1 (Foundation, Ledger & Payments) ✅

| PRD step | Where |
|---|---|
| Schema (PRD §5 + budgets, payment events, provider config) | `supabase/migrations/` |
| Permilagem Engine — budget → 12 monthly quotas per fraction, + ≥10% reserve fund (DL 268/94 art. 4.º) | `src/lib/quotas/engine.ts` |
| Ifthenpay — Multibanco references + MB WAY push (live client + offline mock) | `src/lib/payments/` |
| Moloni multi-company wrapper + payment webhook → receipt | `src/lib/billing/`, `src/app/api/webhooks/ifthenpay` |
| Admin dashboard for the 200-building ledger | `src/app/admin` |

### How money flows
1. **Budget → quotas.** Admin enters the annual ordinary budget. The engine splits it by
   permilagem with largest-remainder rounding (integer cents, totals reconcile exactly),
   adds the reserve fund per fraction (rounded *up*, so no owner is below the legal 10%),
   and splits each fraction's year into installments.
2. **Quotas → references.** "Emitir referências Multibanco" issues references for pending
   quotas due in the next 45 days. MB WAY pushes go to the owner's phone per quota.
3. **Payment → receipt (zero-touch).** Ifthenpay calls `/api/webhooks/ifthenpay`. The
   handler verifies the anti-phishing key, applies the payment idempotently
   (`payment_events`: `APPLIED | DUPLICATE | ALREADY_PAID | AMOUNT_MISMATCH | NOT_FOUND`),
   and issues the Moloni receipt after responding. Failed receipts are retried hourly by
   Vercel Cron (`/api/cron/receipts`); they never un-pay a quota.

Ifthenpay callback URL to configure in its backoffice:
```
https://<app>/api/webhooks/ifthenpay?key=[ANTI_PHISHING_KEY]&orderId=[ORDER_ID]&amount=[AMOUNT]&requestId=[REQUEST_ID]&entity=[ENTITY]&reference=[REFERENCE]&payment_datetime=[PAYMENT_DATETIME]&payment_method=[PAYMENT_METHOD]
```

### Architecture notes
- **Data access is server-only** (`postgres` client over the Supabase pooler). RLS is enabled
  on every table with no policies, so Supabase's public API roles see nothing.
- **Auth:** Clerk attaches the session in `src/proxy.ts`; `requireAdmin()` enforces access in
  every admin page and server action (`ADMIN_EMAILS` allowlist). Disable public sign-ups in Clerk.
- **Multi-tenant by NIF:** each condominium carries its own Ifthenpay keys (own IBAN) and
  Moloni company/document set/product ids.

## Local development

Needs Node 20+, pnpm, and Postgres 15+ (or `supabase start`).

```bash
pnpm install
cp .env.example .env.local      # set DATABASE_URL; mock providers + dev auth bypass work offline
pnpm db:migrate                 # plain Postgres; for Supabase use `supabase db push`
pnpm db:seed                    # 200 condominiums, ~4,200 fractions, 2026 ledger (wipes data)
pnpm dev                        # http://localhost:3000/admin
```

Try a payment in mock mode with **Simular pagamento** on a quota row, or:
```bash
curl "http://localhost:3000/api/webhooks/ifthenpay?orderId=Q<order_seq>&amount=<amount>&requestId=test1"
```

Checks: `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm build`

## Deploy (Vercel + Supabase)
1. Create a Supabase project (EU region); `supabase link`, then `supabase db push`.
2. Import the repo in Vercel; set env vars from `.env.example` (`DATABASE_URL` = transaction pooler URL).
3. Add the Clerk keys and `ADMIN_EMAILS`; set `CRON_SECRET` (Vercel sends it to the cron route).

## Before go-live (needs sandbox credentials)
- **Ifthenpay:** endpoint/field names follow the public API but were written without network
  access to their docs — validate with sandbox keys.
- **Moloni:** confirm with the accountant which document type is the *Recibo de Quitação*
  (currently `invoiceReceipts/insert`) and the VAT exemption reason for quotas.
- Ifthenpay payment timestamps are stored as if UTC; in summer time (WEST) they are 1h off.

## Next — Day 2
WhatsApp Cloud API + LLM triage agent, resident PWA with WhatsApp magic links,
Lei 8/2022 convocation engine (PDF + Resend email when consent recorded, CTT mock otherwise).
