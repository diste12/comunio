"use client";

import { useActionState } from "react";
import { saveSettingsAction } from "../../actions";

const field = "mt-1 block w-full rounded-md border border-stone-300 px-2.5 py-1.5 font-mono text-sm";

export type SettingsValues = Record<
  "iban" | "ifthenpayMbKey" | "ifthenpayMbwayKey" | "moloniCompanyId" | "moloniDocumentSetId" | "moloniProductId" | "saltedgeConnectionId" | "saltedgeAccountId",
  string
>;

export function SettingsForm({ condominiumId, values }: { condominiumId: string; values: SettingsValues }) {
  const [state, action, pending] = useActionState(saveSettingsAction, null);
  const input = (name: keyof SettingsValues, label: string) => (
    <label className="text-xs font-medium text-stone-600">
      {label}
      <input name={name} defaultValue={values[name]} className={field} />
    </label>
  );
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="condominiumId" value={condominiumId} />
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold">Banco</legend>
        {input("iban", "IBAN do condomínio")}
        <span />
        {input("saltedgeConnectionId", "Salt Edge — connection id")}
        {input("saltedgeAccountId", "Salt Edge — account id")}
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold">Ifthenpay</legend>
        {input("ifthenpayMbKey", "Chave Multibanco (MB key)")}
        {input("ifthenpayMbwayKey", "Chave MB WAY")}
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-semibold">Moloni (empresa deste NIF)</legend>
        {input("moloniCompanyId", "company_id")}
        {input("moloniDocumentSetId", "document_set_id")}
        {input("moloniProductId", "product_id (quota)")}
      </fieldset>
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Guardar</button>
        {state && <span className={`text-sm ${state.ok ? "text-brand-700" : "text-red-700"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
