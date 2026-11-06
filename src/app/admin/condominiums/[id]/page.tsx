import { DataTable } from "@/components/data-table";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatEur, toCents } from "@/lib/money";
import {
  collectionRate,
  getCondominium,
  listCharges,
  listFractions,
  type ChargeFilter,
} from "@/lib/services/ledger";
import { Badge, Card, Skeleton, Stat, td, th } from "@/components/ui";
import { ActionButton } from "../../_components/action-button";
import { BudgetForm } from "../../_components/budget-form";
import { sql } from "@/lib/db";
import { fmtDateTime } from "@/lib/pdf/document";
import { ticketRef } from "@/lib/triage/ticket-ref";
import {
  sendPortalLinkAction,
  issueReferencesAction,
  requestMbWayAction,
  retryReceiptAction,
  simulatePaymentAction,
} from "../../actions";

const FILTERS: { key: ChargeFilter; label: string }[] = [
  { key: "open", label: "A cobrar (45 dias)" },
  { key: "overdue", label: "Em atraso" },
  { key: "paid", label: "Pagas" },
  { key: "all", label: "Todas" },
];

export default function CondominiumPage(props: PageProps<"/admin/condominiums/[id]">) {
  return (
    <Suspense fallback={<Skeleton rows={14} />}>
      <Condominium {...props} />
    </Suspense>
  );
}

async function Condominium({ params, searchParams }: PageProps<"/admin/condominiums/[id]">) {
  await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const filter = (FILTERS.find((f) => f.key === sp.f)?.key ?? "open") as ChargeFilter;

  const data = await getCondominium(id);
  if (!data) notFound();
  const { condo, summary, budgets } = data;
  const [fractions, charges, assemblies, tickets] = await Promise.all([
    listFractions(id),
    listCharges(id, filter),
    sql<{ id: string; scheduled_at: Date; status: string; kind: string }[]>`
      select id, scheduled_at, status, kind from assemblies where condominium_id = ${id} order by scheduled_at desc limit 5`,
    sql<{ id: string; category: string; status: string; created_at: Date }[]>`
      select id, category, status, created_at from maintenance_tickets
      where condominium_id = ${id} and status in ('OPEN', 'IN_PROGRESS', 'AWAITING_QUOTES') order by created_at desc limit 5`,
  ]);
  const mock = env().PAYMENTS_PROVIDER === "mock";
  const rate = collectionRate(summary.paidCents, summary.overdueCents);
  const nextYear = Math.max(new Date().getFullYear() + 1, ...budgets.map((b) => b.fiscal_year + 1));
  const permilagemTotal = fractions.reduce((s, f) => s + toCents(f.permilagem), 0) / 100;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-xs text-stone-500 hover:underline">
          ← Carteira
        </Link>
        <h1 className="mt-1 flex items-center gap-4 text-xl font-semibold">
          {condo.name}
          <Link href={`/admin/condominiums/${id}/residentes`} className="text-sm font-normal text-brand-700 hover:underline">Residentes</Link>
          <Link href={`/admin/condominiums/${id}/definicoes`} className="text-sm font-normal text-brand-700 hover:underline">Definições</Link>
        </h1>
        <p className="text-sm text-stone-600">
          NIF {condo.nif_condominio} · {condo.address}, {condo.postal_code} {condo.city}
          {condo.bank_iban_current && <> · IBAN <span className="font-mono text-xs">{condo.bank_iban_current}</span></>}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Frações" value={String(summary.fractionCount)} hint={`permilagem total ${permilagemTotal.toFixed(2)}‰`} />
        <Stat label="Cobrado" value={formatEur(summary.paidCents)} tone="good" hint={rate === null ? undefined : `taxa ${(rate * 100).toFixed(1)}%`} />
        <Stat label="Em dívida" value={formatEur(summary.overdueCents)} tone={summary.overdueCents ? "bad" : "default"} hint={`${summary.fractionsInDebt} frações`} />
        <Stat label="A vencer" value={formatEur(summary.upcomingCents)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Assembleias"
          actions={
            <Link href={`/admin/assemblies/new?condo=${id}`} className="text-sm font-medium text-brand-700 hover:underline">
              + Nova assembleia
            </Link>
          }
        >
          {assemblies.length === 0 ? (
            <p className="text-sm text-stone-500">Sem assembleias.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {assemblies.map((a) => (
                <li key={a.id}>
                  <Link href={`/admin/assemblies/${a.id}`} className="text-brand-700 hover:underline">
                    {fmtDateTime(a.scheduled_at)}
                  </Link>{" "}
                  <span className="text-xs text-stone-500">· {a.kind.toLowerCase()} · {a.status.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Ocorrências em aberto">
          {tickets.length === 0 ? (
            <p className="text-sm text-stone-500">Nenhuma.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {tickets.map((t) => (
                <li key={t.id}>
                  <Link href={`/admin/tickets/${t.id}`} className="text-brand-700 hover:underline">
                    {t.category}
                  </Link>{" "}
                  <span className="font-mono text-xs text-stone-400">{ticketRef(t.id)}</span>{" "}
                  <span className="text-xs text-stone-500">· {t.status.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Orçamento e quotas (motor de permilagem)">
        {budgets.length > 0 && (
          <ul className="mb-4 space-y-1 text-sm">
            {budgets.map((b) => (
              <li key={b.id}>
                <span className="font-medium">{b.fiscal_year}</span>: {formatEur(toCents(b.ordinary_amount))} despesas
                correntes + {formatEur(toCents(b.reserve_amount))} fundo de reserva ({Number(b.reserve_fund_pct)}%) em{" "}
                {b.installments} prestações
              </li>
            ))}
          </ul>
        )}
        <BudgetForm condominiumId={id} defaultYear={nextYear} />
      </Card>

      <Card
        title="Quotas"
        actions={
          <ActionButton
            action={issueReferencesAction.bind(null, id)}
            label="Emitir referências Multibanco"
            pendingLabel="A emitir…"
          />
        }
      >
        <nav className="-mt-1 mb-3 flex gap-4 text-sm">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`?f=${f.key}`}
              className={f.key === filter ? "font-semibold text-brand-700" : "text-stone-500 hover:text-stone-800"}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        <div className="-mx-4 -mb-4 overflow-x-auto">
          <DataTable id={`charges-${id}`}>
            <thead className="border-y border-stone-100 bg-stone-50">
              <tr>
                <th className={th}>Fração</th>
                <th className={th}>Descrição</th>
                <th className={th}>Vencimento</th>
                <th className={`${th} text-right`}>Valor</th>
                <th className={th}>Multibanco</th>
                <th className={th}>Estado</th>
                <th className={th}>Recibo</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {charges.length === 0 && (
                <tr>
                  <td colSpan={8} className={`${td} text-center text-stone-500`}>
                    Sem quotas neste filtro.
                  </td>
                </tr>
              )}
              {charges.map((c) => (
                <tr data-row-id={c.id} key={c.id}>
                  <td className={`${td} font-medium`}>{c.designation}</td>
                  <td className={`${td} text-stone-600`}>{c.description}</td>
                  <td className={`${td} tabular-nums`}>{c.dueDate}</td>
                  <td data-value={c.amountCents / 100} className={`${td} text-right tabular-nums`}>
                    {formatEur(c.amountCents)}
                    <div className="text-xs text-stone-400">FCR {formatEur(c.reserveCents)}</div>
                  </td>
                  <td className={`${td} font-mono text-xs`}>
                    {c.mbReference ? (
                      <>
                        Ent. {c.mbEntity}
                        <br />
                        Ref. {c.mbReference.replace(/(\d{3})(?=\d)/g, "$1 ")}
                      </>
                    ) : (
                      <span className="text-stone-400">—</span>
                    )}
                  </td>
                  <td className={td}>
                    {c.status === "PAID" ? (
                      <Badge tone="green">Paga{c.paidMethod ? ` · ${c.paidMethod === "MBWAY" ? "MB WAY" : "MB"}` : ""}</Badge>
                    ) : c.overdue ? (
                      <Badge tone="red">Em atraso</Badge>
                    ) : c.status === "CANCELLED" ? (
                      <Badge tone="gray">Anulada</Badge>
                    ) : (
                      <Badge tone="amber">Pendente</Badge>
                    )}
                  </td>
                  <td className={`${td} text-xs`}>
                    {c.receiptId ? (
                      <span className="font-mono text-stone-500" title={c.receiptId}>✓ emitido</span>
                    ) : c.receiptError ? (
                      <span className="text-red-700" title={c.receiptError}>
                        erro
                        <ActionButton action={retryReceiptAction.bind(null, c.id)} label="repetir" variant="link" />
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    {c.status === "PENDING" && (
                      <span className="flex gap-2">
                        <ActionButton action={requestMbWayAction.bind(null, c.id)} label="MB WAY" variant="secondary" />
                        {mock && (
                          <ActionButton
                            action={simulatePaymentAction.bind(null, c.id)}
                            label="Simular pagamento"
                            variant="secondary"
                          />
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      </Card>

      <Card title="Frações">
        <div className="-m-4 overflow-x-auto">
          <DataTable id={`fractions-${id}`}>
            <thead className="border-b border-stone-100 bg-stone-50">
              <tr>
                <th className={th}>Fração</th>
                <th className={`${th} text-right`}>Permilagem</th>
                <th className={th}>Proprietário</th>
                <th className={th}>Inquilino</th>
                <th className={`${th} text-right`}>Pago</th>
                <th className={`${th} text-right`}>Em dívida</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {fractions.map((f) => (
                <tr data-row-id={f.id} key={f.id}>
                  <td className={`${td} font-medium`}>{f.designation}</td>
                  <td data-value={Number(f.permilagem)} className={`${td} text-right tabular-nums`}>{Number(f.permilagem).toFixed(2)}‰</td>
                  <td className={td}>
                    {f.ownerName ?? "—"}
                    {f.ownerPhone && <div className="text-xs text-stone-500">+{f.ownerPhone}</div>}
                    {f.ownerId && (
                      <ActionButton action={sendPortalLinkAction.bind(null, f.ownerId)} label="Enviar link do portal" variant="link" />
                    )}
                  </td>
                  <td className={`${td} text-stone-600`}>{f.tenantName ?? "—"}</td>
                  <td data-value={f.paidCents / 100} className={`${td} text-right tabular-nums`}>{formatEur(f.paidCents)}</td>
                  <td data-value={f.overdueCents / 100} className={`${td} text-right tabular-nums`}>
                    {f.overdueCents > 0 ? (
                      <span className="text-red-700">
                        {formatEur(f.overdueCents)} <span className="text-xs text-stone-500">({f.overdueCount})</span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      </Card>
    </div>
  );
}
