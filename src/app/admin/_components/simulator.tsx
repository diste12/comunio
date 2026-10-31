"use client";

import { useActionState } from "react";
import { simulateWhatsAppAction } from "../actions";

export function WhatsAppSimulator({ defaultPhone }: { defaultPhone?: string }) {
  const [state, action, pending] = useActionState(simulateWhatsAppAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-medium text-stone-600">
        Telefone do residente
        <input name="phone" defaultValue={defaultPhone} required className="mt-1 block w-40 rounded-md border border-stone-300 px-2 py-1.5 font-mono text-sm" />
      </label>
      <label className="min-w-64 flex-1 text-xs font-medium text-stone-600">
        Mensagem recebida
        <input name="text" required placeholder="Ex.: Há uma fuga de água na garagem" className="mt-1 block w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
      </label>
      <button disabled={pending} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
        {pending ? "A processar…" : "Simular mensagem"}
      </button>
      {state && <span className={`text-xs ${state.ok ? "text-brand-700" : "text-red-700"}`}>{state.message}</span>}
    </form>
  );
}
