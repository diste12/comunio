import type { ReactNode } from "react";
export type Value = string | number;
export type Filter = { op: "contains" | "equals" | "not" | "gt" | "lt" | "between" | "empty"; value: string; end: string; values: string[] };
export type View = { hidden: string[]; sort: { column: string; desc: boolean } | null; filters: Record<string, Filter> };
export type SavedView = { id: string; name: string; bookmarked: boolean; view: View };
export type Column = { id: string; label: string };
export type RowAction = { label: string; run: () => Promise<{ ok: boolean; message: string } | null> };
export type Row = { id: string; cells: ReactNode[]; values: Value[]; actions: RowAction[]; className?: string };
export const emptyView = (): View => ({ hidden: [], sort: null, filters: {} });
export const emptyFilter = (): Filter => ({ op: "contains", value: "", end: "", values: [] });
const collator = new Intl.Collator("pt", { numeric: true, sensitivity: "base" });
export function compare(a: Value, b: Value) { return typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b)); }
export function matches(value: Value, filter: Filter) {
  const text = String(value).toLocaleLowerCase("pt");
  if (filter.values.length && !filter.values.includes(String(value))) return false;
  if (filter.op === "empty") return text === "" || text === "—";
  if (!filter.value) return true;
  // A date-only filter includes the whole day even when cells carry timestamps.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && /^\d{4}-\d{2}-\d{2}$/.test(filter.value)) value = value.slice(0, 10);
  const target = typeof value === "number" ? Number(filter.value.replace(",", ".")) : filter.value;
  switch (filter.op) {
    case "contains": return text.includes(filter.value.toLocaleLowerCase("pt"));
    case "equals": return compare(value, target) === 0;
    case "not": return compare(value, target) !== 0;
    case "gt": return compare(value, target) > 0;
    case "lt": return compare(value, target) < 0;
    case "between": return compare(value, target) >= 0 && (!filter.end || compare(value, typeof value === "number" ? Number(filter.end.replace(",", ".")) : filter.end) <= 0);
  }
}
export function applyView(rows: Row[], columns: Column[], view: View) {
  const filtered = rows.filter(row => columns.every((c, i) => !view.filters[c.id] || matches(row.values[i], view.filters[c.id])));
  const index = columns.findIndex(c => c.id === view.sort?.column);
  return index < 0 ? filtered : filtered.sort((a, b) => compare(a.values[index], b.values[index]) * (view.sort?.desc ? -1 : 1));
}
/** Validate browser/URL preferences; never trust persisted configuration. */
export function parseView(raw: unknown, columns: Column[]): View {
  const out = emptyView();
  if (!raw || typeof raw !== "object") return out;
  const v = raw as Partial<View>;
  const ids = columns.map(c => c.id);
  out.hidden = Array.isArray(v.hidden) ? v.hidden.filter(x => ids.includes(x)).slice(0, Math.max(0, ids.length - 1)) : [];
  if (v.sort && ids.includes(v.sort.column) && typeof v.sort.desc === "boolean") out.sort = v.sort;
  for (const id of ids) {
    const f = v.filters?.[id];
    if (f && ["contains", "equals", "not", "gt", "lt", "between", "empty"].includes(f.op) && typeof f.value === "string" && typeof f.end === "string" && Array.isArray(f.values) && f.values.every(x => typeof x === "string")) out.filters[id] = f;
  }
  return out;
}
export function csvValue(value: Value) {
  let text = String(value);
  if (/^[\s]*[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
