"use client";

import { useActionState } from "react";
import { generateQuotasAction } from "../actions";

const field = "mt-1 w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-sm";

export function BudgetForm({ condominiumId, defaultYear }: { condominiumId: string; defaultYear: number }) {
  const [state, formAction, pending] = useActionState(generateQuotasAction, null);
  return (
    <form action={formAction} className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <input type="hidden" name="condominiumId" value={condominiumId} />
      <label className="text-xs font-medium text-stone-600">
        Ano
        <input name="fiscalYear" type="number" defaultValue={defaultYear} className={field} required />
      </label>
      <label className="text-xs font-medium text-stone-600 sm:col-span-2">
        Orçamento anual (despesas correntes, €)
        <input name="budget" inputMode="decimal" placeholder="10.000,00" className={field} required />
      </label>
      <label className="text-xs font-medium text-stone-600">
        Fundo comum de reserva (%)
        <input name="reservePct" type="number" min={10} step="0.5" defaultValue={10} className={field} required />
      </label>
      <label className="text-xs font-medium text-stone-600">
        Prestações
        <select name="installments" defaultValue="12" className={field}>
          <option value="12">Mensal (12)</option>
          <option value="4">Trimestral (4)</option>
          <option value="2">Semestral (2)</option>
          <option value="1">Anual (1)</option>
        </select>
      </label>
      <label className="text-xs font-medium text-stone-600">
        Dia de vencimento
        <input name="dueDay" type="number" min={1} max={31} defaultValue={8} className={field} required />
      </label>
      <div className="col-span-2 flex items-end gap-3 sm:col-span-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {pending ? "A gerar…" : "Gerar quotas"}
        </button>
        {state && <span className={`text-sm ${state.ok ? "text-brand-700" : "text-red-700"}`}>{state.message}</span>}
      </div>
      <p className="col-span-2 text-xs text-stone-500 sm:col-span-5">
        As quotas são repartidas pela permilagem de cada fração. O fundo comum de reserva (mínimo 10%, DL 268/94,
        art. 4.º) é acrescido à quota de cada condómino.
      </p>
    </form>
  );
}
