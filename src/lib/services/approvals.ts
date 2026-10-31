import "server-only";
import { sql } from "@/lib/db";
import { toCents } from "@/lib/money";
import { MIN_OVERDUE_INSTALLMENTS } from "./collections";

/** Everything waiting on the administrator's one-click decision. */
export async function approvalsQueue() {
  const [invoices, minutes, urgent, quotesReady, debtors, receiptErrors] = await Promise.all([
    sql<{ id: string; ticket_id: string; vendor: string; invoice_number: string; amount: string; condo: string }[]>`
      select i.id, r.ticket_id, v.name vendor, i.invoice_number, i.amount, c.name condo
      from vendor_invoices i join vendor_quotes q on q.id = i.quote_id join vendors v on v.id = q.vendor_id
      join rfps r on r.id = q.rfp_id join maintenance_tickets t on t.id = r.ticket_id join condominiums c on c.id = t.condominium_id
      where i.status = 'PENDING_APPROVAL' order by i.submitted_at`,
    sql<{ assembly_id: string; condo: string; scheduled_at: Date }[]>`
      select m.assembly_id, c.name condo, a.scheduled_at from minutes m join assemblies a on a.id = m.assembly_id
      join condominiums c on c.id = a.condominium_id where m.status = 'DRAFT' order by a.scheduled_at`,
    sql<{ id: string; category: string; condo: string; created_at: Date }[]>`
      select t.id, t.category, c.name condo, t.created_at from maintenance_tickets t join condominiums c on c.id = t.condominium_id
      where t.priority = 'URGENT' and t.status in ('OPEN', 'AWAITING_QUOTES') order by t.created_at`,
    sql<{ ticket_id: string; category: string; condo: string }[]>`
      select r.ticket_id, t.category, c.name condo from rfps r join maintenance_tickets t on t.id = r.ticket_id
      join condominiums c on c.id = t.condominium_id
      where r.status = 'OPEN' and (select count(*) from vendor_quotes q where q.rfp_id = r.id) >= 3`,
    sql<{ n: string }[]>`
      select count(*) n from (
        select q.fraction_id from quota_charges q
        where q.payment_status = 'PENDING' and q.due_date < current_date
          and not exists (select 1 from legal_letters l where l.fraction_id = q.fraction_id and l.sent_at > now() - interval '30 days')
        group by q.fraction_id having count(*) >= ${MIN_OVERDUE_INSTALLMENTS}) x`,
    sql<{ n: string }[]>`select count(*) n from quota_charges where payment_status = 'PAID' and moloni_document_id is null and moloni_error is not null`,
  ]);
  return {
    invoices: invoices.map((i) => ({ ...i, amountCents: toCents(i.amount) })),
    minutes,
    urgent,
    quotesReady,
    debtorsWithoutLetter: Number(debtors[0].n),
    receiptErrors: Number(receiptErrors[0].n),
  };
}
