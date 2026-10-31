"use client";

import { useActionState, useState, useTransition } from "react";
import { MAINTENANCE_CATEGORIES } from "@/lib/triage/rules";
import { payWithMbWay, reportIssue, type PortalState } from "./actions";

export function MbWayButton({ chargeId }: { chargeId: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<PortalState>(null);
  return (
    <div className="mt-2">
      <button
        disabled={pending}
        onClick={() => start(async () => setState(await payWithMbWay(chargeId)))}
        className="w-full rounded-lg bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
      >
        {pending ? "A enviar…" : "Pagar com MB WAY"}
      </button>
      {state && <p className={`mt-1 text-xs ${state.ok ? "text-brand-700" : "text-red-700"}`}>{state.message}</p>}
    </div>
  );
}

export function ReportIssueForm() {
  const [state, action, pending] = useActionState(reportIssue, null);
  return (
    <form action={action} className="space-y-2">
      <select name="category" className="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm" defaultValue="Outro">
        {MAINTENANCE_CATEGORIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <textarea
        name="description"
        required
        minLength={5}
        rows={3}
        placeholder="O que se passa e onde?"
        className="w-full rounded-lg border border-stone-300 p-2 text-sm"
      />
      <button disabled={pending} className="w-full rounded-lg bg-brand-600 py-2 text-sm font-medium text-white disabled:opacity-50">
        {pending ? "A enviar…" : "Reportar problema"}
      </button>
      {state && <p className={`text-xs ${state.ok ? "text-brand-700" : "text-red-700"}`}>{state.message}</p>}
    </form>
  );
}
