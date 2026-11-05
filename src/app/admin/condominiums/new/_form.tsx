"use client";

import { useActionState, useEffect, useRef } from "react";
import { createCondominiumAction, type OnboardingField } from "../actions";

const field = "mt-1 block w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-sm";

export function NewCondominiumForm({ template }: { template: string }) {
  const [state, action, pending] = useActionState(createCondominiumAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state || state.ok) return;
    const target = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?? formRef.current?.querySelector<HTMLElement>('[role="alert"]');
    target?.focus();
  }, [state]);
  const invalid = (name: OnboardingField) => ({
    "aria-invalid": Boolean(state?.fieldErrors?.[name]),
    "aria-describedby": state?.fieldErrors?.[name] ? `${name}-error` : undefined,
  });
  const error = (name: OnboardingField) => state?.fieldErrors?.[name]
    ? <span id={`${name}-error`} className="mt-1 block text-xs text-red-700">{state.fieldErrors[name]}</span>
    : null;
  return (
    // React resets uncontrolled fields after any resolved action, including validation failures.
    // Success redirects away; keep text and the selected File intact on every error.
    <form ref={formRef} action={action} onReset={(event) => event.preventDefault()} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-stone-600 sm:col-span-2">Nome<input name="name" {...invalid("name")} required placeholder="Condomínio Rua …" className={field} />{error("name")}</label>
        <label className="text-xs font-medium text-stone-600">NIF do condomínio<input name="nif" {...invalid("nif")} required inputMode="numeric" className={field} />{error("nif")}</label>
        <label className="text-xs font-medium text-stone-600 sm:col-span-2">Morada<input name="address" className={field} /></label>
        <label className="text-xs font-medium text-stone-600">Código postal<input name="postalCode" placeholder="1000-001" className={field} /></label>
        <label className="text-xs font-medium text-stone-600">Localidade<input name="city" className={field} /></label>
        <label className="text-xs font-medium text-stone-600 sm:col-span-2">IBAN<input name="iban" {...invalid("iban")} placeholder="PT50…" className={field} />{error("iban")}</label>
      </div>
      <div>
        <label htmlFor="onboarding-file" className="text-xs font-medium text-stone-600">Frações e residentes (CSV com <code>;</code>) — carregue um ficheiro ou cole abaixo</label>
        <input id="onboarding-file" type="file" name="file" {...invalid("file")} accept=".csv,text/csv" className="mt-1 text-sm" />
        {error("file")}
        <label htmlFor="onboarding-csv" className="sr-only">Dados das frações em CSV</label>
        <textarea id="onboarding-csv" name="csv" {...invalid("csv")} rows={7} defaultValue={template} className="mt-2 w-full rounded-md border border-stone-300 p-2 font-mono text-xs" />
        {error("csv")}
      </div>
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "A importar…" : "Criar condomínio"}
        </button>
        {state && !state.ok && <span role="alert" tabIndex={-1} className="text-sm text-red-700">{state.message}</span>}
      </div>
      {state?.errors && state.errors.length > 0 && (
        <ul className="list-inside list-disc rounded-md bg-red-50 p-3 text-xs text-red-800">{state.errors.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
      {state?.warnings && state.warnings.length > 0 && (
        <ul className="list-inside list-disc rounded-md bg-amber-50 p-3 text-xs text-amber-900">{state.warnings.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
    </form>
  );
}
