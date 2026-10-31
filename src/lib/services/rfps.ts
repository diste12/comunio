import "server-only";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { centsToDecimal, formatEur, toCents } from "@/lib/money";
import { escapeHtml, sendEmail } from "@/lib/messaging/email";
import { fmtDate } from "@/lib/pdf/document";
import { randomToken } from "@/lib/tokens";

export class RfpError extends Error {}

export const QUOTES_PER_RFP = 3;
const rfpLink = (token: string) => `${env().APP_URL}/rfp/${token}`;

/**
 * Admin clicks "Request quotes": pick 3 vendors for the ticket's category,
 * create one capability link per vendor and email it.
 */
export async function requestQuotes(ticketId: string, input: { scope: string; deadline: string }) {
  const [ticket] = await sql<{ id: string; category: string; status: string; condo: string; city: string | null }[]>`
    select t.id, t.category, t.status, c.name condo, c.city
    from maintenance_tickets t join condominiums c on c.id = t.condominium_id where t.id = ${ticketId}`;
  if (!ticket) throw new RfpError("Ocorrência não encontrada.");
  const [open] = await sql`select 1 from rfps where ticket_id = ${ticketId} and status = 'OPEN'`;
  if (open) throw new RfpError("Já existe um pedido de orçamentos em curso.");

  // Category specialists first, then generalists; least-recently-invited first to spread work.
  const vendors = await sql<{ id: string; name: string; email: string | null }[]>`
    select v.id, v.name, v.email from vendors v
    order by (${ticket.category} = any(v.categories)) desc,
             (select max(i.created_at) from rfp_invitations i where i.vendor_id = v.id) asc nulls first,
             v.name
    limit ${QUOTES_PER_RFP}`;
  if (vendors.length < QUOTES_PER_RFP) throw new RfpError(`São necessários pelo menos ${QUOTES_PER_RFP} fornecedores registados.`);

  const { rfpId, invites } = await sql.begin(async (tx) => {
    const [rfp] = await tx<{ id: string }[]>`
      insert into rfps ${tx({ ticket_id: ticketId, scope: input.scope, deadline: input.deadline })} returning id`;
    const invites = vendors.map((v) => ({ vendor: v, token: randomToken(18) }));
    await tx`insert into rfp_invitations ${tx(invites.map((i) => ({ rfp_id: rfp.id, vendor_id: i.vendor.id, token: i.token })))}`;
    await tx`update maintenance_tickets set status = 'AWAITING_QUOTES', updated_at = now() where id = ${ticketId}`;
    return { rfpId: rfp.id, invites };
  });

  for (const i of invites) {
    if (!i.vendor.email) continue;
    await sendEmail({
      to: i.vendor.email,
      subject: `Pedido de orçamento — ${ticket.category} — ${ticket.city ?? ticket.condo}`,
      html: `<p>Bom dia,</p><p>Solicitamos orçamento para o seguinte trabalho num condomínio em ${escapeHtml(ticket.city ?? "")}:</p>
<blockquote>${escapeHtml(input.scope)}</blockquote>
<p>Prazo para resposta: <strong>${escapeHtml(fmtDate(input.deadline))}</strong>.</p>
<p><a href="${rfpLink(i.token)}">Submeter orçamento</a></p><p>Obrigado,<br/>A Administração</p>`,
    }).catch((e) => console.error(`[rfp] email to ${i.vendor.name} failed: ${(e as Error).message}`));
  }
  return { rfpId, links: invites.map((i) => ({ vendor: i.vendor.name, url: rfpLink(i.token) })) };
}

export type QuoteRow = {
  invitationId: string;
  vendorId: string;
  vendorName: string;
  link: string;
  viewedAt: Date | null;
  quote: { id: string; amountCents: number; leadTimeDays: number; warrantyMonths: number; notes: string | null; submittedAt: Date } | null;
};

export async function rfpsForTicket(ticketId: string) {
  const rfps = await sql<{ id: string; scope: string; deadline: string; status: string; awarded_quote_id: string | null; created_at: Date }[]>`
    select id, scope, to_char(deadline, 'YYYY-MM-DD') deadline, status, awarded_quote_id, created_at
    from rfps where ticket_id = ${ticketId} order by created_at desc`;
  const out = [];
  for (const r of rfps) {
    const rows = await sql<
      { invitation_id: string; vendor_id: string; name: string; token: string; viewed_at: Date | null; quote_id: string | null;
        amount: string | null; lead_time_days: number | null; warranty_months: number | null; notes: string | null; submitted_at: Date | null }[]
    >`
      select i.id invitation_id, v.id vendor_id, v.name, i.token, i.viewed_at, q.id quote_id, q.amount, q.lead_time_days,
             q.warranty_months, q.notes, q.submitted_at
      from rfp_invitations i join vendors v on v.id = i.vendor_id left join vendor_quotes q on q.invitation_id = i.id
      where i.rfp_id = ${r.id} order by v.name`;
    const invoices = r.awarded_quote_id
      ? await sql<{ id: string; invoice_number: string; amount: string; status: string; submitted_at: Date; approved_by: string | null }[]>`
          select id, invoice_number, amount, status, submitted_at, approved_by from vendor_invoices
          where quote_id = ${r.awarded_quote_id} order by submitted_at`
      : [];
    out.push({
      ...r,
      quotes: rows.map<QuoteRow>((q) => ({
        invitationId: q.invitation_id, vendorId: q.vendor_id, vendorName: q.name, link: rfpLink(q.token), viewedAt: q.viewed_at,
        quote: q.quote_id
          ? { id: q.quote_id, amountCents: toCents(q.amount), leadTimeDays: q.lead_time_days!, warrantyMonths: q.warranty_months!, notes: q.notes, submittedAt: q.submitted_at! }
          : null,
      })),
      invoices: invoices.map((i) => ({ ...i, amountCents: toCents(i.amount) })),
    });
  }
  return out;
}

/** Vendor-facing view of an invitation (no resident or financial data). */
export async function invitationByToken(token: string) {
  const [row] = await sql<
    { invitation_id: string; rfp_id: string; vendor_id: string; vendor_name: string; scope: string; deadline: string; rfp_status: string;
      awarded_quote_id: string | null; category: string; condo: string; address: string | null; city: string | null;
      quote_id: string | null; amount: string | null; lead_time_days: number | null; warranty_months: number | null; notes: string | null }[]
  >`
    select i.id invitation_id, r.id rfp_id, v.id vendor_id, v.name vendor_name, r.scope, to_char(r.deadline, 'YYYY-MM-DD') deadline,
           r.status rfp_status, r.awarded_quote_id, t.category, c.name condo, c.address, c.city,
           q.id quote_id, q.amount, q.lead_time_days, q.warranty_months, q.notes
    from rfp_invitations i
    join rfps r on r.id = i.rfp_id join vendors v on v.id = i.vendor_id
    join maintenance_tickets t on t.id = r.ticket_id join condominiums c on c.id = t.condominium_id
    left join vendor_quotes q on q.invitation_id = i.id
    where i.token = ${token}`;
  if (!row) return null;
  await sql`update rfp_invitations set viewed_at = coalesce(viewed_at, now()) where id = ${row.invitation_id}`;
  const awardedToMe = Boolean(row.quote_id && row.awarded_quote_id === row.quote_id);
  const invoices = awardedToMe
    ? await sql<{ invoice_number: string; amount: string; status: string }[]>`
        select invoice_number, amount, status from vendor_invoices where quote_id = ${row.quote_id} order by submitted_at`
    : [];
  return {
    ...row,
    deadlinePassed: row.deadline < new Date().toISOString().slice(0, 10),
    awardedToMe,
    invoices: invoices.map((i) => ({ ...i, amountCents: toCents(i.amount) })),
  };
}

export async function submitQuote(token: string, q: { amountCents: number; leadTimeDays: number; warrantyMonths: number; notes: string | null }) {
  const inv = await invitationByToken(token);
  if (!inv) throw new RfpError("Link inválido.");
  if (inv.rfp_status !== "OPEN") throw new RfpError("Este pedido de orçamento já foi encerrado.");
  if (inv.deadlinePassed) throw new RfpError("O prazo para submissão terminou.");
  await sql`
    insert into vendor_quotes ${sql({
      rfp_id: inv.rfp_id, invitation_id: inv.invitation_id, vendor_id: inv.vendor_id,
      amount: centsToDecimal(q.amountCents), lead_time_days: q.leadTimeDays, warranty_months: q.warrantyMonths, notes: q.notes,
    })}
    on conflict (invitation_id) do update set amount = excluded.amount, lead_time_days = excluded.lead_time_days,
      warranty_months = excluded.warranty_months, notes = excluded.notes, submitted_at = now()`;
}

/** Human in the loop: the administrator picks the winning quote. */
export async function awardQuote(rfpId: string, quoteId: string) {
  const winner = await sql.begin(async (tx) => {
    const [r] = await tx<{ ticket_id: string }[]>`
      update rfps set status = 'AWARDED', awarded_quote_id = ${quoteId}
      where id = ${rfpId} and status = 'OPEN' and exists (select 1 from vendor_quotes q where q.id = ${quoteId} and q.rfp_id = ${rfpId})
      returning ticket_id`;
    if (!r) throw new RfpError("Não foi possível adjudicar (pedido encerrado ou proposta inválida).");
    await tx`update maintenance_tickets set status = 'IN_PROGRESS', updated_at = now() where id = ${r.ticket_id}`;
    const [w] = await tx<{ name: string; email: string | null; amount: string; token: string }[]>`
      select v.name, v.email, q.amount, i.token from vendor_quotes q join vendors v on v.id = q.vendor_id
      join rfp_invitations i on i.id = q.invitation_id where q.id = ${quoteId}`;
    return w;
  });
  if (winner.email) {
    await sendEmail({
      to: winner.email,
      subject: "Orçamento adjudicado",
      html: `<p>A sua proposta de ${escapeHtml(formatEur(toCents(winner.amount)))} foi adjudicada. Após conclusão, submeta a fatura em <a href="${rfpLink(winner.token)}">${rfpLink(winner.token)}</a>.</p>`,
    }).catch(() => {});
  }
}

export async function submitInvoice(token: string, input: { number: string; amountCents: number }) {
  const inv = await invitationByToken(token);
  if (!inv || !inv.awardedToMe) throw new RfpError("Só o fornecedor adjudicado pode submeter faturas.");
  await sql`
    insert into vendor_invoices ${sql({ quote_id: inv.quote_id, invoice_number: input.number, amount: centsToDecimal(input.amountCents) })}
    on conflict (quote_id, invoice_number) do nothing`;
}

export async function decideInvoice(invoiceId: string, approve: boolean, by: string) {
  const [row] = await sql`
    update vendor_invoices set status = ${approve ? "APPROVED" : "REJECTED"}, approved_at = now(), approved_by = ${by}
    where id = ${invoiceId} and status = 'PENDING_APPROVAL' returning id`;
  if (!row) throw new RfpError("Fatura já decidida.");
}

/** Dev/demo: three vendors answer with plausible prices. */
export async function simulateVendorQuotes(rfpId: string) {
  const invites = await sql<{ token: string }[]>`
    select i.token from rfp_invitations i left join vendor_quotes q on q.invitation_id = i.id
    where i.rfp_id = ${rfpId} and q.id is null`;
  const base = 400 + Math.floor(Math.random() * 1600);
  for (const [k, i] of invites.entries()) {
    await submitQuote(i.token, {
      amountCents: Math.round(base * (0.85 + Math.random() * 0.45)) * 100,
      leadTimeDays: 2 + ((k * 5 + Math.floor(Math.random() * 6)) % 15),
      warrantyMonths: [6, 12, 24][k % 3],
      notes: ["Inclui deslocação e materiais.", "Materiais faturados à parte.", "Garantia alargada mediante contrato de manutenção."][k % 3],
    });
  }
  return invites.length;
}

export async function listVendors() {
  return sql<{ id: string; name: string; nif: string | null; email: string | null; phone_number: string | null; categories: string[]; invitations: string; wins: string }[]>`
    select v.*, (select count(*) from rfp_invitations i where i.vendor_id = v.id) invitations,
      (select count(*) from rfps r join vendor_quotes q on q.id = r.awarded_quote_id where q.vendor_id = v.id) wins
    from vendors v order by v.name`;
}

export async function createVendor(v: { name: string; nif: string | null; email: string | null; phone: string | null; categories: string[] }) {
  await sql`insert into vendors ${sql({ name: v.name, nif: v.nif, email: v.email, phone_number: v.phone, categories: v.categories })}`;
}
