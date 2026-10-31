import "server-only";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { toCents } from "@/lib/money";
import { orderIdFor, paymentsProvider } from "@/lib/payments";

type PendingCharge = {
  id: string;
  order_seq: string;
  amount_total: string;
  description: string;
  ifthenpay_mb_key: string | null;
};

/**
 * Zero-touch: issue Multibanco references for every pending charge of a
 * condominium that is due within `horizonDays` and has none yet.
 */
export async function issueMultibancoReferences(condominiumId: string, horizonDays = 45) {
  const charges = await sql<PendingCharge[]>`
    select q.id, q.order_seq, q.amount_total, q.description, c.ifthenpay_mb_key
    from quota_charges q join condominiums c on c.id = q.condominium_id
    where q.condominium_id = ${condominiumId}
      and q.payment_status = 'PENDING'
      and q.mb_reference is null
      and q.due_date <= current_date + ${horizonDays}::int
    order by q.due_date`;

  const provider = paymentsProvider();
  const expiryDays = env().IFTHENPAY_MB_EXPIRY_DAYS;
  let issued = 0;
  const errors: string[] = [];
  // Small fixed concurrency keeps us polite with the provider's rate limits.
  const queue = [...charges];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        try {
          const ref = await provider.createMultibancoReference({
            orderId: orderIdFor(c.order_seq),
            amountCents: toCents(c.amount_total),
            description: c.description,
            expiryDays,
            mbKey: c.ifthenpay_mb_key,
          });
          await sql`
            update quota_charges
            set mb_entity = ${ref.entity}, mb_reference = ${ref.reference}, mb_request_id = ${ref.requestId}
            where id = ${c.id} and mb_reference is null`;
          issued++;
        } catch (e) {
          errors.push(`${c.description}: ${(e as Error).message}`);
        }
      }
    }),
  );
  return { candidates: charges.length, issued, errors };
}

/** Send an MB WAY push to the fraction owner's phone for a single charge. */
export async function requestMbWayForCharge(chargeId: string) {
  const [c] = await sql<
    (PendingCharge & { ifthenpay_mbway_key: string | null; phone_number: string | null; email: string | null; payment_status: string })[]
  >`
    select q.id, q.order_seq, q.amount_total, q.description, q.payment_status,
           c.ifthenpay_mb_key, c.ifthenpay_mbway_key, r.phone_number, r.email
    from quota_charges q
    join condominiums c on c.id = q.condominium_id
    left join lateral (
      select phone_number, email from residents
      where fraction_id = q.fraction_id and role = 'Proprietário'
      order by created_at limit 1
    ) r on true
    where q.id = ${chargeId}`;
  if (!c) throw new Error("Charge not found");
  if (c.payment_status !== "PENDING") throw new Error("Charge is not pending");
  if (!c.phone_number) throw new Error("Fraction has no owner phone number");

  const res = await paymentsProvider().requestMbWay({
    orderId: orderIdFor(c.order_seq),
    amountCents: toCents(c.amount_total),
    description: c.description,
    phone: c.phone_number,
    email: c.email,
    mbWayKey: c.ifthenpay_mbway_key,
  });
  await sql`update quota_charges set mbway_request_id = ${res.requestId} where id = ${chargeId}`;
  return res;
}
