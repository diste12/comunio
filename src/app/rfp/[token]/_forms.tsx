"use client";

import { useActionState } from "react";
import { submitInvoiceAction, submitQuoteAction } from "./actions";

const field = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm";

export function QuoteForm({ token, initial }: { token: string; initial: { amount?: string; lead?: number; warranty?: number; notes?: string } }) {
  const [state, action, pending] = useActionState(submitQuoteAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <label className="block text-sm font-medium">Valor total (€, com IVA)<input name="amount" required inputMode="decimal" defaultValue={initial.amount} placeholder="1.250,00" className={field} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium">Prazo de execução (dias)<input name="leadTimeDays" type="number" min={0} required defaultValue={initial.lead ?? 7} className={field} /></label>
        <label className="block text-sm font-medium">Garantia (meses)<input name="warrantyMonths" type="number" min={0} required defaultValue={initial.warranty ?? 12} className={field} /></label>
      </div>
      <label className="block text-sm font-medium">Notas<textarea name="notes" rows={3} defaultValue={initial.notes} className={field} /></label>
      <button disabled={pending} className="w-full rounded-lg bg-brand-600 py-2.5 font-medium text-white disabled:opacity-50">
        {initial.amount ? "Atualizar orçamento" : "Submeter orçamento"}
      </button>
      {state && <p className={`text-sm ${state.ok ? "text-brand-700" : "text-red-700"}`}>{state.message}</p>}
    </form>
  );
}

export function InvoiceForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(submitInvoiceAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium">N.º da fatura<input name="number" required className={field} /></label>
        <label className="block text-sm font-medium">Valor (€)<input name="amount" required inputMode="decimal" className={field} /></label>
      </div>
      <button disabled={pending} className="w-full rounded-lg bg-brand-600 py-2.5 font-medium text-white disabled:opacity-50">Submeter fatura</button>
      {state && <p className={`text-sm ${state.ok ? "text-brand-700" : "text-red-700"}`}>{state.message}</p>}
    </form>
  );
}
