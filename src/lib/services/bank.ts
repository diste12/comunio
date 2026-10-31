import "server-only";
import { createHash } from "node:crypto";
import { matchTransfer, oldestCovering, type FractionCandidate } from "@/lib/bank/matcher";
import { fetchSaltEdgeCredits } from "@/lib/bank/saltedge";
import type { StatementLine } from "@/lib/bank/csv";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { centsToDecimal, toCents } from "@/lib/money";
import { orderIdFor } from "@/lib/payments";
import { applyPayment, issueReceiptForCharge } from "./reconcile";

type Source = "SALTEDGE" | "CSV" | "MOCK";

export async function importTransactions(condominiumId: string, source: Source, lines: StatementLine[]) {
  if (lines.length === 0) return { inserted: 0 };
  const rows = await sql`
    insert into bank_transactions ${sql(
      lines.map((l) => ({
        condominium_id: condominiumId, source, external_id: l.externalId, booked_on: l.bookedOn,
        amount: centsToDecimal(l.amountCents), description: l.description, counterparty_name: l.counterpartyName,
      })),
    )}
    on conflict (condominium_id, source, external_id) do nothing returning id`;
  return { inserted: rows.length };
}

async function candidates(condominiumId: string): Promise<FractionCandidate[]> {
  const rows = await sql<{ fraction_id: string; designation: string; owners: string[] | null; id: string | null; order_seq: string | null; amount_total: string | null; due_date: string | null }[]>`
    select f.id fraction_id, f.designation,
      (select array_agg(full_name) from residents r where r.fraction_id = f.id and r.role = 'Proprietário') owners,
      q.id, q.order_seq, q.amount_total, to_char(q.due_date, 'YYYY-MM-DD') due_date
    from fractions f
    left join quota_charges q on q.fraction_id = f.id and q.payment_status = 'PENDING' and q.due_date <= current_date + 45
    where f.condominium_id = ${condominiumId}
    order by f.designation, q.due_date, q.installment`;
  const byFraction = new Map<string, FractionCandidate>();
  for (const r of rows) {
    let f = byFraction.get(r.fraction_id);
    if (!f) {
      f = { fractionId: r.fraction_id, designation: r.designation, ownerNames: r.owners ?? [], pending: [] };
      byFraction.set(r.fraction_id, f);
    }
    if (r.id) f.pending.push({ id: r.id, orderSeq: r.order_seq!, amountCents: toCents(r.amount_total), dueDate: r.due_date! });
  }
  return [...byFraction.values()];
}

/** Mark quotas paid by a bank transfer (through the same idempotent payment path) and issue receipts. */
export async function applyBankMatch(transactionId: string, chargeIds: string[], by: string, reason: string) {
  const [t] = await sql<{ amount: string; booked_on: string; status: string }[]>`
    select amount, to_char(booked_on, 'YYYY-MM-DD') booked_on, status from bank_transactions where id = ${transactionId}`;
  if (!t || t.status !== "UNMATCHED") throw new Error("Movimento já tratado.");
  const charges = await sql<{ id: string; order_seq: string; amount_total: string; payment_status: string }[]>`
    select id, order_seq, amount_total, payment_status from quota_charges where id in ${sql(chargeIds)}`;
  if (charges.length !== chargeIds.length || charges.some((c) => c.payment_status !== "PENDING")) {
    throw new Error("Alguma das quotas já não está pendente.");
  }
  if (charges.reduce((s, c) => s + toCents(c.amount_total), 0) !== toCents(t.amount)) throw new Error("O valor não corresponde às quotas.");

  for (const c of charges) {
    const { outcome } = await applyPayment({
      provider: "bank", orderId: orderIdFor(c.order_seq), entity: null, reference: null,
      requestId: `bank:${transactionId}:${c.id}`, amountCents: toCents(c.amount_total), method: "TRANSFER",
      paidAt: new Date(`${t.booked_on}T12:00:00Z`), raw: { transaction: transactionId },
    });
    if (outcome !== "APPLIED" && outcome !== "DUPLICATE") throw new Error(`Pagamento não aplicado: ${outcome}`);
  }
  await sql.begin(async (tx) => {
    await tx`insert into bank_transaction_matches ${tx(chargeIds.map((id) => ({ transaction_id: transactionId, quota_charge_id: id })))} on conflict do nothing`;
    await tx`update bank_transactions set status = 'MATCHED', matched_by = ${by}, match_reason = ${reason}, suggestion = null where id = ${transactionId}`;
  });
  for (const id of chargeIds) await issueReceiptForCharge(id).catch(() => {}); // retried by cron on failure
}

/** Zero-touch: apply HIGH-confidence matches, store MEDIUM ones as suggestions. */
export async function reconcileCondominium(condominiumId: string) {
  const txs = await sql<{ id: string; amount: string; description: string; counterparty_name: string | null }[]>`
    select id, amount, description, counterparty_name from bank_transactions
    where condominium_id = ${condominiumId} and status = 'UNMATCHED' order by booked_on, created_at`;
  if (txs.length === 0) return { auto: 0, suggested: 0, unmatched: 0 };
  const cands = await candidates(condominiumId);
  let auto = 0, suggested = 0, unmatched = 0;
  for (const t of txs) {
    const m = matchTransfer({ amountCents: toCents(t.amount), description: t.description, counterpartyName: t.counterparty_name }, cands);
    if (m?.confidence === "HIGH") {
      try {
        await applyBankMatch(t.id, m.chargeIds, "AUTO", m.reason);
        auto++;
        // matched quotas are no longer candidates for the next transfers
        for (const f of cands) f.pending = f.pending.filter((c) => !m.chargeIds.includes(c.id));
        continue;
      } catch {
        /* fall through to suggestion */
      }
    }
    await sql`update bank_transactions set suggestion = ${m ? sql.json(m) : null} where id = ${t.id}`;
    if (m) suggested++;
    else unmatched++;
  }
  return { auto, suggested, unmatched };
}

export async function confirmSuggestion(transactionId: string, by: string) {
  const [t] = await sql<{ suggestion: { chargeIds: string[]; reason: string } | null }[]>`
    select suggestion from bank_transactions where id = ${transactionId}`;
  if (!t?.suggestion) throw new Error("Sem sugestão.");
  await applyBankMatch(transactionId, t.suggestion.chargeIds, by, `${t.suggestion.reason} (confirmado)`);
}

/** Admin picks the fraction; the transfer pays its oldest pending quotas. */
export async function assignToFraction(transactionId: string, fractionId: string, by: string) {
  const [t] = await sql<{ amount: string; condominium_id: string }[]>`select amount, condominium_id from bank_transactions where id = ${transactionId}`;
  if (!t) throw new Error("Movimento não encontrado.");
  const f = (await candidates(t.condominium_id)).find((c) => c.fractionId === fractionId);
  const covering = f ? oldestCovering(f.pending, toCents(t.amount)) : null;
  if (!f || !covering) throw new Error("O valor não corresponde às quotas pendentes mais antigas desta fração.");
  await applyBankMatch(transactionId, covering.map((c) => c.id), by, `Atribuído manualmente à fração ${f.designation}`);
}

export async function ignoreTransaction(transactionId: string, by: string) {
  await sql`update bank_transactions set status = 'IGNORED', matched_by = ${by} where id = ${transactionId} and status = 'UNMATCHED'`;
}

/** Pull new credits for one condominium (Salt Edge, or fabricated in mock mode) and reconcile. */
export async function syncBank(condominiumId: string) {
  const [c] = await sql<{ saltedge_connection_id: string | null; saltedge_account_id: string | null; bank_synced_at: Date | null }[]>`
    select saltedge_connection_id, saltedge_account_id, bank_synced_at from condominiums where id = ${condominiumId}`;
  if (!c) throw new Error("Condomínio não encontrado.");
  let source: Source;
  let lines: StatementLine[];
  if (env().BANK_PROVIDER === "saltedge") {
    if (!c.saltedge_connection_id || !c.saltedge_account_id) throw new Error("Conta bancária não ligada (Salt Edge).");
    const from = (c.bank_synced_at ?? new Date(Date.now() - 90 * 86_400_000)).toISOString().slice(0, 10);
    lines = await fetchSaltEdgeCredits(c.saltedge_connection_id, c.saltedge_account_id, from);
    source = "SALTEDGE";
  } else {
    lines = await mockTransfers(condominiumId);
    source = "MOCK";
  }
  const { inserted } = await importTransactions(condominiumId, source, lines);
  await sql`update condominiums set bank_synced_at = now() where id = ${condominiumId}`;
  return { inserted, ...(await reconcileCondominium(condominiumId)) };
}

/** Demo data: realistic transfers for a few owners with pending quotas, plus noise. */
async function mockTransfers(condominiumId: string): Promise<StatementLine[]> {
  const cands = (await candidates(condominiumId)).filter((f) => f.pending.length > 0);
  const today = new Date().toISOString().slice(0, 10);
  const id = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 20);
  const out: StatementLine[] = [];
  const [a, b, c, d] = cands;
  if (a) out.push({ externalId: id(`ref${a.pending[0].id}`), bookedOn: today, description: `TRF CONDOMINIO ${orderIdFor(a.pending[0].orderSeq)}`, amountCents: a.pending[0].amountCents, counterpartyName: null });
  if (b) {
    const two = b.pending.slice(0, 2);
    out.push({ externalId: id(`des${b.fractionId}`), bookedOn: today, description: `QUOTAS FRACAO ${b.designation}`, amountCents: two.reduce((s, x) => s + x.amountCents, 0), counterpartyName: null });
  }
  if (c && c.ownerNames[0]) out.push({ externalId: id(`name${c.fractionId}`), bookedOn: today, description: "TRF SEPA", amountCents: c.pending[0].amountCents, counterpartyName: c.ownerNames[0].toUpperCase() });
  if (d) out.push({ externalId: id(`amt${d.fractionId}`), bookedOn: today, description: "TRANSFERENCIA", amountCents: d.pending.slice(0, 3).reduce((s, x) => s + x.amountCents, 0), counterpartyName: null });
  out.push({ externalId: id(`noise${condominiumId}${today}`), bookedOn: today, description: "DEVOLUCAO SEGURO", amountCents: 12345, counterpartyName: "SEGURADORA XYZ" });
  return out;
}

export async function listBankQueue() {
  const rows = await sql<
    { id: string; condominium_id: string; condo: string; booked_on: string; amount: string; description: string; counterparty_name: string | null;
      source: string; suggestion: { fractionId: string; chargeIds: string[]; reason: string } | null; suggested_designation: string | null }[]
  >`
    select t.id, t.condominium_id, c.name condo, to_char(t.booked_on, 'YYYY-MM-DD') booked_on, t.amount, t.description,
      t.counterparty_name, t.source, t.suggestion,
      (select designation from fractions f where f.id = (t.suggestion->>'fractionId')::uuid) suggested_designation
    from bank_transactions t join condominiums c on c.id = t.condominium_id
    where t.status = 'UNMATCHED' order by (t.suggestion is null), t.booked_on desc limit 300`;
  const condoIds = [...new Set(rows.map((r) => r.condominium_id))];
  const fractions = condoIds.length
    ? await sql<{ id: string; condominium_id: string; designation: string }[]>`
        select id, condominium_id, designation from fractions where condominium_id in ${sql(condoIds)} order by designation`
    : [];
  const recent = await sql<{ id: string; condo: string; booked_on: string; amount: string; description: string; match_reason: string | null; matched_by: string | null; designations: string }[]>`
    select t.id, c.name condo, to_char(t.booked_on, 'YYYY-MM-DD') booked_on, t.amount, t.description, t.match_reason, t.matched_by,
      (select string_agg(distinct f.designation, ', ') from bank_transaction_matches m join quota_charges q on q.id = m.quota_charge_id
        join fractions f on f.id = q.fraction_id where m.transaction_id = t.id) designations
    from bank_transactions t join condominiums c on c.id = t.condominium_id
    where t.status = 'MATCHED' order by t.created_at desc limit 20`;
  return {
    pending: rows.map((r) => ({ ...r, amountCents: toCents(r.amount), fractions: fractions.filter((f) => f.condominium_id === r.condominium_id) })),
    recent: recent.map((r) => ({ ...r, amountCents: toCents(r.amount) })),
  };
}
