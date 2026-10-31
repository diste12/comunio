import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { formatEur } from "@/lib/money";
import { approvalsQueue } from "@/lib/services/approvals";
import { collectionRate, listCondominiums, portfolioTotals } from "@/lib/services/ledger";
import { fmtDateTime } from "@/lib/pdf/document";
import { Badge, Card, Skeleton, Stat, td, th } from "@/components/ui";

export const metadata = { title: "Carteira" };

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

export default function AdminHome({ searchParams }: PageProps<"/admin">) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Carteira de condomínios</h1>
        <Link href="/admin/condominiums/new" className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
          + Novo condomínio
        </Link>
      </div>
      <Suspense fallback={<Skeleton rows={12} />}>
        <Portfolio searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Portfolio({ searchParams }: { searchParams: PageProps<"/admin">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const onlyDebt = sp.divida === "1";
  const [totals, condos, queue] = await Promise.all([portfolioTotals(), listCondominiums({ q, onlyDebt }), approvalsQueue()]);
  const rate = collectionRate(totals.paidCents, totals.overdueCents);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Condomínios" value={String(totals.condominiums)} hint={`${totals.fractions} frações`} />
        <Stat label="Faturado" value={formatEur(totals.billedCents)} hint="orçamentos em vigor" />
        <Stat label="Cobrado" value={formatEur(totals.paidCents)} tone="good" hint={`taxa de cobrança ${pct(rate)}`} />
        <Stat
          label="Em dívida"
          value={formatEur(totals.overdueCents)}
          tone={totals.overdueCents > 0 ? "bad" : "default"}
          hint={`${totals.fractionsInDebt} frações em atraso`}
        />
        <Stat label="Ocorrências abertas" value={String(totals.openTickets)} />
      </div>

      <Approvals queue={queue} />

      <Card
        title={`${condos.length} condomínios`}
        actions={
          <form className="flex items-center gap-3 text-sm">
            <input
              name="q"
              defaultValue={q}
              placeholder="Nome, NIF ou cidade"
              className="w-56 rounded-md border border-stone-300 px-2.5 py-1.5"
            />
            <label className="flex items-center gap-1.5 text-stone-600">
              <input type="checkbox" name="divida" value="1" defaultChecked={onlyDebt} /> Só com dívida
            </label>
            <button className="rounded-md border border-stone-300 px-3 py-1.5 hover:bg-stone-50">Filtrar</button>
          </form>
        }
      >
        <div className="-m-4 overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-stone-100 bg-stone-50">
              <tr>
                <th className={th}>Condomínio</th>
                <th className={th}>NIF</th>
                <th className={`${th} text-right`}>Frações</th>
                <th className={`${th} text-right`}>Cobrado</th>
                <th className={`${th} text-right`}>Em dívida</th>
                <th className={`${th} text-right`}>Taxa</th>
                <th className={`${th} text-right`}>Ocorrências</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {condos.map((c) => {
                const r = collectionRate(c.paidCents, c.overdueCents);
                return (
                  <tr key={c.id} className="hover:bg-stone-50">
                    <td className={td}>
                      <Link href={`/admin/condominiums/${c.id}`} className="font-medium text-brand-700 hover:underline">
                        {c.name}
                      </Link>
                      <div className="text-xs text-stone-500">{c.city}</div>
                    </td>
                    <td className={`${td} font-mono text-xs`}>{c.nif}</td>
                    <td className={`${td} text-right tabular-nums`}>{c.fractionCount}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatEur(c.paidCents)}</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {c.overdueCents > 0 ? (
                        <span className="text-red-700">
                          {formatEur(c.overdueCents)}
                          <span className="ml-1 text-xs text-stone-500">({c.fractionsInDebt})</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`${td} text-right`}>
                      {r === null ? "—" : <Badge tone={r >= 0.95 ? "green" : r >= 0.85 ? "amber" : "red"}>{pct(r)}</Badge>}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{c.openTickets || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Approvals({ queue }: { queue: Awaited<ReturnType<typeof approvalsQueue>> }) {
  const items: { key: string; href: string; label: string; detail: string; tone: "red" | "amber" | "gray" }[] = [
    ...queue.urgent.map((t) => ({ key: `u${t.id}`, href: `/admin/tickets/${t.id}`, label: `Urgente: ${t.category}`, detail: `${t.condo} · ${fmtDateTime(t.created_at)}`, tone: "red" as const })),
    ...queue.invoices.map((i) => ({ key: `i${i.id}`, href: `/admin/tickets/${i.ticket_id}`, label: `Aprovar pagamento ${formatEur(i.amountCents)}`, detail: `${i.vendor} · fatura ${i.invoice_number} · ${i.condo}`, tone: "amber" as const })),
    ...queue.quotesReady.map((r) => ({ key: `q${r.ticket_id}`, href: `/admin/tickets/${r.ticket_id}`, label: `Adjudicar orçamento: ${r.category}`, detail: `3 propostas recebidas · ${r.condo}`, tone: "amber" as const })),
    ...queue.minutes.map((m) => ({ key: `m${m.assembly_id}`, href: `/admin/assemblies/${m.assembly_id}`, label: "Assinar ata", detail: `${m.condo} · ${fmtDateTime(m.scheduled_at)}`, tone: "amber" as const })),
    ...(queue.bankUnmatched > 0
      ? [{ key: "bank", href: "/admin/banco", label: `${queue.bankUnmatched} transferências por conciliar`, detail: `${queue.bankSuggested} com sugestão de 1 clique`, tone: "amber" as const }]
      : []),
    ...(queue.debtorsWithoutLetter > 0
      ? [{ key: "debt", href: "/admin/devedores", label: `${queue.debtorsWithoutLetter} cartas de pré-contencioso por enviar`, detail: `≥ 3 prestações em atraso`, tone: "gray" as const }]
      : []),
    ...(queue.receiptErrors > 0
      ? [{ key: "rcpt", href: "/admin", label: `${queue.receiptErrors} recibos Moloni com erro`, detail: "nova tentativa automática a cada hora", tone: "red" as const }]
      : []),
  ];
  return (
    <Card title={`Para decidir (${items.length})`}>
      {items.length === 0 ? (
        <p className="text-sm text-stone-500">Nada pendente. 🎉</p>
      ) : (
        <ul className="-m-4 divide-y divide-stone-100">
          {items.slice(0, 12).map((i) => (
            <li key={i.key}>
              <Link href={i.href} className="flex items-center justify-between gap-4 px-4 py-2.5 hover:bg-stone-50">
                <span className="text-sm font-medium">{i.label}</span>
                <span className="flex items-center gap-2 text-xs text-stone-500">
                  {i.detail} <Badge tone={i.tone}>→</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
