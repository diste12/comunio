import { DataTable } from "@/components/data-table";
import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { fmtDateTime } from "@/lib/pdf/document";
import { Badge, Card, Skeleton, td, th } from "@/components/ui";

export const metadata = { title: "Assembleias" };

const STATUS: Record<string, [string, "gray" | "amber" | "green"]> = {
  DRAFT: ["Rascunho", "gray"], CONVOKED: ["Convocada", "amber"], IN_PROGRESS: ["A decorrer", "green"], CLOSED: ["Encerrada", "gray"],
};

export default function AssembliesPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Assembleias</h1>
      <Suspense fallback={<Skeleton />}>
        <List />
      </Suspense>
    </div>
  );
}

async function List() {
  await requireAdmin();
  const rows = await sql<{ id: string; scheduled_at: Date; status: string; kind: string; condo: string; minutes_status: string | null }[]>`
    select a.id, a.scheduled_at, a.status, a.kind, c.name condo, m.status minutes_status
    from assemblies a join condominiums c on c.id = a.condominium_id left join minutes m on m.assembly_id = a.id
    order by (a.status = 'CLOSED'), a.scheduled_at desc limit 200`;
  return (
    <Card title={`${rows.length} assembleias`}>
      <p className="-mt-1 mb-3 text-xs text-stone-500">Para criar uma assembleia, abra o condomínio e use “Nova assembleia”.</p>
      <div className="-mx-4 -mb-4 overflow-x-auto">
        <DataTable id="assemblies">
          <thead className="border-y border-stone-100 bg-stone-50">
            <tr><th className={th}>Data</th><th className={th}>Condomínio</th><th className={th}>Tipo</th><th className={th}>Estado</th><th className={th}>Ata</th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((r) => (
              <tr data-row-id={r.id} key={r.id} className="hover:bg-stone-50">
                <td data-value={r.scheduled_at.toISOString()} className={td}><Link href={`/admin/assemblies/${r.id}`} className="font-medium text-brand-700 hover:underline">{fmtDateTime(r.scheduled_at)}</Link></td>
                <td className={td}>{r.condo}</td>
                <td className={td}>{r.kind === "ORDINARIA" ? "Ordinária" : "Extraordinária"}</td>
                <td className={td}><Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge></td>
                <td className={td}>{r.minutes_status === "APPROVED" ? <Badge tone="green">Aprovada</Badge> : r.minutes_status ? <Badge tone="amber">Rascunho</Badge> : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className={`${td} text-center text-stone-500`}>Sem assembleias.</td></tr>}
          </tbody>
        </DataTable>
      </div>
    </Card>
  );
}
