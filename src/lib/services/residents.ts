import "server-only";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { escapeHtml, sendEmail } from "@/lib/messaging/email";
import { toCents } from "@/lib/money";
import { randomToken, sha256 } from "@/lib/tokens";
import { ensureReferenceForCharge } from "./references";

export type ResidentContext = {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: "Proprietário" | "Inquilino";
  fractionId: string;
  designation: string;
  permilagem: string;
  condominiumId: string;
  condominiumName: string;
};

const select = sql`
  select r.id, r.full_name, r.phone_number, r.email, r.role, f.id fraction_id, f.designation, f.permilagem,
         c.id condominium_id, c.name condominium_name
  from residents r join fractions f on f.id = r.fraction_id join condominiums c on c.id = f.condominium_id`;

type Row = {
  id: string; full_name: string; phone_number: string; email: string | null; role: ResidentContext["role"];
  fraction_id: string; designation: string; permilagem: string; condominium_id: string; condominium_name: string;
};
const map = (r: Row): ResidentContext => ({
  id: r.id, fullName: r.full_name, phone: r.phone_number, email: r.email, role: r.role,
  fractionId: r.fraction_id, designation: r.designation, permilagem: r.permilagem,
  condominiumId: r.condominium_id, condominiumName: r.condominium_name,
});

/** A phone can belong to several fractions (owner of more than one unit). */
export async function residentsByPhone(phone: string): Promise<ResidentContext[]> {
  const rows = await sql<Row[]>`${select} where r.phone_number = ${phone} order by r.role, f.designation`;
  return rows.map(map);
}

export async function residentById(id: string): Promise<ResidentContext | null> {
  const [row] = await sql<Row[]>`${select} where r.id = ${id}`;
  return row ? map(row) : null;
}

export const isOwner = (r: ResidentContext) => r.role === "Proprietário";

export type ResidentCharge = {
  id: string;
  description: string;
  dueDate: string;
  amountCents: number;
  status: "PENDING" | "PAID" | "CANCELLED";
  overdue: boolean;
  mbEntity: string | null;
  mbReference: string | null;
  paidAt: Date | null;
  hasReceipt: boolean;
};

export async function chargesForFraction(fractionId: string, opts: { pendingOnly?: boolean; horizonDays?: number } = {}) {
  const rows = await sql<
    { id: string; description: string; due_date: string; amount_total: string; payment_status: ResidentCharge["status"];
      overdue: boolean; mb_entity: string | null; mb_reference: string | null; paid_at: Date | null; moloni_document_id: string | null }[]
  >`
    select id, description, to_char(due_date, 'YYYY-MM-DD') due_date, amount_total, payment_status,
           (payment_status = 'PENDING' and due_date < current_date) overdue,
           mb_entity, mb_reference, paid_at, moloni_document_id
    from quota_charges
    where fraction_id = ${fractionId} and payment_status <> 'CANCELLED'
      and (${opts.pendingOnly ?? false}::bool = false or payment_status = 'PENDING')
      and (${opts.horizonDays ?? null}::int is null or due_date <= current_date + ${opts.horizonDays ?? 0}::int)
    order by due_date`;
  return rows.map<ResidentCharge>((r) => ({
    id: r.id, description: r.description, dueDate: r.due_date, amountCents: toCents(r.amount_total),
    status: r.payment_status, overdue: r.overdue, mbEntity: r.mb_entity, mbReference: r.mb_reference,
    paidAt: r.paid_at, hasReceipt: Boolean(r.moloni_document_id),
  }));
}

/** Pending charges due within 45 days, with Multibanco references issued on demand (zero-touch). */
export async function payableCharges(fractionId: string): Promise<ResidentCharge[]> {
  const charges = await chargesForFraction(fractionId, { pendingOnly: true, horizonDays: 45 });
  for (const c of charges) {
    if (!c.mbReference) {
      const ref = await ensureReferenceForCharge(c.id);
      c.mbEntity = ref.entity;
      c.mbReference = ref.reference;
    }
  }
  return charges;
}

export async function createTicket(args: {
  residentId: string | null;
  condominiumId: string;
  fractionId: string | null;
  category: string;
  description: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  source: "WHATSAPP" | "PORTAL" | "ADMIN";
}) {
  const [row] = await sql<{ id: string; created_at: Date }[]>`
    insert into maintenance_tickets ${sql({
      reported_by: args.residentId, condominium_id: args.condominiumId, fraction_id: args.fractionId,
      category: args.category.slice(0, 50), description: args.description, priority: args.priority, source: args.source,
    })} returning id, created_at`;
  if (args.priority === "URGENT") await alertAdmins(row.id, args).catch((e) => console.error("[ticket] alert failed:", (e as Error).message));
  return row;
}

/** Urgent tickets (floods, gas, people stuck) page the administrator by email. */
async function alertAdmins(ticketId: string, t: { condominiumId: string; category: string; description: string }) {
  const admins = env().ADMIN_EMAILS.split(",").map((e) => e.trim()).filter(Boolean);
  if (admins.length === 0) return;
  const [c] = await sql<{ name: string }[]>`select name from condominiums where id = ${t.condominiumId}`;
  for (const to of admins) {
    await sendEmail({
      to,
      subject: `URGENTE: ${t.category} — ${c?.name ?? ""}`,
      html: `<p><strong>${escapeHtml(t.category)}</strong> em ${escapeHtml(c?.name ?? "")}</p><p>${escapeHtml(t.description)}</p>
<p><a href="${env().APP_URL}/admin/tickets/${ticketId}">Abrir ocorrência</a></p>`,
    });
  }
}

export type TicketSummary = { id: string; category: string; description: string; status: string; priority: string; createdAt: Date };

export async function openTicketsForCondominium(condominiumId: string, limit = 20): Promise<TicketSummary[]> {
  const rows = await sql<{ id: string; category: string; description: string; status: string; priority: string; created_at: Date }[]>`
    select id, category, description, status, priority, created_at from maintenance_tickets
    where condominium_id = ${condominiumId}
    order by (status in ('RESOLVED', 'CLOSED')), created_at desc limit ${limit}`;
  return rows.map((r) => ({ ...r, createdAt: r.created_at }));
}

export async function nextAssembly(condominiumId: string) {
  const [a] = await sql<{ id: string; scheduled_at: Date; location: string; online_url: string | null; kind: string }[]>`
    select id, scheduled_at, location, online_url, kind from assemblies
    where condominium_id = ${condominiumId} and status in ('CONVOKED', 'IN_PROGRESS') and scheduled_at > now() - interval '1 day'
    order by scheduled_at limit 1`;
  return a ?? null;
}

const MAGIC_LINK_TTL_HOURS = 72;

/** Create a passwordless portal link. Only the token hash is stored. */
export async function createMagicLink(residentId: string): Promise<string> {
  const token = randomToken();
  await sql`
    insert into resident_login_tokens ${sql({
      resident_id: residentId,
      token_hash: sha256(token),
      expires_at: new Date(Date.now() + MAGIC_LINK_TTL_HOURS * 3_600_000),
    })}`;
  return `${env().APP_URL}/r/${token}`;
}

/** Consume a magic-link token; returns the resident id if valid. */
export async function consumeMagicLink(token: string): Promise<string | null> {
  const [row] = await sql<{ resident_id: string }[]>`
    update resident_login_tokens set used_at = now()
    where token_hash = ${sha256(token)} and used_at is null and expires_at > now()
    returning resident_id`;
  return row?.resident_id ?? null;
}

export async function peekMagicLink(token: string): Promise<{ firstName: string } | null> {
  const [row] = await sql<{ full_name: string }[]>`
    select r.full_name from resident_login_tokens t join residents r on r.id = t.resident_id
    where t.token_hash = ${sha256(token)} and t.used_at is null and t.expires_at > now()`;
  return row ? { firstName: row.full_name.split(" ")[0] } : null;
}
