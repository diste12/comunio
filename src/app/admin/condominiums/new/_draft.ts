"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

const FIELDS = ["name", "nif", "address", "postalCode", "city", "iban", "csv"] as const;
const MAX_AGE = 24 * 60 * 60 * 1000;
type Draft = { savedAt: number; values: Record<string, string>; upload?: { name: string; text: string } };

/** A per-admin, per-tab draft. A file is restored as editable CSV, never as a fake file selection. */
export function useOnboardingDraft(formRef: RefObject<HTMLFormElement | null>, key: string) {
  const upload = useRef<Draft["upload"]>(undefined);
  const selectedFile = useRef<File | null>(null);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      const draft = JSON.parse(raw) as Draft;
      if (!draft || !Number.isFinite(draft.savedAt) || Date.now() - draft.savedAt > MAX_AGE || !draft.values) {
        sessionStorage.removeItem(key);
        return;
      }
      for (const name of FIELDS) {
        const input = formRef.current?.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
        const value = name === "csv" && typeof draft.upload?.text === "string" ? draft.upload.text : draft.values[name];
        if (input && typeof value === "string") input.value = value;
      }
      // One-time hydration from browser storage; restore only after the form DOM exists.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRestored(true);
    } catch {
      // Storage can be blocked or contain an obsolete draft; editing still works.
    }
  }, [formRef, key]);

  function saveDraft() {
    const form = formRef.current;
    if (!form) return;
    const values = Object.fromEntries(FIELDS.map((name) => {
      const input = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
      return [name, input.value];
    }));
    try {
      sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), values, upload: upload.current } satisfies Draft));
    } catch {
      // Quota/private-mode failures must not interrupt submission or discard the in-memory form.
    }
  }

  function selectFile(file: File | null) {
    selectedFile.current = file;
    upload.current = undefined;
    saveDraft();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (selectedFile.current !== file || !formRef.current || typeof reader.result !== "string") return;
      upload.current = { name: file.name, text: reader.result };
      saveDraft();
    };
    reader.readAsText(file);
  }

  function clearDraft() {
    try { sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
    selectedFile.current = null;
    upload.current = undefined;
  }

  return { restored, saveDraft, selectFile, clearDraft };
}
