-- Comunio — bank reconciliation (SaltEdge / statement import), hybrid assembly
-- self-service, vendor invoice files.

alter table condominiums
    add column saltedge_connection_id varchar(64),
    add column saltedge_account_id varchar(64),
    add column bank_synced_at timestamp with time zone;

create table bank_transactions (
    id uuid primary key default gen_random_uuid(),
    condominium_id uuid not null references condominiums(id) on delete cascade,
    source varchar(10) not null check (source in ('SALTEDGE', 'CSV', 'MOCK')),
    external_id varchar(128) not null,
    booked_on date not null,
    amount numeric(12,2) not null, -- positive = credit
    description text not null default '',
    counterparty_name varchar(255),
    status varchar(10) not null default 'UNMATCHED' check (status in ('UNMATCHED', 'MATCHED', 'IGNORED')),
    match_reason text,
    matched_by varchar(255), -- 'AUTO' or the admin who confirmed
    created_at timestamp with time zone default now(),
    unique (condominium_id, source, external_id)
);
create index bank_transactions_status_idx on bank_transactions(status, booked_on desc);

create table bank_transaction_matches (
    transaction_id uuid not null references bank_transactions(id) on delete cascade,
    quota_charge_id uuid not null references quota_charges(id) on delete cascade,
    primary key (transaction_id, quota_charge_id)
);

-- Who registered the vote: the chair (ADMIN) or the owner online via the portal.
alter table assembly_votes add column cast_by varchar(10) not null default 'ADMIN' check (cast_by in ('ADMIN', 'OWNER'));

-- Small PDF invoices are kept in the database (≤ 4 MB, Vercel body limit).
alter table vendor_invoices
    add column file_name varchar(255),
    add column file_type varchar(100),
    add column file_data bytea;

alter table bank_transactions enable row level security;
alter table bank_transaction_matches enable row level security;

-- MEDIUM-confidence match proposed to the administrator: {"fractionId", "chargeIds", "reason"}
alter table bank_transactions add column suggestion jsonb;

-- When the owner's consent to receive convocations by email was recorded (Lei 8/2022).
alter table residents add column email_consent_recorded_at timestamp with time zone;
