"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { isValidNif } from "@/lib/pt/nif";
import { awardQuote, createVendor, decideInvoice, requestQuotes, simulateVendorQuotes } from "@/lib/services/rfps";
import { MAINTENANCE_CATEGORIES } from "@/lib/triage/rules";
import type { ActionState } from "../actions";

const path = (id: string) => `/admin/tickets/${id}`;

async function run(ticketId: string, fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const message = await fn();
    revalidatePath(path(ticketId));
    return { ok: true, message: message || "Feito." };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

const STATUSES = ["OPEN", "IN_PROGRESS", "AWAITING_QUOTES", "RESOLVED", "CLOSED"] as const;

export async function setTicketStatusAction(ticketId: string, status: string): Promise<ActionState> {
  await requireAdmin();
  const s = z.enum(STATUSES).parse(status);
  return run(ticketId, async () => {
    await sql`update maintenance_tickets set status = ${s}, updated_at = now() where id = ${z.uuid().parse(ticketId)}`;
  });
}

const rfpSchema = z.object({
  ticketId: z.uuid(),
  scope: z.string().trim().min(10),
  deadline: z.iso.date(),
});

export async function requestQuotesAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = rfpSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Descreva o trabalho (mín. 10 caracteres) e indique o prazo." };
  return run(parsed.data.ticketId, async () => {
    const r = await requestQuotes(parsed.data.ticketId, { scope: parsed.data.scope, deadline: parsed.data.deadline });
    return `Pedido enviado a ${r.links.map((l) => l.vendor).join(", ")}.`;
  });
}

export async function simulateQuotesAction(ticketId: string, rfpId: string): Promise<ActionState> {
  await requireAdmin();
  if (env().EMAIL_PROVIDER !== "mock") return { ok: false, message: "Só disponível em modo mock." };
  return run(ticketId, async () => `${await simulateVendorQuotes(z.uuid().parse(rfpId))} propostas simuladas.`);
}

export async function awardQuoteAction(ticketId: string, rfpId: string, quoteId: string): Promise<ActionState> {
  await requireAdmin();
  return run(ticketId, () => awardQuote(z.uuid().parse(rfpId), z.uuid().parse(quoteId)).then(() => "Adjudicado."));
}

export async function decideInvoiceAction(ticketId: string, invoiceId: string, approve: boolean): Promise<ActionState> {
  const admin = await requireAdmin();
  return run(ticketId, () =>
    decideInvoice(z.uuid().parse(invoiceId), approve, admin.email ?? admin.userId).then(() => (approve ? "Pagamento aprovado." : "Fatura rejeitada.")),
  );
}

const vendorSchema = z.object({
  name: z.string().trim().min(2),
  nif: z.string().trim().refine((v) => v === "" || isValidNif(v), "NIF inválido"),
  email: z.email().or(z.literal("")),
  phone: z.string().trim(),
});

export async function createVendorAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = vendorSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const categories = form.getAll("categories").map(String).filter((c) => (MAINTENANCE_CATEGORIES as readonly string[]).includes(c));
  await createVendor({
    name: parsed.data.name, nif: parsed.data.nif || null, email: parsed.data.email || null,
    phone: parsed.data.phone.replace(/\D/g, "") || null, categories,
  });
  revalidatePath("/admin/fornecedores");
  return { ok: true, message: "Fornecedor registado." };
}
