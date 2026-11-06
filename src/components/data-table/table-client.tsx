"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
import { applyView, csvValue, emptyFilter, emptyView, parseView, type Column, type Row, type SavedView, type View } from "./model";
import { bulkEdit, type EditKind } from "./mutations";
const control = "rounded border border-stone-300 bg-white px-2 py-1 text-xs disabled:opacity-40";
export function TableClient({ id, owner, columns, rows, editKind }: { id: string; owner: string; columns: Column[]; rows: Row[]; editKind?: EditKind }) {
  const router = useRouter();
  const [view, setView] = useState<View>(emptyView);
  const [saved, setSaved] = useState<SavedView[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [operation, setOperation] = useState("");
  const [editValue, setEditValue] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const storageKey = `comunio:tables:v1:${owner}:${id}`;
  const param = `view-${id}`;
  useEffect(() => {
    try {
      const data = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      const safe = Array.isArray(data) ? data.filter(v => v && typeof v.id === "string" && typeof v.name === "string").map(v => ({ ...v, bookmarked: v.bookmarked === true, view: parseView(v.view, columns) })) : [];
      // Hydrate browser-only preferences after the server-rendered table is mounted.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSaved(safe);
      const fromUrl = new URL(window.location.href).searchParams.get(param);
      if (fromUrl) setView(parseView(JSON.parse(fromUrl), columns));
    } catch { /* Invalid or unavailable storage must not prevent table use. */ }
  // Column definitions may be recreated by server refreshes; do not reset user edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, param]);
  const filtered = applyView(rows, columns, view);
  // Bulk actions apply only to the explicitly selected rows still visible in this filter.
  const selection = filtered.filter(r => selected.includes(r.id));
  const visible = columns.map((c, i) => ({ ...c, index: i })).filter(c => !view.hidden.includes(c.id));
  const labels = [...new Set(selection.flatMap(r => r.actions.map(a => a.label)))].filter(label => selection.every(r => r.actions.filter(a => a.label === label).length === 1));
  function change(next: View) { setView(next); setConfirm(false); }
  function persist(next: SavedView[]) {
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setSaved(next); setMessage("Vistas guardadas neste navegador."); }
    catch { setMessage("O navegador não permite guardar vistas. Pode usar o link de marcador."); }
  }
  function bookmark(next: View) {
    const url = new URL(window.location.href); url.searchParams.set(param, JSON.stringify(next));
    window.history.replaceState(null, "", url);
    setMessage("Link atualizado. Pode adicioná-lo aos favoritos do navegador.");
  }
  function exportRows() {
    const csv = [visible.map(c => csvValue(c.label)), ...selection.map(r => visible.map(c => csvValue(r.values[c.index])))].map(r => r.join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${id}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  function execute() {
    const targets = [...selection]; const action = operation; const value = editValue;
    setConfirm(false);
    start(async () => {
      try {
        if (action === "edit" && editKind) {
          const result = await bulkEdit({ kind: editKind, ids: targets.map(r => r.id), value });
          setMessage(result.message);
          if (result.ok) { setSelected([]); router.refresh(); }
        } else {
          const failures: string[] = []; const successes: string[] = [];
          for (const row of targets) {
            const fn = row.actions.find(a => `action:${a.label}` === action);
            if (!fn) continue;
            try {
              const result = await fn.run();
              if (result?.ok) successes.push(row.id);
              else failures.push(`${String(row.values[0])}: ${result?.message ?? "Falhou"}`);
            } catch (error) { unstable_rethrow(error); failures.push(`${String(row.values[0])}: pedido falhou`); }
          }
          setSelected(current => current.filter(id => !successes.includes(id)));
          setMessage(`${successes.length} concluídos. ${failures.length} falharam.${failures.length ? " " + failures.join("; ") : ""}`);
          router.refresh();
        }
      } catch (error) { unstable_rethrow(error); setMessage("O pedido falhou. A seleção foi mantida; confirme os resultados antes de repetir."); }
    });
  }
  return <div className="space-y-2 p-2">
    <div className="flex flex-wrap items-center gap-2">
      <details className="relative"><summary className={control}>Colunas</summary><div className="absolute left-0 z-20 min-w-52 space-y-2 rounded border bg-white p-3 shadow-lg">{columns.map(c => <label key={c.id} className="flex gap-2 text-xs"><input type="checkbox" checked={!view.hidden.includes(c.id)} disabled={visible.length === 1 && !view.hidden.includes(c.id)} onChange={e => change({ ...view, hidden: e.target.checked ? view.hidden.filter(x => x !== c.id) : [...view.hidden, c.id] })} />{c.label}</label>)}</div></details>
      <input className={control} aria-label="Nome da vista" placeholder="Nome da vista" maxLength={80} value={name} onChange={e => setName(e.target.value)} />
      <button type="button" className={control} disabled={!name.trim()} onClick={() => { persist([...saved, { id: crypto.randomUUID(), name: name.trim(), bookmarked: false, view }]); setName(""); }}>Guardar nova vista</button>
      <button type="button" className={control} onClick={() => bookmark(view)}>Link para esta vista</button>
      <button type="button" className={control} onClick={() => { change(emptyView()); setSelected([]); const url = new URL(window.location.href); url.searchParams.delete(param); window.history.replaceState(null, "", url); }}>Repor tabela</button>
    </div>
    {saved.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Vistas guardadas">{[...saved].sort((a,b) => Number(b.bookmarked)-Number(a.bookmarked)).map(s => <span key={s.id} className="inline-flex rounded border bg-stone-50">
      <button type="button" className={control} onClick={() => { change(s.view); setSelected([]); bookmark(s.view); }}>{s.name}</button>
      <button type="button" className={control} aria-label={`Favorito: ${s.name}`} aria-pressed={s.bookmarked} onClick={() => persist(saved.map(v => v.id === s.id ? { ...v, bookmarked: !v.bookmarked } : v))}>{s.bookmarked ? "★" : "☆"}</button>
      <button type="button" className={control} aria-label={`Atualizar vista: ${s.name}`} onClick={() => persist(saved.map(v => v.id === s.id ? { ...v, view } : v))}>Guardar</button>
      <button type="button" className={control} aria-label={`Eliminar vista: ${s.name}`} onClick={() => persist(saved.filter(v => v.id !== s.id))}>×</button>
    </span>)}</div>}
    <p className="text-xs text-stone-500">{filtered.length} de {rows.length} registos carregados · {selection.length} selecionados. Filtros combinados com E; valores de uma coluna com OU.</p>
    <fieldset disabled={pending} className="flex flex-wrap items-center gap-2">
      <button type="button" className={control} disabled={!selection.length} onClick={exportRows}>Exportar seleção (CSV)</button>
      <button type="button" className={control} disabled={!selected.length} onClick={() => { setSelected([]); setConfirm(false); }}>Limpar seleção</button>
      {(editKind || labels.length > 0) && <>
        <select className={control} aria-label="Ação em massa" value={operation} onChange={e => { setOperation(e.target.value); setConfirm(false); }}><option value="">Escolher ação em massa</option>{editKind && <option value="edit">{editKind === "tickets" ? "Editar estado" : "Editar cidade"}</option>}{labels.map(label => <option key={label} value={`action:${label}`}>{label}</option>)}</select>
        {operation === "edit" && (editKind === "tickets" ? <select aria-label="Novo estado" className={control} value={editValue} onChange={e => { setEditValue(e.target.value); setConfirm(false); }}><option value="">Escolher estado</option>{Object.entries({ OPEN: "Aberta", IN_PROGRESS: "Em resolução", AWAITING_QUOTES: "A orçamentar", RESOLVED: "Resolvida", CLOSED: "Fechada" }).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select> : <input aria-label="Nova cidade" className={control} value={editValue} maxLength={100} onChange={e => { setEditValue(e.target.value); setConfirm(false); }} />)}
        <button type="button" className={control} disabled={!selection.length || selection.length > 500 || !operation || (operation === "edit" ? !editValue.trim() : !labels.some(l => `action:${l}` === operation))} onClick={() => setConfirm(true)}>Aplicar à seleção</button>
      </>}
      {confirm && <div role="alert" className="w-full rounded bg-amber-50 p-3 text-sm">Confirmar {operation === "edit" ? `alteração para “${editValue}”` : operation.slice(7)} em {selection.length} registos selecionados? <button type="button" className={control} onClick={execute}>Confirmar</button> <button type="button" className={control} onClick={() => setConfirm(false)}>Cancelar</button></div>}
    </fieldset>
    {pending && <p role="status" className="text-sm">A processar seleção…</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    <div className="overflow-x-auto"><table className="w-full"><thead className="bg-stone-50"><tr>
      <th className="p-2"><input type="checkbox" aria-label="Selecionar todos os resultados filtrados" disabled={pending || !filtered.length} checked={filtered.length > 0 && selection.length === filtered.length} ref={el => { if (el) el.indeterminate = selection.length > 0 && selection.length < filtered.length; }} onChange={e => { setSelected(e.target.checked ? filtered.map(r => r.id) : []); setConfirm(false); }} /></th>
      {visible.map(c => <th key={c.id} scope="col" className="px-3 py-2 text-left text-xs font-medium text-stone-600" aria-sort={view.sort?.column === c.id ? view.sort.desc ? "descending" : "ascending" : "none"}>
        <button type="button" onClick={() => change({ ...view, sort: view.sort?.column === c.id && view.sort.desc ? null : { column: c.id, desc: view.sort?.column === c.id } })}>{c.label} {view.sort?.column === c.id ? view.sort.desc ? "↓" : "↑" : "↕"}</button>
        <details><summary className="cursor-pointer font-normal">Filtrar{view.filters[c.id] ? " •" : ""}</summary><div className="min-w-48 space-y-2 py-2 font-normal">
          <select className={control} aria-label={`Operador: ${c.label}`} value={(view.filters[c.id] ?? emptyFilter()).op} onChange={e => change({ ...view, filters: { ...view.filters, [c.id]: { ...(view.filters[c.id] ?? emptyFilter()), op: e.target.value as ReturnType<typeof emptyFilter>["op"] } } })}>{Object.entries({ contains: "Contém", equals: "Igual a", not: "Diferente de", gt: "Maior / depois de", lt: "Menor / antes de", between: "Entre", empty: "Vazio" }).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select>
          <input className={`${control} block w-full`} aria-label={`Filtro: ${c.label}`} placeholder="Valor (data: AAAA-MM-DD)" value={view.filters[c.id]?.value ?? ""} onChange={e => change({ ...view, filters: { ...view.filters, [c.id]: { ...(view.filters[c.id] ?? emptyFilter()), value: e.target.value } } })} />
          {view.filters[c.id]?.op === "between" && <input className={control} aria-label={`Até: ${c.label}`} value={view.filters[c.id].end} onChange={e => change({ ...view, filters: { ...view.filters, [c.id]: { ...view.filters[c.id], end: e.target.value } } })} />}
          <select multiple className={`${control} w-full`} aria-label={`Valores: ${c.label}`} value={view.filters[c.id]?.values ?? []} onChange={e => change({ ...view, filters: { ...view.filters, [c.id]: { ...(view.filters[c.id] ?? emptyFilter()), values: Array.from(e.target.selectedOptions, o => o.value) } } })}>{[...new Set(rows.map(r => String(r.values[c.index])))].sort().map(v => <option key={v} value={v}>{v || "(vazio)"}</option>)}</select>
          <button type="button" className={control} onClick={() => { const filters = { ...view.filters }; delete filters[c.id]; change({ ...view, filters }); }}>Limpar filtro</button>
        </div></details>
      </th>)}
    </tr></thead><tbody className="divide-y divide-stone-100">{filtered.map(r => <tr key={r.id} className={r.className}><td className="p-2"><input type="checkbox" aria-label={`Selecionar ${String(r.values[0])}`} disabled={pending} checked={selected.includes(r.id)} onChange={e => { setSelected(e.target.checked ? [...selected, r.id] : selected.filter(id => id !== r.id)); setConfirm(false); }} /></td>{visible.map(c => r.cells[c.index])}</tr>)}{filtered.length === 0 && <tr><td colSpan={visible.length + 1} className="p-4 text-sm text-stone-500">Sem resultados. Ajuste os filtros ou reponha a tabela.</td></tr>}</tbody></table></div>
  </div>;
}
