import "server-only";
import { sql } from "@/lib/db";
import { toCents } from "@/lib/money";

export type CondoSummary = {
  id: string;
  name: string;
  nif: string;
  city: string | null;
  fractionCount: number;
  billedCents: number;
  paidCents: number;
  overdueCents: number;
  upcomingCents: number;
  fractionsInDebt: number;
  openTickets: number;
};

type SummaryRow = {
  id: string; name: string; nif_condominio: string; city: string | null; fraction_count: string;
  billed_total: string; paid_total: string; overdue_total: string; upcoming_total: string;
  fractions_in_debt: string; open_tickets: string;
};

function mapSummary(r: SummaryRow): CondoSummary {
  return {
    id: r.id, name: r.name, nif: r.nif_condominio, city: r.city,
    fractionCount: Number(r.fraction_count),
    billedCents: toCents(r.billed_total), paidCents: toCents(r.paid_total),
    overdueCents: toCents(r.overdue_total), upcomingCents: toCents(r.upcoming_total),
    fractionsInDebt: Number(r.fractions_in_debt), openTickets: Number(r.open_tickets),
  };
}

export type PortfolioFilter = { q?: string; onlyDebt?: boolean };

export async function listCondominiums({ q, onlyDebt }: PortfolioFilter): Promise<CondoSummary[]> {
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const rows = await sql<SummaryRow[]>`
    select * from condominium_ledger_summary
    where (${like}::text is null or name ilike ${like} or nif_condominio like ${like} or city ilike ${like})
      and (${onlyDebt ?? false}::bool = false or overdue_total > 0)
    order by overdue_total desc, name`;
  return rows.map(mapSummary);
}

export async function getCondominium(id: string) {
  const [condo] = await sql<
    {
      id: string; name: string; nif_condominio: string; address: string | null; postal_code: string | null;
      city: string | null; bank_iban_current: string | null; moloni_company_id: number | null;
      ifthenpay_mb_key: string | null; ifthenpay_mbway_key: string | null;
    }[]
  >`select * from condominiums where id = ${id}`;
  if (!condo) return null;
  const [summary] = await sql<SummaryRow[]>`select * from condominium_ledger_summary where id = ${id}`;
  const budgets = await sql<{ id: string; fiscal_year: number; ordinary_amount: string; reserve_amount: string; reserve_fund_pct: string; installments: number }[]>`
    select id, fiscal_year, ordinary_amount, reserve_amount, reserve_fund_pct, installments
    from budgets where condominium_id = ${id} order by fiscal_year desc`;
  return { condo, summary: mapSummary(summary), budgets };
}

export type FractionRow = {
  id: string;
  designation: string;
  permilagem: string;
  ownerId: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  tenantName: string | null;
  paidCents: number;
  overdueCents: number;
  overdueCount: number;
};

export async function listFractions(condominiumId: string): Promise<FractionRow[]> {
  const rows = await sql<
    {
      id: string; designation: string; permilagem: string; owner_id: string | null; owner_name: string | null; owner_phone: string | null;
      tenant_name: string | null; paid_total: string; overdue_total: string; overdue_count: string;
    }[]
  >`
    select f.id, f.designation, f.permilagem,
      (select id from residents r where r.fraction_id = f.id and r.role = 'Proprietário' order by created_at limit 1) owner_id,
      (select full_name from residents r where r.fraction_id = f.id and r.role = 'Proprietário' order by created_at limit 1) owner_name,
      (select phone_number from residents r where r.fraction_id = f.id and r.role = 'Proprietário' order by created_at limit 1) owner_phone,
      (select full_name from residents r where r.fraction_id = f.id and r.role = 'Inquilino' order by created_at limit 1) tenant_name,
      coalesce(sum(q.amount_total) filter (where q.payment_status = 'PAID'), 0) paid_total,
      coalesce(sum(q.amount_total) filter (where q.payment_status = 'PENDING' and q.due_date < current_date), 0) overdue_total,
      count(q.id) filter (where q.payment_status = 'PENDING' and q.due_date < current_date) overdue_count
    from fractions f
    left join quota_charges q on q.fraction_id = f.id
    where f.condominium_id = ${condominiumId}
    group by f.id
    order by f.designation`;
  return rows.map((r) => ({
    id: r.id, designation: r.designation, permilagem: r.permilagem,
    ownerId: r.owner_id, ownerName: r.owner_name, ownerPhone: r.owner_phone, tenantName: r.tenant_name,
    paidCents: toCents(r.paid_total), overdueCents: toCents(r.overdue_total), overdueCount: Number(r.overdue_count),
  }));
}

export type ChargeRow = {
  id: string;
  orderSeq: string;
  designation: string;
  description: string;
  dueDate: string;
  amountCents: number;
  reserveCents: number;
  status: "PENDING" | "PAID" | "CANCELLED";
  overdue: boolean;
  mbEntity: string | null;
  mbReference: string | null;
  paidAt: Date | null;
  paidMethod: string | null;
  receiptId: string | null;
  receiptError: string | null;
};

export type ChargeFilter = "open" | "overdue" | "paid" | "all";

export async function listCharges(condominiumId: string, filter: ChargeFilter, limit = 300): Promise<ChargeRow[]> {
  const rows = await sql<
    {
      id: string; order_seq: string; designation: string; description: string; due_date: string;
      amount_total: string; amount_reserve: string; payment_status: ChargeRow["status"]; overdue: boolean;
      mb_entity: string | null; mb_reference: string | null; paid_at: Date | null; paid_method: string | null;
      moloni_document_id: string | null; moloni_error: string | null;
    }[]
  >`
    select q.id, q.order_seq, f.designation, q.description, to_char(q.due_date, 'YYYY-MM-DD') due_date,
      q.amount_total, q.amount_reserve, q.payment_status,
      (q.payment_status = 'PENDING' and q.due_date < current_date) overdue,
      q.mb_entity, q.mb_reference, q.paid_at, q.paid_method, q.moloni_document_id, q.moloni_error
    from quota_charges q join fractions f on f.id = q.fraction_id
    where q.condominium_id = ${condominiumId}
      and case ${filter}::text
        when 'open' then q.payment_status = 'PENDING' and q.due_date <= current_date + 45
        when 'overdue' then q.payment_status = 'PENDING' and q.due_date < current_date
        when 'paid' then q.payment_status = 'PAID'
        else true end
    order by q.due_date ${filter === "paid" ? sql`desc` : sql`asc`}, f.designation
    limit ${limit}`;
  return rows.map((r) => ({
    id: r.id, orderSeq: r.order_seq, designation: r.designation, description: r.description, dueDate: r.due_date,
    amountCents: toCents(r.amount_total), reserveCents: toCents(r.amount_reserve), status: r.payment_status,
    overdue: r.overdue, mbEntity: r.mb_entity, mbReference: r.mb_reference, paidAt: r.paid_at,
    paidMethod: r.paid_method, receiptId: r.moloni_document_id, receiptError: r.moloni_error,
  }));
}

export async function portfolioTotals() {
  const [r] = await sql<
    { condos: string; fractions: string; billed: string; paid: string; overdue: string; debtors: string; tickets: string }[]
  >`
    select count(*) condos, coalesce(sum(fraction_count), 0) fractions, coalesce(sum(billed_total), 0) billed,
      coalesce(sum(paid_total), 0) paid, coalesce(sum(overdue_total), 0) overdue,
      coalesce(sum(fractions_in_debt), 0) debtors, coalesce(sum(open_tickets), 0) tickets
    from condominium_ledger_summary`;
  return {
    condominiums: Number(r.condos),
    fractions: Number(r.fractions),
    billedCents: toCents(r.billed),
    paidCents: toCents(r.paid),
    overdueCents: toCents(r.overdue),
    fractionsInDebt: Number(r.debtors),
    openTickets: Number(r.tickets),
  };
}

export function collectionRate(paidCents: number, overdueCents: number): number | null {
  const due = paidCents + overdueCents;
  return due === 0 ? null : paidCents / due;
}
