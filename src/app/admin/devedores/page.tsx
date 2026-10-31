import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { formatEur } from "@/lib/money";
import { fmtDate } from "@/lib/pdf/document";
import { listDebtors, MIN_OVERDUE_INSTALLMENTS } from "@/lib/services/collections";
import { Card, Skeleton, Stat, td, th } from "@/components/ui";
import { ActionButton } from "../_components/action-button";
import { sendLetterAction } from "./actions";

export const metadata = { title: "Devedores" };

export default function DebtorsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Devedores — pré-contencioso</h1>
      <Suspense fallback={<Skeleton />}>
        <Debtors />
      </Suspense>
    </div>
  );
}

async function Debtors() {
  await requireAdmin();
  const debtors = await listDebtors();
  const total = debtors.reduce((s, d) => s + d.overdueCents, 0);
  const pending = debtors.filter((d) => !d.lastLetterAt).length;
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Frações" value={String(debtors.length)} hint={`≥ ${MIN_OVERDUE_INSTALLMENTS} prestações em atraso`} />
        <Stat label="Em dívida" value={formatEur(total)} tone="bad" />
        <Stat label="Sem carta enviada" value={String(pending)} />
      </div>
      <Card title="Interpelação por carta registada (CTT)">
        <p className="-mt-1 mb-3 text-xs text-stone-500">
          Reveja a carta (PDF) e confirme o envio. Cada envio fica registado com o número de registo CTT.
        </p>
        <div className="-mx-4 -mb-4 overflow-x-auto">
          <table className="w-full">
            <thead className="border-y border-stone-100 bg-stone-50">
              <tr>
                <th className={th}>Condomínio · fração</th><th className={th}>Proprietário</th>
                <th className={`${th} text-right`}>Prestações</th><th className={`${th} text-right`}>Em dívida</th>
                <th className={th}>Desde</th><th className={th}>Última carta</th><th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {debtors.map((d) => (
                <tr key={d.fractionId}>
                  <td className={td}>
                    <Link href={`/admin/condominiums/${d.condominiumId}?f=overdue`} className="text-brand-700 hover:underline">{d.condominium}</Link>
                    <span className="ml-1 font-medium">· {d.designation}</span>
                  </td>
                  <td className={td}>{d.ownerName ?? "—"}</td>
                  <td className={`${td} text-right tabular-nums`}>{d.overdueCount}</td>
                  <td className={`${td} text-right tabular-nums text-red-700`}>{formatEur(d.overdueCents)}</td>
                  <td className={`${td} text-xs`}>{fmtDate(d.oldestDue)}</td>
                  <td className={`${td} text-xs`}>
                    {d.lastLetterAt ? <>{fmtDate(d.lastLetterAt)}<div className="font-mono text-stone-500">{d.lastTracking}</div></> : "—"}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    <span className="flex items-center gap-3">
                      <a href={`/admin/devedores/carta/${d.fractionId}`} target="_blank" className="text-xs text-brand-700 underline">Ver carta</a>
                      <ActionButton action={sendLetterAction.bind(null, d.fractionId)} label="Enviar carta registada" variant="secondary" />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
