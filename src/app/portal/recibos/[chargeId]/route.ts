import { redirect } from "next/navigation";
import { z } from "zod";
import { billingProvider } from "@/lib/billing";
import { sql } from "@/lib/db";
import { formatEur, toCents } from "@/lib/money";
import { fmtDate, pdfResponse, renderPdf } from "@/lib/pdf/document";
import { currentResident } from "@/lib/resident-session";
import { isOwner } from "@/lib/services/residents";

/** Receipt download: the certified Moloni PDF when available, else a payment statement. */
export async function GET(_req: Request, ctx: RouteContext<"/portal/recibos/[chargeId]">) {
  const { chargeId } = await ctx.params;
  const me = await currentResident();
  if (!me || !isOwner(me) || !z.uuid().safeParse(chargeId).success) return new Response("Não autorizado", { status: 403 });

  const [c] = await sql<
    { description: string; amount_total: string; amount_reserve: string; paid_at: Date; paid_method: string | null;
      moloni_document_id: string; moloni_company_id: number | null; name: string; nif_condominio: string }[]
  >`
    select q.description, q.amount_total, q.amount_reserve, q.paid_at, q.paid_method, q.moloni_document_id,
           c.moloni_company_id, c.name, c.nif_condominio
    from quota_charges q join condominiums c on c.id = q.condominium_id
    where q.id = ${chargeId} and q.fraction_id = ${me.fractionId} and q.payment_status = 'PAID' and q.moloni_document_id is not null`;
  if (!c) return new Response("Recibo não encontrado", { status: 404 });

  const url = await billingProvider().documentPdfUrl(c.moloni_company_id, c.moloni_document_id).catch(() => null);
  if (url) redirect(url);

  const pdf = await renderPdf(
    [
      { type: "title", text: "Comprovativo de pagamento de quota" },
      { type: "paragraph", text: `${c.name} — NIF ${c.nif_condominio}` },
      { type: "spacer" },
      {
        type: "table",
        columns: [{ label: "Campo", width: 0.35 }, { label: "Valor", width: 0.65 }],
        rows: [
          ["Condómino", me.fullName],
          ["Fração", me.designation],
          ["Descrição", c.description],
          ["Valor pago", formatEur(toCents(c.amount_total))],
          ["Dos quais fundo comum de reserva", formatEur(toCents(c.amount_reserve))],
          ["Data de pagamento", fmtDate(c.paid_at)],
          ["Meio", c.paid_method === "MBWAY" ? "MB WAY" : c.paid_method === "MULTIBANCO" ? "Multibanco" : (c.paid_method ?? "—")],
          ["Documento", c.moloni_document_id],
        ],
      },
      {
        type: "small",
        text: "Documento informativo. O recibo certificado pela AT é emitido pelo programa de faturação do condomínio.",
      },
    ],
    { title: "Comprovativo de pagamento", footer: c.name },
  );
  return pdfResponse(pdf, `recibo-${me.designation}-${chargeId.slice(0, 8)}.pdf`);
}
