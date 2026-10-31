"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { MAINTENANCE_CATEGORIES } from "@/lib/triage/rules";
import { checkInAction, payWithMbWay, reportIssue, voteAction, type PortalState } from "./actions";

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

export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}

export function CheckInButton() {
  const [pending, start] = useTransition();
  const [state, setState] = useState<PortalState>(null);
  return (
    <div>
      <button
        disabled={pending}
        onClick={() => start(async () => setState(await checkInAction()))}
        className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Registar presença online
      </button>
      {state && !state.ok && <p className="mt-1 text-xs text-red-700">{state.message}</p>}
    </div>
  );
}

const CHOICES = [
  ["FAVOR", "A favor", "bg-brand-600"],
  ["CONTRA", "Contra", "bg-red-600"],
  ["ABSTENCAO", "Abstenção", "bg-stone-500"],
] as const;

export function OwnerVote({ itemId, current }: { itemId: string; current: string | null }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<PortalState>(null);
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {CHOICES.map(([v, label, color]) => (
          <button
            key={v}
            disabled={pending}
            onClick={() => start(async () => setState(await voteAction(itemId, v)))}
            className={`rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50 ${
              current === v ? `${color} text-white` : "border border-stone-300 bg-white text-stone-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {state && !state.ok && <p className="mt-1 text-xs text-red-700">{state.message}</p>}
    </div>
  );
}
