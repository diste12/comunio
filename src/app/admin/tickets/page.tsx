import { DataTable } from "@/components/data-table";
import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { fmtDateTime } from "@/lib/pdf/document";
import { ticketRef } from "@/lib/triage/ticket-ref";
import { Badge, Card, Skeleton, td, th } from "@/components/ui";

export const metadata = { title: "Ocorrências" };

const STATUS: Record<string, [string, "amber" | "gray" | "green" | "red"]> = {
  OPEN: ["Aberta", "amber"], IN_PROGRESS: ["Em resolução", "green"], AWAITING_QUOTES: ["A orçamentar", "amber"],
  RESOLVED: ["Resolvida", "gray"], CLOSED: ["Fechada", "gray"],
};

export default function TicketsPage({ searchParams }: PageProps<"/admin/tickets">) {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Ocorrências</h1>
      <Suspense fallback={<Skeleton />}>
        <List searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function List({ searchParams }: { searchParams: PageProps<"/admin/tickets">["searchParams"] }) {
  await requireAdmin();
  const all = (await searchParams).todas === "1";
  const rows = await sql<{ id: string; category: string; description: string; status: string; priority: string; source: string; created_at: Date; condo: string }[]>`
    select t.id, t.category, t.description, t.status, t.priority, t.source, t.created_at, c.name condo
    from maintenance_tickets t join condominiums c on c.id = t.condominium_id
    where ${all}::bool or t.status in ('OPEN', 'IN_PROGRESS', 'AWAITING_QUOTES')
    order by case t.priority when 'URGENT' then 0 when 'HIGH' then 1 else 2 end, t.created_at desc limit 500`;
  return (
    <Card
      title={`${rows.length} ocorrências ${all ? "" : "em aberto"}`}
      actions={<Link href={all ? "?" : "?todas=1"} className="text-sm text-brand-700 underline">{all ? "Só em aberto" : "Ver todas"}</Link>}
    >
      <div className="-m-4 overflow-x-auto">
        <DataTable id="tickets" editKind="tickets">
          <thead className="border-b border-stone-100 bg-stone-50">
            <tr><th className={th}>Ocorrência</th><th className={th}>Condomínio</th><th className={th}>Origem</th><th className={th}>Estado</th><th className={th}>Data</th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((r) => (
              <tr data-row-id={r.id} key={r.id} className="hover:bg-stone-50">
                <td className={td}>
                  <Link href={`/admin/tickets/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.category}</Link>
                  <span className="ml-2 font-mono text-xs text-stone-400">{ticketRef(r.id)}</span>
                  {r.priority === "URGENT" && <span className="ml-2"><Badge tone="red">Urgente</Badge></span>}
                  {r.priority === "HIGH" && <span className="ml-2"><Badge tone="amber">Alta</Badge></span>}
                  <div className="max-w-md truncate text-xs text-stone-500">{r.description}</div>
                </td>
                <td className={td}>{r.condo}</td>
                <td className={`${td} text-xs`}>{r.source}</td>
                <td className={td}><Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge></td>
                <td data-value={new Date(r.created_at).toISOString()} className={`${td} text-xs text-stone-500`}>{fmtDateTime(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>
    </Card>
  );
}
