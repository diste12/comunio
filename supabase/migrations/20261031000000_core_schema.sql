-- Comunio — core schema (PRD §5, Day 1)
-- Extends the PRD tables with what the ledger, payments and billing flows need:
-- budgets, per-condominium provider config, payment event log, ticket context.

-- ---------------------------------------------------------------------------
-- 1. CONDOMINIUM MASTER
-- ---------------------------------------------------------------------------
create table condominiums (
    id uuid primary key default gen_random_uuid(),
    nif_condominio varchar(9) unique not null check (nif_condominio ~ '^[0-9]{9}$'),
    name varchar(255) not null,
    address text,
    postal_code varchar(8),
    city varchar(100),
    bank_iban_current varchar(34),
    -- Moloni multi-company: one Moloni company per condominium NIF
    moloni_company_id integer,
    moloni_document_set_id integer,
    moloni_product_id integer,
    -- Ifthenpay keys are per condominium: each one collects into its own IBAN
    ifthenpay_mb_key text,
    ifthenpay_mbway_key text,
    created_at timestamp with time zone default now()
);

-- ---------------------------------------------------------------------------
-- 2. FRACTION (UNIT)
-- ---------------------------------------------------------------------------
create table fractions (
    id uuid primary key default gen_random_uuid(),
    condominium_id uuid not null references condominiums(id) on delete cascade,
    designation varchar(10) not null,
    permilagem numeric(6,2) not null check (permilagem > 0 and permilagem <= 1000),
    created_at timestamp with time zone default now(),
    unique (condominium_id, designation)
);
create index fractions_condominium_idx on fractions(condominium_id);

-- ---------------------------------------------------------------------------
-- 3. RESIDENTS
-- ---------------------------------------------------------------------------
create table residents (
    id uuid primary key default gen_random_uuid(),
    fraction_id uuid not null references fractions(id) on delete cascade,
    full_name varchar(255) not null,
    phone_number varchar(20) not null, -- WhatsApp ID, E.164 without "+" (e.g. 351912345678)
    email varchar(255),
    nif varchar(9) check (nif is null or nif ~ '^[0-9]{9}$'),
    role varchar(20) not null check (role in ('Proprietário', 'Inquilino')),
    -- Lei 8/2022: convocations by email only with recorded consent
    has_recorded_email_consent boolean not null default false,
    created_at timestamp with time zone default now()
);
create index residents_fraction_idx on residents(fraction_id);
create index residents_phone_idx on residents(phone_number);

-- ---------------------------------------------------------------------------
-- 4. BUDGETS (orçamento anual) — source for the Permilagem Engine
-- ---------------------------------------------------------------------------
create table budgets (
    id uuid primary key default gen_random_uuid(),
    condominium_id uuid not null references condominiums(id) on delete cascade,
    fiscal_year smallint not null check (fiscal_year between 2000 and 2100),
    ordinary_amount numeric(12,2) not null check (ordinary_amount > 0),
    -- DL 268/94 art. 4.º: reserve fund ≥ 10% of each owner's share of expenses
    reserve_fund_pct numeric(5,2) not null default 10 check (reserve_fund_pct >= 10),
    installments smallint not null default 12 check (installments between 1 and 12),
    due_day smallint not null default 8 check (due_day between 1 and 31),
    reserve_amount numeric(12,2) not null,
    created_at timestamp with time zone default now(),
    unique (condominium_id, fiscal_year)
);

-- ---------------------------------------------------------------------------
-- 5. FINANCIAL LEDGER (QUOTAS)
-- ---------------------------------------------------------------------------
create table quota_charges (
    id uuid primary key default gen_random_uuid(),
    -- short numeric id used as the provider orderId (Ifthenpay limits length)
    order_seq bigint generated always as identity unique,
    fraction_id uuid not null references fractions(id) on delete cascade,
    condominium_id uuid not null references condominiums(id) on delete cascade,
    budget_id uuid references budgets(id) on delete cascade,
    installment smallint,
    description varchar(255) not null,
    amount_ordinary numeric(10,2) not null default 0,
    amount_reserve numeric(10,2) not null default 0,
    amount_total numeric(10,2) not null check (amount_total > 0),
    due_date date not null,
    mb_entity varchar(5),
    mb_reference varchar(9),
    mb_request_id varchar(100),
    mbway_request_id varchar(100),
    payment_status varchar(20) not null default 'PENDING'
        check (payment_status in ('PENDING', 'PAID', 'CANCELLED')),
    paid_at timestamp with time zone,
    paid_method varchar(20) check (paid_method in ('MULTIBANCO', 'MBWAY', 'TRANSFER', 'CASH')),
    moloni_document_id varchar(100),
    moloni_error text,
    created_at timestamp with time zone default now(),
    check (amount_total = amount_ordinary + amount_reserve),
    unique (budget_id, fraction_id, installment)
);
create index quota_charges_fraction_idx on quota_charges(fraction_id);
create index quota_charges_condo_status_idx on quota_charges(condominium_id, payment_status, due_date);
create unique index quota_charges_mb_ref_idx on quota_charges(mb_entity, mb_reference)
    where mb_reference is not null;
create index quota_charges_receipt_retry_idx on quota_charges(paid_at)
    where payment_status = 'PAID' and moloni_document_id is null;

-- ---------------------------------------------------------------------------
-- 6. PAYMENT EVENTS (webhook log, idempotency)
-- ---------------------------------------------------------------------------
create table payment_events (
    id uuid primary key default gen_random_uuid(),
    provider varchar(20) not null,
    idempotency_key varchar(200) not null,
    quota_charge_id uuid references quota_charges(id) on delete set null,
    amount numeric(10,2),
    outcome varchar(30) not null, -- APPLIED | DUPLICATE | NOT_FOUND | AMOUNT_MISMATCH | ALREADY_PAID
    payload jsonb not null,
    received_at timestamp with time zone default now(),
    unique (provider, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- 7. MAINTENANCE TICKETS
-- ---------------------------------------------------------------------------
create table maintenance_tickets (
    id uuid primary key default gen_random_uuid(),
    condominium_id uuid references condominiums(id) on delete cascade,
    reported_by uuid references residents(id) on delete set null,
    category varchar(50) not null,
    description text not null,
    status varchar(30) not null default 'OPEN'
        check (status in ('OPEN', 'IN_PROGRESS', 'AWAITING_QUOTES', 'RESOLVED', 'CLOSED')),
    priority varchar(10) not null default 'NORMAL' check (priority in ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
    source varchar(20) not null default 'ADMIN' check (source in ('WHATSAPP', 'PORTAL', 'ADMIN')),
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);
create index maintenance_tickets_condo_status_idx on maintenance_tickets(condominium_id, status);

-- ---------------------------------------------------------------------------
-- Ledger rollup per condominium (powers the 200-building dashboard)
-- ---------------------------------------------------------------------------
create view condominium_ledger_summary with (security_invoker = true) as
select
    c.id,
    c.name,
    c.nif_condominio,
    c.city,
    (select count(*) from fractions f where f.condominium_id = c.id) as fraction_count,
    coalesce(sum(q.amount_total) filter (where q.payment_status <> 'CANCELLED'), 0) as billed_total,
    coalesce(sum(q.amount_total) filter (where q.payment_status = 'PAID'), 0) as paid_total,
    coalesce(sum(q.amount_total) filter (where q.payment_status = 'PENDING' and q.due_date < current_date), 0) as overdue_total,
    coalesce(sum(q.amount_total) filter (where q.payment_status = 'PENDING' and q.due_date >= current_date), 0) as upcoming_total,
    count(distinct q.fraction_id) filter (where q.payment_status = 'PENDING' and q.due_date < current_date) as fractions_in_debt,
    (select count(*) from maintenance_tickets t where t.condominium_id = c.id and t.status in ('OPEN', 'IN_PROGRESS', 'AWAITING_QUOTES')) as open_tickets
from condominiums c
left join quota_charges q on q.condominium_id = c.id
group by c.id;

-- ---------------------------------------------------------------------------
-- Security: the app talks to Postgres from the server only (Clerk-authenticated
-- admin, signed resident sessions). RLS on with no policies = the anon/
-- authenticated Supabase API roles see nothing.
-- ---------------------------------------------------------------------------
alter table condominiums enable row level security;
alter table fractions enable row level security;
alter table residents enable row level security;
alter table budgets enable row level security;
alter table quota_charges enable row level security;
alter table payment_events enable row level security;
alter table maintenance_tickets enable row level security;
