import "server-only";
import { sql } from "@/lib/db";
import { billingProvider } from "@/lib/billing";
import { centsToDecimal, toCents } from "@/lib/money";
import { orderIdFor, orderSeqFromOrderId } from "@/lib/payments";
import type { PaymentNotification } from "@/lib/payments/types";

export type ReconcileOutcome = "APPLIED" | "DUPLICATE" | "NOT_FOUND" | "AMOUNT_MISMATCH" | "ALREADY_PAID";

function idempotencyKey(n: PaymentNotification): string {
  return n.requestId ?? `${n.orderId ?? ""}|${n.entity ?? ""}|${n.reference ?? ""}|${n.amountCents}`;
}

/**
 * Apply a provider payment notification to the ledger. Idempotent: replays of
 * the same notification are recorded as DUPLICATE and change nothing.
 */
export async function applyPayment(n: PaymentNotification): Promise<{ outcome: ReconcileOutcome; chargeId: string | null }> {
  const result = await sql.begin(async (tx) => {
    const key = idempotencyKey(n);
    const [seen] = await tx`
      select id from payment_events where provider = ${n.provider} and idempotency_key = ${key}`;
    if (seen) return { outcome: "DUPLICATE" as const, chargeId: null };

    const seq = n.orderId ? orderSeqFromOrderId(n.orderId) : null;
    const [charge] = seq
      ? await tx<{ id: string; amount_total: string; payment_status: string }[]>`
          select id, amount_total, payment_status from quota_charges where order_seq = ${seq} for update`
      : n.entity && n.reference
        ? await tx<{ id: string; amount_total: string; payment_status: string }[]>`
            select id, amount_total, payment_status from quota_charges
            where mb_entity = ${n.entity} and mb_reference = ${n.reference} for update`
        : [];

    let outcome: ReconcileOutcome;
    if (!charge) outcome = "NOT_FOUND";
    else if (charge.payment_status === "PAID") outcome = "ALREADY_PAID";
    else if (toCents(charge.amount_total) !== n.amountCents) outcome = "AMOUNT_MISMATCH";
    else outcome = "APPLIED";

    if (outcome === "APPLIED") {
      await tx`
        update quota_charges
        set payment_status = 'PAID', paid_at = ${n.paidAt}, paid_method = ${n.method}
        where id = ${charge.id}`;
    }
    await tx`
      insert into payment_events ${tx({
        provider: n.provider,
        idempotency_key: key,
        quota_charge_id: charge?.id ?? null,
        amount: centsToDecimal(n.amountCents),
        outcome,
        payload: n.raw,
      })}`;
    return { outcome, chargeId: charge?.id ?? null };
  });
  return result;
}

/**
 * Issue the AT-certified receipt for a paid charge. Failures are stored on the
 * charge (moloni_error) and retried by the cron job; they never un-pay a charge.
 */
export async function issueReceiptForCharge(chargeId: string) {
  const [c] = await sql<
    {
      id: string;
      order_seq: string;
      description: string;
      amount_total: string;
      paid_at: Date;
      paid_method: "MULTIBANCO" | "MBWAY" | "TRANSFER" | "CASH";
      moloni_document_id: string | null;
      moloni_company_id: number | null;
      moloni_document_set_id: number | null;
      moloni_product_id: number | null;
      owner_name: string | null;
      owner_nif: string | null;
      owner_email: string | null;
    }[]
  >`
    select q.id, q.order_seq, q.description, q.amount_total, q.paid_at, q.paid_method, q.moloni_document_id,
           c.moloni_company_id, c.moloni_document_set_id, c.moloni_product_id,
           r.full_name as owner_name, r.nif as owner_nif, r.email as owner_email
    from quota_charges q
    join condominiums c on c.id = q.condominium_id
    left join lateral (
      select full_name, nif, email from residents
      where fraction_id = q.fraction_id and role = 'Proprietário'
      order by created_at limit 1
    ) r on true
    where q.id = ${chargeId} and q.payment_status = 'PAID'`;
  if (!c) throw new Error("Paid charge not found");
  if (c.moloni_document_id) return { documentId: c.moloni_document_id, alreadyIssued: true };

  try {
    const doc = await billingProvider().issueReceipt({
      companyId: c.moloni_company_id,
      documentSetId: c.moloni_document_set_id,
      productId: c.moloni_product_id,
      customer: { name: c.owner_name ?? "Condómino", nif: c.owner_nif, email: c.owner_email },
      description: c.description,
      amountCents: toCents(c.amount_total),
      paidAt: c.paid_at,
      paymentMethod: c.paid_method ?? "MULTIBANCO",
      ourReference: orderIdFor(c.order_seq),
    });
    await sql`
      update quota_charges set moloni_document_id = ${doc.documentId}, moloni_error = null
      where id = ${chargeId} and moloni_document_id is null`;
    return { documentId: doc.documentId, alreadyIssued: false };
  } catch (e) {
    await sql`update quota_charges set moloni_error = ${(e as Error).message} where id = ${chargeId}`;
    throw e;
  }
}

/** Cron: retry receipts for paid charges that still have no Moloni document. */
export async function retryPendingReceipts(limit = 50) {
  const rows = await sql<{ id: string }[]>`
    select id from quota_charges
    where payment_status = 'PAID' and moloni_document_id is null
    order by paid_at limit ${limit}`;
  let issued = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await issueReceiptForCharge(r.id);
      issued++;
    } catch {
      failed++;
    }
  }
  return { attempted: rows.length, issued, failed };
}
