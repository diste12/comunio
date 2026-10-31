"use client";

import { useState, useTransition } from "react";
import type { ActionState } from "../actions";

export function ActionButton({
  action,
  label,
  pendingLabel = "A processar…",
  variant = "primary",
}: {
  action: () => Promise<ActionState>;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "link";
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState>(null);
  const styles = {
    primary: "rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700",
    secondary: "rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-stone-50",
    link: "text-xs font-medium text-brand-700 hover:underline",
  }[variant];
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        className={`${styles} disabled:opacity-50`}
        onClick={() => start(async () => setResult(await action()))}
      >
        {pending ? pendingLabel : label}
      </button>
      {result && (
        <span className={`text-xs ${result.ok ? "text-brand-700" : "text-red-700"}`}>{result.message}</span>
      )}
    </span>
  );
}
