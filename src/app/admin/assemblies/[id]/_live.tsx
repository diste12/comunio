"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import type { ActionState } from "../../actions";
import {
  castVoteAction,
  saveMinutesAction,
  saveTranscriptAction,
  setAttendanceAction,
} from "../actions";

/** Keeps every screen in the room (admin laptop, projector) in sync. */
export function AutoRefresh({ seconds = 3 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return <span className="text-xs text-brand-700">● ao vivo</span>;
}

function useAct() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionState>) =>
    start(async () => {
      const r = await fn();
      setError(r && !r.ok ? r.message : null);
    });
  return { pending, error, run };
}

export function AttendanceControl({
  assemblyId, fractionId, mode, representative, disabled,
}: { assemblyId: string; fractionId: string; mode: string; representative: string | null; disabled: boolean }) {
  const { pending, error, run } = useAct();
  const [rep, setRep] = useState(representative ?? "");
  return (
    <div className="flex items-center gap-2">
      <select
        disabled={disabled || pending}
        value={mode}
        onChange={(e) => run(() => setAttendanceAction(assemblyId, fractionId, e.target.value, rep))}
        className={`rounded border px-1.5 py-1 text-xs ${mode === "ABSENT" ? "border-stone-200 text-stone-500" : "border-brand-600 bg-brand-50 text-brand-900"}`}
      >
        <option value="ABSENT">Ausente</option>
        <option value="PRESENT">Presente</option>
        <option value="ONLINE">Online</option>
        <option value="REPRESENTED">Representado</option>
      </select>
      {mode === "REPRESENTED" && (
        <input
          value={rep}
          disabled={disabled}
          onChange={(e) => setRep(e.target.value)}
          onBlur={() => rep !== (representative ?? "") && run(() => setAttendanceAction(assemblyId, fractionId, "REPRESENTED", rep))}
          placeholder="Procurador"
          className="w-28 rounded border border-stone-300 px-1.5 py-1 text-xs"
        />
      )}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

const VOTES = [
  ["FAVOR", "Favor", "bg-brand-600 text-white"],
  ["CONTRA", "Contra", "bg-red-600 text-white"],
  ["ABSTENCAO", "Abst.", "bg-stone-500 text-white"],
] as const;

export function VoteButtons({
  assemblyId, itemId, fractionId, current, disabled,
}: { assemblyId: string; itemId: string; fractionId: string; current: string | null; disabled: boolean }) {
  const { pending, error, run } = useAct();
  return (
    <span className="inline-flex items-center gap-1">
      {VOTES.map(([v, label, active]) => (
        <button
          key={v}
          disabled={disabled || pending}
          onClick={() => run(() => castVoteAction(assemblyId, itemId, fractionId, current === v ? "CLEAR" : v))}
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ring-stone-300 disabled:opacity-40 ${current === v ? active : "bg-white text-stone-700 hover:bg-stone-50"}`}
        >
          {label}
        </button>
      ))}
      {error && <span className="text-[11px] text-red-700">{error}</span>}
    </span>
  );
}

export function TranscriptEditor({ assemblyId, transcript }: { assemblyId: string; transcript: string }) {
  const [state, action, pending] = useActionState(saveTranscriptAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="assemblyId" value={assemblyId} />
      <textarea
        name="transcript"
        defaultValue={transcript}
        key={transcript.length}
        rows={8}
        placeholder="Transcrição da reunião (gerada a partir do áudio ou colada manualmente)"
        className="w-full rounded-md border border-stone-300 p-2 font-mono text-xs"
      />
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50">
          Guardar transcrição
        </button>
        {state && <span className={`text-xs ${state.ok ? "text-brand-700" : "text-red-700"}`}>{state.message}</span>}
      </div>
    </form>
  );
}

export function AudioUpload({ assemblyId }: { assemblyId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function upload() {
    const files = Array.from(input.current?.files ?? []);
    if (files.length === 0) return;
    setBusy(true);
    for (const [i, file] of files.entries()) {
      setStatus(`A transcrever ${i + 1}/${files.length}: ${file.name}…`);
      const body = new FormData();
      body.append("audio", file);
      const res = await fetch(`/admin/assemblies/${assemblyId}/transcricao`, { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { error?: string; mock?: boolean };
      if (!res.ok) {
        setStatus(`Erro: ${json.error ?? res.status}`);
        setBusy(false);
        return;
      }
      if (json.mock) setStatus("Transcrição simulada (sem OPENAI_API_KEY).");
    }
    setStatus((s) => (s?.startsWith("Transcrição simulada") ? s : "Transcrição concluída."));
    setBusy(false);
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input ref={input} type="file" accept="audio/*,video/mp4" multiple className="text-sm" />
      <button onClick={upload} disabled={busy} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
        Transcrever (Whisper)
      </button>
      {status && <span className="text-xs text-stone-600">{status}</span>}
    </div>
  );
}

export function MinutesEditor({ assemblyId, body, readOnly }: { assemblyId: string; body: string; readOnly: boolean }) {
  const [state, action, pending] = useActionState(saveMinutesAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="assemblyId" value={assemblyId} />
      <textarea
        name="body"
        defaultValue={body}
        key={body}
        readOnly={readOnly}
        rows={24}
        className="w-full rounded-md border border-stone-300 p-3 font-mono text-xs leading-relaxed"
      />
      {!readOnly && (
        <div className="flex items-center gap-3">
          <button disabled={pending} className="rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50">
            Guardar alterações
          </button>
          {state && <span className={`text-xs ${state.ok ? "text-brand-700" : "text-red-700"}`}>{state.message}</span>}
        </div>
      )}
    </form>
  );
}
