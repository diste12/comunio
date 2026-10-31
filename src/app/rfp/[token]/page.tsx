import { Suspense } from "react";
import { formatEur, toCents } from "@/lib/money";
import { fmtDate } from "@/lib/pdf/document";
import { invitationByToken } from "@/lib/services/rfps";
import { InvoiceForm, QuoteForm } from "./_forms";

export const metadata = { title: "Pedido de orçamento", robots: { index: false } };

export default function RfpPage({ params }: PageProps<"/rfp/[token]">) {
  return (
    <main className="mx-auto w-full max-w-lg flex-1 space-y-4 p-5">
      <Suspense fallback={<p className="text-stone-500">A carregar…</p>}>
        <Rfp params={params} />
      </Suspense>
    </main>
  );
}

async function Rfp({ params }: { params: PageProps<"/rfp/[token]">["params"] }) {
  const { token } = await params;
  const inv = await invitationByToken(token);
  if (!inv) return <p className="pt-10 text-center text-stone-600">Link inválido.</p>;
  const closed = inv.rfp_status !== "OPEN" || inv.deadlinePassed;
  return (
    <>
      <header>
        <p className="text-xs uppercase tracking-wide text-stone-500">Pedido de orçamento · {inv.vendor_name}</p>
        <h1 className="text-xl font-semibold">{inv.category}</h1>
        <p className="text-sm text-stone-600">{inv.condo} — {[inv.address, inv.city].filter(Boolean).join(", ")}</p>
      </header>
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold">Trabalho a orçamentar</h2>
        <p className="whitespace-pre-wrap text-sm">{inv.scope}</p>
        <p className="mt-2 text-xs text-stone-500">Prazo de resposta: {fmtDate(inv.deadline)}</p>
      </section>
      {inv.awardedToMe ? (
        <section className="space-y-3 rounded-xl border border-brand-600 bg-white p-4">
          <h2 className="text-sm font-semibold text-brand-700">Proposta adjudicada ({formatEur(toCents(inv.amount))})</h2>
          <p className="text-sm text-stone-600">Após concluir o trabalho, submeta aqui a fatura. O pagamento é feito após aprovação da administração.</p>
          {inv.invoices.map((i) => (
            <p key={i.invoice_number} className="text-sm">
              Fatura {i.invoice_number} — {formatEur(i.amountCents)} —{" "}
              {i.status === "APPROVED" ? "aprovada" : i.status === "REJECTED" ? "rejeitada" : "a aguardar aprovação"}
            </p>
          ))}
          <InvoiceForm token={token} />
        </section>
      ) : closed ? (
        <section className="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-600">
          {inv.rfp_status === "AWARDED" ? "Este pedido já foi adjudicado. Obrigado pela sua proposta." : "O prazo para submissão terminou."}
          {inv.amount && <p className="mt-1">A sua proposta: {formatEur(toCents(inv.amount))}.</p>}
        </section>
      ) : (
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <QuoteForm
            token={token}
            initial={{
              amount: inv.amount ? inv.amount.replace(".", ",") : undefined,
              lead: inv.lead_time_days ?? undefined,
              warranty: inv.warranty_months ?? undefined,
              notes: inv.notes ?? undefined,
            }}
          />
        </section>
      )}
    </>
  );
}
