"use client";

import { useActionState, useTransition } from "react";
import { addResidentAction, removeResidentAction, updateResidentAction } from "../../actions";

const input = "w-full rounded border border-stone-300 px-1.5 py-1 text-xs";

export type ResidentView = {
  id: string; designation: string; fullName: string; phone: string; email: string; nif: string;
  role: string; consent: boolean; consentAt: string | null;
};

export function ResidentRow({ condominiumId, r }: { condominiumId: string; r: ResidentView }) {
  const [state, action, pending] = useActionState(updateResidentAction.bind(null, condominiumId, r.id), null);
  const [removing, startRemove] = useTransition();
  return (
    <form action={action} className="grid grid-cols-[60px_1.4fr_1fr_1.4fr_1fr_150px_auto] items-center gap-2 border-b border-stone-100 px-3 py-2">
      <span className="text-sm font-medium">{r.designation}<span className="block text-[10px] font-normal text-stone-500">{r.role}</span></span>
      <input name="fullName" defaultValue={r.fullName} className={input} />
      <input name="phone" defaultValue={r.phone} className={`${input} font-mono`} />
      <input name="email" type="email" defaultValue={r.email} className={input} />
      <input name="nif" defaultValue={r.nif} className={`${input} font-mono`} />
      <label className="flex flex-col text-xs">
        <span className="flex items-center gap-1"><input type="checkbox" name="emailConsent" defaultChecked={r.consent} disabled={r.role !== "Proprietário"} /> email (Lei 8/2022)</span>
        {r.consentAt && <span className="text-[10px] text-stone-500">registado {r.consentAt}</span>}
      </label>
      <span className="flex items-center gap-2 whitespace-nowrap">
        <button disabled={pending} className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">Guardar</button>
        <button
          type="button"
          disabled={removing}
          onClick={() => confirm(`Remover ${r.fullName}?`) && startRemove(async () => void (await removeResidentAction(condominiumId, r.id)))}
          className="text-xs text-red-700 hover:underline"
        >
          Remover
        </button>
        {state && <span className={`text-[11px] ${state.ok ? "text-brand-700" : "text-red-700"}`}>{state.message}</span>}
      </span>
    </form>
  );
}

export function AddResidentForm({ condominiumId, fractions }: { condominiumId: string; fractions: { id: string; designation: string }[] }) {
  const [state, action, pending] = useActionState(addResidentAction.bind(null, condominiumId), null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 text-xs">
      <select name="fractionId" className="rounded border border-stone-300 px-1.5 py-1">
        {fractions.map((f) => <option key={f.id} value={f.id}>{f.designation}</option>)}
      </select>
      <select name="role" className="rounded border border-stone-300 px-1.5 py-1">
        <option>Proprietário</option>
        <option>Inquilino</option>
      </select>
      <input name="fullName" placeholder="Nome" required className="rounded border border-stone-300 px-1.5 py-1" />
      <input name="phone" placeholder="Telemóvel" required className="rounded border border-stone-300 px-1.5 py-1 font-mono" />
      <input name="email" type="email" placeholder="Email" className="rounded border border-stone-300 px-1.5 py-1" />
      <label className="flex items-center gap-1"><input type="checkbox" name="emailConsent" /> consente email</label>
      <button disabled={pending} className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">Adicionar</button>
      {state && <span className={state.ok ? "text-brand-700" : "text-red-700"}>{state.message}</span>}
    </form>
  );
}
