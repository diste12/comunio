"use client";

import { useActionState, useState } from "react";
import { createAssemblyAction } from "../actions";

const field = "mt-1 block w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-sm";
const DEFAULT_ITEMS: [string, string][] = [
  ["Apreciação e votação das contas do exercício anterior", "SIMPLE"],
  ["Apreciação e votação do orçamento para o próximo exercício", "SIMPLE"],
  ["Eleição do administrador", "SIMPLE"],
  ["Outros assuntos de interesse geral", "SIMPLE"],
];

export function NewAssemblyForm({ condominiumId, defaultDate }: { condominiumId: string; defaultDate: string }) {
  const [state, action, pending] = useActionState(createAssemblyAction, null);
  const [items, setItems] = useState(DEFAULT_ITEMS);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="condominiumId" value={condominiumId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-stone-600">
          Tipo
          <select name="kind" className={field}>
            <option value="ORDINARIA">Ordinária</option>
            <option value="EXTRAORDINARIA">Extraordinária</option>
          </select>
        </label>
        <label className="text-xs font-medium text-stone-600">
          1.ª convocatória (hora de Lisboa)
          <input type="datetime-local" name="scheduledAt" defaultValue={defaultDate} required className={field} />
        </label>
        <label className="text-xs font-medium text-stone-600">
          2.ª convocatória (opcional; por omissão +7 dias)
          <input type="datetime-local" name="secondCallAt" className={field} />
        </label>
        <label className="text-xs font-medium text-stone-600 sm:col-span-2">
          Local
          <input name="location" required defaultValue="Hall de entrada do prédio" className={field} />
        </label>
        <label className="text-xs font-medium text-stone-600">
          Link de videoconferência (opcional)
          <input name="onlineUrl" type="url" placeholder="https://meet…" className={field} />
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-stone-600">Ordem de trabalhos</legend>
        {items.map(([title, majority], i) => (
          <div key={i} className="flex gap-2">
            <span className="w-6 pt-2 text-right text-sm text-stone-500">{i + 1}.</span>
            <input name="itemTitle" defaultValue={title} className="flex-1 rounded-md border border-stone-300 px-2.5 py-1.5 text-sm" />
            <select name="itemMajority" defaultValue={majority} className="rounded-md border border-stone-300 px-2 text-sm">
              <option value="SIMPLE">Maioria simples</option>
              <option value="TWO_THIRDS">2/3 do capital</option>
              <option value="UNANIMITY">Unanimidade</option>
            </select>
          </div>
        ))}
        <button type="button" onClick={() => setItems([...items, ["", "SIMPLE"]])} className="ml-8 text-xs text-brand-700 hover:underline">
          + Adicionar ponto
        </button>
      </fieldset>
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "A criar…" : "Criar assembleia"}
        </button>
        {state && !state.ok && <span className="text-sm text-red-700">{state.message}</span>}
      </div>
    </form>
  );
}
