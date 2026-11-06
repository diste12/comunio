# Comunio

AI-orchestrated condominium administration for the Portuguese market, built so a
single administrator can run ~200 buildings (~4,000 fractions) with zero admin staff.
Working name for the *GestãoAI Condomínio* PRD.

**Stack:** Next.js 16 (App Router, Cache Components) on Vercel · Supabase Postgres · Clerk (admin auth) ·
Resend (email) · Ifthenpay (Multibanco / MB WAY) · Moloni (AT-certified receipts) · Meta WhatsApp Cloud API ·
OpenAI (triage agent, minutes, Whisper).

Every external integration has an offline **mock** mode, so the whole product runs locally with only Postgres.

## What's built (PRD 3-day sprint)

| Area | What it does | Code |
|---|---|---|
| **Ledger** | Schema for condominiums, fractions, residents, budgets, quotas, payments | `supabase/migrations/` |
| **Permilagem Engine** | Budget → quotas per fraction by ‰, exact to the cent, + ≥10% reserve fund (DL 268/94) | `src/lib/quotas/engine.ts` |
| **Payments** | Multibanco references + MB WAY push (Ifthenpay); daily cron issues references portfolio-wide | `src/lib/payments/`, `/api/cron/references` |
| **Receipts** | Idempotent payment webhook → Moloni receipt (multi-company); hourly retry cron | `/api/webhooks/ifthenpay`, `src/lib/billing/` |
| **WhatsApp triage** | Inbound messages → LLM agent with tools scoped to the sender (quotas, MB WAY, tickets, portal link, next assembly); rule-based fallback; admin inbox + simulator | `src/lib/triage/`, `/api/webhooks/whatsapp`, `/admin/whatsapp` |
| **Resident PWA** | Passwordless magic link via WhatsApp; owners see quotas, MB refs, MB WAY, receipts, minutes; tenants see tickets only | `/r/[token]`, `/portal` |
| **Convocations (Lei 8/2022)** | PDF notice; email if consent recorded, otherwise CTT registered mail; refuses < 10 days' notice | `src/lib/services/assemblies.ts` |
| **Live assemblies** | Attendance (present / online / represented), live quorum, weighted voting with legal majority rules (1st/2nd call, 2/3, unanimity) | `src/lib/assembly/rules.ts`, `/admin/assemblies/[id]` |
| **Minutes (ata)** | Whisper transcription + LLM discussion summaries; attendance, votes and per-fraction debt declaration (*título executivo*) generated from data; 1-click approval; PDF | `src/lib/services/minutes.ts` |
| **3-quote engine** | "Request quotes" → 3 vendor capability links by email → comparison matrix → award → vendor invoice (PDF/photo upload, over-budget flag) → 1-click payment approval | `src/lib/services/rfps.ts`, `/rfp/[token]` |
| **Bank reconciliation** | Salt Edge sync (daily cron) or statement CSV import; transfers matched to the oldest pending quotas by order ref, fraction or payer name, amount-only matches suggested for 1-click confirmation; receipts issued | `src/lib/bank/`, `src/lib/services/bank.ts`, `/admin/banco` |
| **Hybrid assemblies** | Owners join online from the portal (when the assembly admits videoconference), check in and vote; the chair sees "via portal" votes live | `/portal`, `src/lib/services/assemblies.ts` |
| **Onboarding** | New condominium + fractions/residents from CSV (permilagem must total 1000‰, NIF/phone validated); per-building Ifthenpay/Moloni/Salt Edge settings; resident editing with timestamped email consent (Lei 8/2022) | `/admin/condominiums/new`, `…/definicoes`, `…/residentes` |
| **Pre-litigation** | Debtors with ≥3 overdue quotas; letter PDF; 1-click CTT registered mail with 30-day cooldown | `/admin/devedores` |
| **Approvals inbox** | Urgent tickets, invoices to pay, quotes to award, minutes to sign, letters pending | `/admin` |

### Human-in-the-loop vs. zero-touch (PRD §6)
- **Zero-touch:** WhatsApp level-1 replies, MB references/MB WAY, receipts on payment, ticket logging, urgent-ticket email alerts.
- **1-click:** vendor payment approval, quote award, signing minutes, dispatching CTT letters.

### Legal rules encoded
- Votes weighted by permilagem (CC art. 1430.º). 1st call: > 500‰ in favour (art. 1432.º n.º 3). 2nd call: majority of
  capital present with ≥ 1/4 present (n.º 4). Innovations: majority of owners holding 2/3 (art. 1425.º). Unanimity of those
  present holding ≥ 2/3 is recorded as conditional on the absent owners (n.º 5–8). Tests: `tests/assembly.test.ts`.
- Minutes list each fraction's annual contribution and overdue debt so they work as an executory title
  (art. 6.º DL 268/94, as amended by Lei 8/2022). This section is built from data, never by the LLM.

## Local development

Needs Node 20+, pnpm, and Postgres 15+ (or `supabase start`).

```bash
pnpm install
cp .env.example .env.local      # set DATABASE_URL; everything else can stay on mock
pnpm db:migrate                 # plain Postgres; for Supabase use `supabase db push`
pnpm db:seed                    # 200 condominiums, ~4,200 fractions, 12 vendors (wipes data)
pnpm dev                        # http://localhost:3000/admin
```

Demo path: **/admin/whatsapp** (simulate "quanto devo?", "o elevador está avariado", "portal") → open the portal link →
**condominium page → Nova assembleia** → send convocations → start, mark attendance, vote → close → generate & sign the ata →
**Ocorrências → Pedir 3 orçamentos → Simular propostas → Adjudicar** → **Devedores**.

Checks: `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm build`

The exact NIF `55555` is an intentional test-fixture exception, accepted for both
condominiums and residents after migration `20261105234740_allow_test_nif.sql`.
It is not a real tax identifier; all other NIFs retain the existing validation,
and condominium NIFs remain unique. Failed onboarding submissions keep all text
and the selected CSV file, with validation errors beside the affected fields.
Network/time-out failures stay inside the form. Drafts are saved per admin in
the current tab's session storage for up to 24 hours and removed after confirmed
creation; after a reload, uploaded CSV contents are restored into the editor.
Admin routes, including onboarding actions, allow up to 600 seconds on Vercel
(the existing transcription route keeps its separate 300-second limit).

Database clients disable prepared statements and pipelining for the Supabase
transaction pooler. `pnpm check:database` runs the dashboard's concurrent read
queries against `DATABASE_URL` (or `.env.local`) and fails if they do not finish
within 10 seconds. It does not migrate, seed, or write data.

End-to-end service flows against a real database (wipes it — use a dedicated one):
```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/comunio_test pnpm test:integration
```

## Deploy (Vercel + Supabase)

After deploying, open **`/setup`**: it checks every required variable, the database connection
(with specific hints, e.g. Supabase direct host vs. transaction pooler, wrong password) and whether
migrations were applied. `/admin` redirects there while configuration is incomplete.

1. Create a Supabase project (EU region); `supabase link`, then `supabase db push`.
2. Import the repo in Vercel; set env vars from `.env.example` (`DATABASE_URL` = transaction pooler URL).
3. Clerk keys + `ADMIN_EMAILS` (disable public sign-ups), `SESSION_SECRET`, `CRON_SECRET`.
4. Webhooks: Ifthenpay callback URL (below) and Meta webhook `https://<app>/api/webhooks/whatsapp`.

Ifthenpay callback URL:
```
https://<app>/api/webhooks/ifthenpay?key=[ANTI_PHISHING_KEY]&orderId=[ORDER_ID]&amount=[AMOUNT]&requestId=[REQUEST_ID]&entity=[ENTITY]&reference=[REFERENCE]&payment_datetime=[PAYMENT_DATETIME]&payment_method=[PAYMENT_METHOD]
```

## Before go-live
- **Ifthenpay / Moloni / Meta:** the live clients follow the public APIs but were written without network access to
  their docs; validate each with sandbox credentials. Moloni: confirm the *Recibo de Quitação* document type and the
  VAT exemption reason with the accountant.
- **WhatsApp templates:** business-initiated messages (portal link from the admin) need an approved `portal_link` template.
- **OpenAI:** the LLM triage and minutes paths have not been exercised against the live API; rule/template fallbacks are tested.
- **CTT:** only a mock exists (tracking numbers in S10 format); no public CTT API was integrated.
- **Audio uploads:** Vercel caps request bodies at 4.5 MB; long recordings must be split (or uploaded to Supabase Storage first).
- The live assembly view and portal refresh by polling (3–4 s), not Supabase Realtime.
- **Salt Edge:** client written against v5 without network access to the docs; validate with sandbox credentials.
- Legal texts (convocation, minutes, letters) should be reviewed by a Portuguese lawyer before use.
