"use client";

import { useActionState, useState, useTransition } from "react";
import type { ActionState } from "../actions";
import { assignAction, importCsvAction, syncBankAction } from "./actions";

type Condo = { id: string; name: string };
const select = "rounded-md border border-stone-300 px-2 py-1.5 text-sm";

function Result({ state }: { state: ActionState }) {
  return state ? <span className={`text-xs ${state.ok ? "text-brand-700" : "text-red-700"}`}>{state.message}</span> : null;
}

export function SyncForm({ condos, mock }: { condos: Condo[]; mock: boolean }) {
  const [syncState, syncAction, syncing] = useActionState(syncBankAction, null);
  const [csvState, csvAction, importing] = useActionState(importCsvAction, null);
  const [condo, setCondo] = useState(condos[0]?.id ?? "");
  const picker = (
    <select name="condominiumId" value={condo} onChange={(e) => setCondo(e.target.value)} className={`${select} max-w-72`}>
      {condos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
  return (
    <div className="space-y-3">
      <form action={syncAction} className="flex flex-wrap items-center gap-3">
        {picker}
        <button disabled={syncing} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {syncing ? "A sincronizar…" : mock ? "Sincronizar (simulado)" : "Sincronizar (Salt Edge)"}
        </button>
        <Result state={syncState} />
      </form>
      <form action={csvAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="condominiumId" value={condo} />
        <span className="text-sm text-stone-600">ou importar extrato CSV:</span>
        <input type="file" name="file" accept=".csv,text/csv" className="text-sm" />
        <button disabled={importing} className="rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50 disabled:opacity-50">
          Importar
        </button>
        <Result state={csvState} />
      </form>
    </div>
  );
}

export function AssignControl({ transactionId, fractions }: { transactionId: string; fractions: { id: string; designation: string }[] }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <select
        disabled={pending}
        defaultValue=""
        onChange={(e) => e.target.value && start(async () => setState(await assignAction(transactionId, e.target.value)))}
        className="rounded border border-stone-300 px-1.5 py-1 text-xs"
      >
        <option value="">Atribuir a fração…</option>
        {fractions.map((f) => <option key={f.id} value={f.id}>{f.designation}</option>)}
      </select>
      <Result state={state} />
    </span>
  );
}
