"use client";

import { useActionState, useTransition } from "react";
import { requestQuotesAction, setTicketStatusAction } from "../actions";

export function RequestQuotesForm({ ticketId, defaultScope, defaultDeadline }: { ticketId: string; defaultScope: string; defaultDeadline: string }) {
  const [state, action, pending] = useActionState(requestQuotesAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="ticketId" value={ticketId} />
      <textarea name="scope" defaultValue={defaultScope} rows={3} className="w-full rounded-md border border-stone-300 p-2 text-sm" />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-stone-600">
          Prazo de resposta
          <input type="date" name="deadline" defaultValue={defaultDeadline} className="mt-1 block rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
        </label>
        <button disabled={pending} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "A enviar…" : "Pedir 3 orçamentos"}
        </button>
        {state && <span className={`text-xs ${state.ok ? "text-brand-700" : "text-red-700"}`}>{state.message}</span>}
      </div>
    </form>
  );
}

const LABELS: Record<string, string> = {
  OPEN: "Aberta", IN_PROGRESS: "Em resolução", AWAITING_QUOTES: "A aguardar orçamentos", RESOLVED: "Resolvida", CLOSED: "Fechada",
};

export function StatusSelect({ ticketId, status }: { ticketId: string; status: string }) {
  const [pending, start] = useTransition();
  return (
    <select
      value={status}
      disabled={pending}
      onChange={(e) => start(async () => void (await setTicketStatusAction(ticketId, e.target.value)))}
      className="rounded-md border border-stone-300 px-2 py-1 text-sm"
    >
      {Object.entries(LABELS).map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}
