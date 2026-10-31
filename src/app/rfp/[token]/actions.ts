"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseEuroInput } from "@/lib/money";
import { submitInvoice, submitQuote } from "@/lib/services/rfps";

export type VendorState = { ok: boolean; message: string } | null;

const quoteSchema = z.object({
  token: z.string().min(10).max(64),
  amount: z.string(),
  leadTimeDays: z.coerce.number().int().min(0).max(365),
  warrantyMonths: z.coerce.number().int().min(0).max(120),
  notes: z.string().max(2000),
});

export async function submitQuoteAction(_prev: VendorState, form: FormData): Promise<VendorState> {
  const parsed = quoteSchema.safeParse(Object.fromEntries(form));
  const amount = parsed.success ? parseEuroInput(parsed.data.amount) : null;
  if (!parsed.success || !amount) return { ok: false, message: "Verifique o valor e os prazos." };
  try {
    await submitQuote(parsed.data.token, {
      amountCents: amount, leadTimeDays: parsed.data.leadTimeDays, warrantyMonths: parsed.data.warrantyMonths,
      notes: parsed.data.notes.trim() || null,
    });
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  revalidatePath(`/rfp/${parsed.data.token}`);
  return { ok: true, message: "Orçamento submetido. Obrigado!" };
}

const invoiceSchema = z.object({ token: z.string().min(10).max(64), number: z.string().trim().min(1).max(60), amount: z.string() });

export async function submitInvoiceAction(_prev: VendorState, form: FormData): Promise<VendorState> {
  const parsed = invoiceSchema.safeParse(Object.fromEntries(form));
  const amount = parsed.success ? parseEuroInput(parsed.data.amount) : null;
  if (!parsed.success || !amount) return { ok: false, message: "Indique o número e o valor da fatura." };
  try {
    await submitInvoice(parsed.data.token, { number: parsed.data.number, amountCents: amount });
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  revalidatePath(`/rfp/${parsed.data.token}`);
  return { ok: true, message: "Fatura submetida para aprovação." };
}
