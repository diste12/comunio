import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { isoDateFromNow } from "@/lib/dates";
import { env } from "@/lib/env";
import { formatEur } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/pdf/document";
import { rfpsForTicket } from "@/lib/services/rfps";
import { ticketRef } from "@/lib/triage/ticket-ref";
import { Badge, Card, Skeleton, td, th } from "@/components/ui";
import { ActionButton } from "../../_components/action-button";
import { awardQuoteAction, decideInvoiceAction, simulateQuotesAction } from "../actions";
import { RequestQuotesForm, StatusSelect } from "./_forms";

export default function TicketPage(props: PageProps<"/admin/tickets/[id]">) {
  return (
    <Suspense fallback={<Skeleton rows={10} />}>
      <Ticket params={props.params} />
    </Suspense>
  );
}

async function Ticket({ params }: { params: PageProps<"/admin/tickets/[id]">["params"] }) {
  await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [t] = await sql<
    { id: string; category: string; description: string; status: string; priority: string; source: string; created_at: Date;
      condominium_id: string; condo: string; reporter: string | null; reporter_phone: string | null; designation: string | null }[]
  >`
    select t.*, c.name condo, r.full_name reporter, r.phone_number reporter_phone, f.designation
    from maintenance_tickets t join condominiums c on c.id = t.condominium_id
    left join residents r on r.id = t.reported_by left join fractions f on f.id = t.fraction_id
    where t.id = ${id}`;
  if (!t) notFound();
  const rfps = await rfpsForTicket(id);
  const hasOpenRfp = rfps.some((r) => r.status === "OPEN");
  const mock = env().EMAIL_PROVIDER === "mock";
  const deadline = isoDateFromNow(7);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/tickets" className="text-xs text-stone-500 hover:underline">← Ocorrências</Link>
        <h1 className="mt-1 flex items-center gap-3 text-xl font-semibold">
          {t.category} <span className="font-mono text-sm text-stone-400">{ticketRef(t.id)}</span>
          {t.priority === "URGENT" && <Badge tone="red">Urgente</Badge>}
          {t.priority === "HIGH" && <Badge tone="amber">Prioridade alta</Badge>}
        </h1>
        <p className="text-sm text-stone-600">
          <Link href={`/admin/condominiums/${t.condominium_id}`} className="underline">{t.condo}</Link>
          {t.designation && ` · fração ${t.designation}`} · {t.source.toLowerCase()} · {fmtDateTime(t.created_at)}
        </p>
      </div>

      <Card title="Descrição" actions={<StatusSelect ticketId={t.id} status={t.status} />}>
        <p className="whitespace-pre-wrap text-sm">{t.description}</p>
        {t.reporter && (
          <p className="mt-2 text-xs text-stone-500">
            Reportado por {t.reporter}{t.reporter_phone && ` (+${t.reporter_phone})`}
          </p>
        )}
      </Card>

      {!hasOpenRfp && !rfps.some((r) => r.status === "AWARDED") && (
        <Card title="Orçamentos">
          <RequestQuotesForm ticketId={t.id} defaultScope={`${t.category}: ${t.description}`} defaultDeadline={deadline} />
        </Card>
      )}

      {rfps.map((r) => {
        const submitted = r.quotes.filter((q) => q.quote);
        const cheapest = Math.min(...submitted.map((q) => q.quote!.amountCents));
        const fastest = Math.min(...submitted.map((q) => q.quote!.leadTimeDays));
        const awarded = r.quotes.find((q) => q.quote?.id === r.awarded_quote_id);
        return (
          <Card
            key={r.id}
            title={`Pedido de orçamentos — ${r.status === "OPEN" ? `${submitted.length}/3 recebidos` : r.status === "AWARDED" ? `adjudicado a ${awarded?.vendorName}` : "cancelado"}`}
            actions={
              r.status === "OPEN" && mock && submitted.length < r.quotes.length ? (
                <ActionButton action={simulateQuotesAction.bind(null, t.id, r.id)} label="Simular propostas" variant="secondary" />
              ) : null
            }
          >
            <p className="mb-3 text-sm text-stone-600">
              {r.scope} · prazo {fmtDate(r.deadline)}
            </p>
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full">
                <thead className="border-y border-stone-100 bg-stone-50">
                  <tr>
                    <th className={th}></th>
                    {r.quotes.map((q) => (
                      <th key={q.invitationId} className={`${th} normal-case`}>
                        <span className="text-sm font-semibold text-stone-800">{q.vendorName}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  <tr>
                    <td className={`${td} text-stone-500`}>Preço</td>
                    {r.quotes.map((q) => (
                      <td key={q.invitationId} className={`${td} tabular-nums`}>
                        {q.quote ? (
                          <span className={q.quote.amountCents === cheapest ? "font-semibold text-brand-700" : ""}>
                            {formatEur(q.quote.amountCents)} {q.quote.amountCents === cheapest && submitted.length > 1 && <Badge tone="green">mais barato</Badge>}
                          </span>
                        ) : (
                          <span className="text-stone-400">{q.viewedAt ? "visto, sem resposta" : "por abrir"}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className={`${td} text-stone-500`}>Prazo de execução</td>
                    {r.quotes.map((q) => (
                      <td key={q.invitationId} className={td}>
                        {q.quote ? (
                          <span className={q.quote.leadTimeDays === fastest ? "font-semibold text-brand-700" : ""}>{q.quote.leadTimeDays} dias</span>
                        ) : "—"}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className={`${td} text-stone-500`}>Garantia</td>
                    {r.quotes.map((q) => <td key={q.invitationId} className={td}>{q.quote ? `${q.quote.warrantyMonths} meses` : "—"}</td>)}
                  </tr>
                  <tr>
                    <td className={`${td} text-stone-500`}>Notas</td>
                    {r.quotes.map((q) => <td key={q.invitationId} className={`${td} text-xs text-stone-600`}>{q.quote?.notes ?? "—"}</td>)}
                  </tr>
                  <tr>
                    <td className={`${td} text-stone-500`}>Link</td>
                    {r.quotes.map((q) => (
                      <td key={q.invitationId} className={`${td} text-xs`}>
                        <a href={q.link} target="_blank" className="break-all text-brand-700 underline">{q.link.replace(/^https?:\/\//, "")}</a>
                      </td>
                    ))}
                  </tr>
                  {r.status === "OPEN" && (
                    <tr>
                      <td className={td}></td>
                      {r.quotes.map((q) => (
                        <td key={q.invitationId} className={td}>
                          {q.quote && <ActionButton action={awardQuoteAction.bind(null, t.id, r.id, q.quote.id)} label="Adjudicar" />}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {r.status === "AWARDED" && (
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-semibold">Faturas do fornecedor</h3>
                {r.invoices.length === 0 ? (
                  <p className="text-sm text-stone-500">O fornecedor submete a fatura pelo mesmo link após concluir o trabalho.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {r.invoices.map((inv) => (
                      <li key={inv.id} className="flex flex-wrap items-center gap-3">
                        <span className="font-mono">{inv.invoice_number}</span>
                        {inv.has_file && <a href={`/admin/faturas/${inv.id}`} target="_blank" className="text-xs text-brand-700 underline">ficheiro</a>}
                        <span className="tabular-nums">{formatEur(inv.amountCents)}</span>
                        {awarded?.quote && inv.amountCents > awarded.quote.amountCents && <Badge tone="red">acima do orçamento</Badge>}
                        {inv.status === "PENDING_APPROVAL" ? (
                          <>
                            <ActionButton action={decideInvoiceAction.bind(null, t.id, inv.id, true)} label="Aprovar pagamento" />
                            <ActionButton action={decideInvoiceAction.bind(null, t.id, inv.id, false)} label="Rejeitar" variant="secondary" />
                          </>
                        ) : (
                          <Badge tone={inv.status === "APPROVED" ? "green" : "red"}>
                            {inv.status === "APPROVED" ? `Aprovada por ${inv.approved_by}` : "Rejeitada"}
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
