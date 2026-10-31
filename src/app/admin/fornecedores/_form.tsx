"use client";

import { useActionState } from "react";
import { MAINTENANCE_CATEGORIES } from "@/lib/triage/rules";
import { createVendorAction } from "../tickets/actions";

const field = "mt-1 block w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm";

export function VendorForm() {
  const [state, action, pending] = useActionState(createVendorAction, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-4">
      <label className="text-xs font-medium text-stone-600">Nome<input name="name" required className={field} /></label>
      <label className="text-xs font-medium text-stone-600">NIF<input name="nif" className={field} /></label>
      <label className="text-xs font-medium text-stone-600">Email<input name="email" type="email" className={field} /></label>
      <label className="text-xs font-medium text-stone-600">Telefone<input name="phone" className={field} /></label>
      <fieldset className="flex flex-wrap gap-3 text-xs sm:col-span-4">
        {MAINTENANCE_CATEGORIES.map((c) => (
          <label key={c} className="flex items-center gap-1"><input type="checkbox" name="categories" value={c} /> {c}</label>
        ))}
      </fieldset>
      <div className="flex items-center gap-3 sm:col-span-4">
        <button disabled={pending} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Adicionar fornecedor</button>
        {state && <span className={`text-xs ${state.ok ? "text-brand-700" : "text-red-700"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
