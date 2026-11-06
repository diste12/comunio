import { DataTable } from "@/components/data-table";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { formatEur } from "@/lib/money";
import { fmtDate } from "@/lib/pdf/document";
import { listBankQueue } from "@/lib/services/bank";
import { Badge, Card, Skeleton, td, th } from "@/components/ui";
import { ActionButton } from "../_components/action-button";
import { confirmSuggestionAction, ignoreAction } from "./actions";
import { AssignControl, SyncForm } from "./_forms";

export const metadata = { title: "Banco" };

export default function BankPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Banco — conciliação de transferências</h1>
      <Suspense fallback={<Skeleton />}>
        <Bank />
      </Suspense>
    </div>
  );
}

async function Bank() {
  await requireAdmin();
  const [{ pending, recent }, condos] = await Promise.all([
    listBankQueue(),
    sql<{ id: string; name: string }[]>`select id, name from condominiums order by name`,
  ]);
  return (
    <>
      <Card title="Movimentos bancários">
        <SyncForm condos={condos} mock={env().BANK_PROVIDER === "mock"} />
        <p className="mt-2 text-xs text-stone-500">
          Transferências com referência (Q…), fração na descrição ou ordenante igual ao proprietário são conciliadas automaticamente,
          pagando as quotas mais antigas e emitindo recibo. As restantes ficam aqui para confirmação.
        </p>
      </Card>
      <Card title={`Por conciliar (${pending.length})`}>
        <div className="-m-4 overflow-x-auto">
          <DataTable id="bank">
            <thead className="border-b border-stone-100 bg-stone-50">
              <tr><th className={th}>Data</th><th className={th}>Condomínio</th><th className={th}>Descrição</th><th className={`${th} text-right`}>Valor</th><th className={th}>Sugestão</th><th className={th}></th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {pending.map((t) => (
                <tr data-row-id={t.id} key={t.id}>
                  <td data-value={new Date(t.booked_on).toISOString()} className={`${td} whitespace-nowrap text-xs`}>{fmtDate(t.booked_on)}</td>
                  <td className={`${td} text-xs`}>{t.condo}</td>
                  <td className={td}>
                    {t.description}
                    {t.counterparty_name && <div className="text-xs text-stone-500">{t.counterparty_name}</div>}
                  </td>
                  <td data-value={t.amountCents / 100} className={`${td} text-right tabular-nums`}>{formatEur(t.amountCents)}</td>
                  <td className={`${td} text-xs`}>
                    {t.suggestion ? (
                      <span className="flex flex-col items-start gap-1">
                        <Badge tone="amber">Fração {t.suggested_designation}</Badge>
                        <span className="text-stone-500">{t.suggestion.reason}</span>
                        <ActionButton action={confirmSuggestionAction.bind(null, t.id)} label="Confirmar" variant="secondary" />
                      </span>
                    ) : (
                      <span className="text-stone-400">—</span>
                    )}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    <span className="flex flex-col items-start gap-1">
                      <AssignControl transactionId={t.id} fractions={t.fractions} />
                      <ActionButton action={ignoreAction.bind(null, t.id)} label="Ignorar (não é quota)" variant="link" />
                    </span>
                  </td>
                </tr>
              ))}
              {pending.length === 0 && <tr><td colSpan={6} className={`${td} text-center text-stone-500`}>Nada por conciliar.</td></tr>}
            </tbody>
          </DataTable>
        </div>
      </Card>
      <Card title="Conciliados recentemente">
        <ul className="space-y-1 text-sm">
          {recent.map((r) => (
            <li key={r.id} className="flex flex-wrap gap-x-3">
              <span className="tabular-nums">{formatEur(r.amountCents)}</span>
              <span className="text-stone-600">{r.condo} · fração {r.designations}</span>
              <span className="text-xs text-stone-500">{r.match_reason} · {r.matched_by === "AUTO" ? "automático" : r.matched_by}</span>
            </li>
          ))}
          {recent.length === 0 && <li className="text-stone-500">Ainda sem conciliações.</li>}
        </ul>
      </Card>
    </>
  );
}
