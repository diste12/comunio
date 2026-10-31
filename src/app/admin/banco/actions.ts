"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { parseStatementCsv } from "@/lib/bank/csv";
import { assignToFraction, confirmSuggestion, ignoreTransaction, importTransactions, reconcileCondominium, syncBank } from "@/lib/services/bank";
import type { ActionState } from "../actions";

async function run(fn: () => Promise<string>): Promise<ActionState> {
  try {
    const message = await fn();
    revalidatePath("/admin/banco");
    return { ok: true, message };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

const summary = (r: { auto: number; suggested: number; unmatched: number }) =>
  `${r.auto} conciliados automaticamente, ${r.suggested} sugestões, ${r.unmatched} por identificar.`;

export async function syncBankAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = z.uuid().safeParse(form.get("condominiumId"));
  if (!id.success) return { ok: false, message: "Escolha um condomínio." };
  return run(async () => {
    const r = await syncBank(id.data);
    return `${r.inserted} movimentos novos. ${summary(r)}`;
  });
}

export async function importCsvAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = z.uuid().safeParse(form.get("condominiumId"));
  const file = form.get("file");
  if (!id.success || !(file instanceof File) || file.size === 0) return { ok: false, message: "Escolha o condomínio e o extrato (CSV)." };
  if (file.size > 2 * 1024 * 1024) return { ok: false, message: "Extrato acima de 2 MB." };
  return run(async () => {
    const lines = parseStatementCsv(await file.text());
    const { inserted } = await importTransactions(id.data, "CSV", lines);
    return `${lines.length} créditos lidos, ${inserted} novos. ${summary(await reconcileCondominium(id.data))}`;
  });
}

export async function confirmSuggestionAction(transactionId: string): Promise<ActionState> {
  const admin = await requireAdmin();
  return run(() => confirmSuggestion(z.uuid().parse(transactionId), admin.email ?? admin.userId).then(() => "Conciliado."));
}

export async function assignAction(transactionId: string, fractionId: string): Promise<ActionState> {
  const admin = await requireAdmin();
  return run(() => assignToFraction(z.uuid().parse(transactionId), z.uuid().parse(fractionId), admin.email ?? admin.userId).then(() => "Conciliado."));
}

export async function ignoreAction(transactionId: string): Promise<ActionState> {
  const admin = await requireAdmin();
  return run(() => ignoreTransaction(z.uuid().parse(transactionId), admin.email ?? admin.userId).then(() => "Ignorado."));
}
