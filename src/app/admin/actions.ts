"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { parseEuroInput, toCents } from "@/lib/money";
import { QuotaEngineError } from "@/lib/quotas/engine";
import { sql } from "@/lib/db";
import { BudgetExistsError, generateQuotas } from "@/lib/services/quotas";
import { issueMultibancoReferences, requestMbWayForCharge } from "@/lib/services/references";
import { applyPayment, issueReceiptForCharge } from "@/lib/services/reconcile";
import { orderIdFor } from "@/lib/payments";

export type ActionState = { ok: boolean; message: string } | null;

const budgetSchema = z.object({
  condominiumId: z.uuid(),
  fiscalYear: z.coerce.number().int().min(2020).max(2100),
  budget: z.string(),
  reservePct: z.coerce.number().min(10).max(100),
  installments: z.coerce.number().int().refine((n) => [1, 2, 4, 6, 12].includes(n)),
  dueDay: z.coerce.number().int().min(1).max(31),
});

const condoPath = (id: string) => `/admin/condominiums/${id}`;

export async function generateQuotasAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = budgetSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Dados do orçamento inválidos." };
  const cents = parseEuroInput(parsed.data.budget);
  if (!cents) return { ok: false, message: "Valor do orçamento inválido." };
  try {
    const { plan } = await generateQuotas(parsed.data.condominiumId, {
      fiscalYear: parsed.data.fiscalYear,
      ordinaryAmountCents: cents,
      reserveFundPct: parsed.data.reservePct,
      installments: parsed.data.installments,
      dueDay: parsed.data.dueDay,
    });
    revalidatePath(condoPath(parsed.data.condominiumId));
    return {
      ok: true,
      message: `${plan.charges.length} quotas geradas para ${parsed.data.fiscalYear}.${plan.warnings.length ? " " + plan.warnings.join(" ") : ""}`,
    };
  } catch (e) {
    if (e instanceof BudgetExistsError || e instanceof QuotaEngineError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function issueReferencesAction(condominiumId: string): Promise<ActionState> {
  await requireAdmin();
  const r = await issueMultibancoReferences(z.uuid().parse(condominiumId));
  revalidatePath(condoPath(condominiumId));
  return {
    ok: r.errors.length === 0,
    message: `${r.issued}/${r.candidates} referências Multibanco emitidas.${r.errors.length ? ` Erros: ${r.errors.slice(0, 3).join("; ")}` : ""}`,
  };
}

export async function requestMbWayAction(chargeId: string): Promise<ActionState> {
  await requireAdmin();
  try {
    const r = await requestMbWayForCharge(z.uuid().parse(chargeId));
    return { ok: r.status === "000", message: `MB WAY: ${r.message}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Dev/demo only: emulate the Ifthenpay callback for a charge. */
export async function simulatePaymentAction(chargeId: string): Promise<ActionState> {
  await requireAdmin();
  if (env().PAYMENTS_PROVIDER !== "mock") return { ok: false, message: "Só disponível em modo mock." };
  const [c] = await sql<{ order_seq: string; amount_total: string; condominium_id: string }[]>`
    select order_seq, amount_total, condominium_id from quota_charges where id = ${z.uuid().parse(chargeId)}`;
  if (!c) return { ok: false, message: "Quota não encontrada." };
  const { outcome } = await applyPayment({
    provider: "mock",
    orderId: orderIdFor(c.order_seq),
    entity: null,
    reference: null,
    requestId: `sim-${chargeId}-${Date.now()}`,
    amountCents: toCents(c.amount_total),
    method: "MBWAY",
    paidAt: new Date(),
    raw: { simulated: "true" },
  });
  if (outcome === "APPLIED") await issueReceiptForCharge(chargeId).catch(() => {});
  revalidatePath(condoPath(c.condominium_id));
  return { ok: outcome === "APPLIED", message: `Pagamento simulado: ${outcome}` };
}

export async function retryReceiptAction(chargeId: string): Promise<ActionState> {
  await requireAdmin();
  try {
    const r = await issueReceiptForCharge(z.uuid().parse(chargeId));
    return { ok: true, message: `Recibo ${r.documentId}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
