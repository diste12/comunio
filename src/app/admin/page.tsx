import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { formatEur } from "@/lib/money";
import { collectionRate, listCondominiums, portfolioTotals } from "@/lib/services/ledger";
import { Badge, Card, Skeleton, Stat, td, th } from "@/components/ui";

export const metadata = { title: "Carteira" };

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

export default function AdminHome({ searchParams }: PageProps<"/admin">) {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Carteira de condomínios</h1>
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
  const [totals, condos] = await Promise.all([portfolioTotals(), listCondominiums({ q, onlyDebt })]);
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
