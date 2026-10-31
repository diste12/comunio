-- Comunio — Day 2 & 3: resident access, WhatsApp, assemblies (Lei 8/2022),
-- minutes, contractor RFPs and pre-litigation letters.

-- ---------------------------------------------------------------------------
-- Resident portal: magic links delivered over WhatsApp (only hashes stored)
-- ---------------------------------------------------------------------------
create table resident_login_tokens (
    id uuid primary key default gen_random_uuid(),
    resident_id uuid not null references residents(id) on delete cascade,
    token_hash varchar(64) not null unique,
    expires_at timestamp with time zone not null,
    used_at timestamp with time zone,
    created_at timestamp with time zone default now()
);

-- ---------------------------------------------------------------------------
-- WhatsApp conversation log (inbound + outbound)
-- ---------------------------------------------------------------------------
create table whatsapp_messages (
    id uuid primary key default gen_random_uuid(),
    resident_id uuid references residents(id) on delete set null,
    phone_number varchar(20) not null,
    direction varchar(3) not null check (direction in ('IN', 'OUT')),
    wa_message_id varchar(128) unique,
    body text not null,
    intent varchar(30),
    created_at timestamp with time zone default now()
);
create index whatsapp_messages_phone_idx on whatsapp_messages(phone_number, created_at desc);

alter table maintenance_tickets add column fraction_id uuid references fractions(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Assemblies (Código Civil arts. 1431.º–1433.º, Lei 8/2022)
-- ---------------------------------------------------------------------------
create table assemblies (
    id uuid primary key default gen_random_uuid(),
    condominium_id uuid not null references condominiums(id) on delete cascade,
    kind varchar(15) not null default 'ORDINARIA' check (kind in ('ORDINARIA', 'EXTRAORDINARIA')),
    scheduled_at timestamp with time zone not null,
    -- second call (art. 1432.º n.º 4): same place, typically +30 min or one week later
    second_call_at timestamp with time zone,
    location text not null,
    online_url text, -- Lei 8/2022 allows meetings by videoconference
    status varchar(15) not null default 'DRAFT'
        check (status in ('DRAFT', 'CONVOKED', 'IN_PROGRESS', 'CLOSED')),
    session_call smallint check (session_call in (1, 2)),
    started_at timestamp with time zone,
    closed_at timestamp with time zone,
    transcript text,
    created_at timestamp with time zone default now()
);
create index assemblies_condo_idx on assemblies(condominium_id, scheduled_at desc);

create table assembly_agenda_items (
    id uuid primary key default gen_random_uuid(),
    assembly_id uuid not null references assemblies(id) on delete cascade,
    position smallint not null,
    title text not null,
    -- SIMPLE: majority of capital present (art. 1432.º); TWO_THIRDS: 2/3 of the
    -- building's capital (e.g. innovations, art. 1425.º); UNANIMITY: all capital.
    required_majority varchar(12) not null default 'SIMPLE'
        check (required_majority in ('SIMPLE', 'TWO_THIRDS', 'UNANIMITY')),
    voting_status varchar(10) not null default 'PENDING' check (voting_status in ('PENDING', 'OPEN', 'CLOSED')),
    discussion_notes text,
    unique (assembly_id, position)
);

create table convocations (
    id uuid primary key default gen_random_uuid(),
    assembly_id uuid not null references assemblies(id) on delete cascade,
    fraction_id uuid not null references fractions(id) on delete cascade,
    resident_id uuid references residents(id) on delete set null,
    channel varchar(16) not null check (channel in ('EMAIL', 'REGISTERED_MAIL')),
    status varchar(10) not null default 'PENDING' check (status in ('PENDING', 'SENT', 'FAILED')),
    provider_id varchar(100), -- Resend message id or CTT tracking number
    error text,
    sent_at timestamp with time zone,
    unique (assembly_id, fraction_id)
);

create table assembly_attendance (
    assembly_id uuid not null references assemblies(id) on delete cascade,
    fraction_id uuid not null references fractions(id) on delete cascade,
    mode varchar(12) not null check (mode in ('PRESENT', 'ONLINE', 'REPRESENTED')),
    representative_name varchar(255),
    checked_in_at timestamp with time zone default now(),
    primary key (assembly_id, fraction_id)
);

create table assembly_votes (
    agenda_item_id uuid not null references assembly_agenda_items(id) on delete cascade,
    fraction_id uuid not null references fractions(id) on delete cascade,
    vote varchar(10) not null check (vote in ('FAVOR', 'CONTRA', 'ABSTENCAO')),
    cast_at timestamp with time zone default now(),
    primary key (agenda_item_id, fraction_id)
);

create table minutes (
    id uuid primary key default gen_random_uuid(),
    assembly_id uuid not null unique references assemblies(id) on delete cascade,
    body text not null,
    status varchar(10) not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED')),
    generated_by varchar(20) not null default 'LLM',
    approved_at timestamp with time zone,
    approved_by varchar(255),
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

-- ---------------------------------------------------------------------------
-- Contractor marketplace: 3-quote RFPs
-- ---------------------------------------------------------------------------
create table vendors (
    id uuid primary key default gen_random_uuid(),
    name varchar(255) not null,
    nif varchar(9),
    email varchar(255),
    phone_number varchar(20),
    categories text[] not null default '{}',
    created_at timestamp with time zone default now()
);

create table rfps (
    id uuid primary key default gen_random_uuid(),
    ticket_id uuid not null references maintenance_tickets(id) on delete cascade,
    scope text not null,
    deadline date not null,
    status varchar(10) not null default 'OPEN' check (status in ('OPEN', 'AWARDED', 'CANCELLED')),
    awarded_quote_id uuid,
    created_at timestamp with time zone default now()
);

create table rfp_invitations (
    id uuid primary key default gen_random_uuid(),
    rfp_id uuid not null references rfps(id) on delete cascade,
    vendor_id uuid not null references vendors(id) on delete cascade,
    -- capability token embedded in the shareable link (scoped to one vendor + RFP)
    token varchar(64) not null unique,
    viewed_at timestamp with time zone,
    created_at timestamp with time zone default now(),
    unique (rfp_id, vendor_id)
);

create table vendor_quotes (
    id uuid primary key default gen_random_uuid(),
    rfp_id uuid not null references rfps(id) on delete cascade,
    invitation_id uuid not null unique references rfp_invitations(id) on delete cascade,
    vendor_id uuid not null references vendors(id) on delete cascade,
    amount numeric(10,2) not null check (amount > 0),
    lead_time_days smallint not null check (lead_time_days >= 0),
    warranty_months smallint not null default 0,
    notes text,
    submitted_at timestamp with time zone default now()
);
alter table rfps add constraint rfps_awarded_quote_fk
    foreign key (awarded_quote_id) references vendor_quotes(id) on delete set null;

-- Vendor invoices uploaded through the same link once awarded; paid only after
-- 1-click admin approval (human in the loop).
create table vendor_invoices (
    id uuid primary key default gen_random_uuid(),
    quote_id uuid not null references vendor_quotes(id) on delete cascade,
    invoice_number varchar(60) not null,
    amount numeric(10,2) not null check (amount > 0),
    status varchar(20) not null default 'PENDING_APPROVAL'
        check (status in ('PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
    approved_at timestamp with time zone,
    approved_by varchar(255),
    submitted_at timestamp with time zone default now(),
    unique (quote_id, invoice_number)
);

-- ---------------------------------------------------------------------------
-- Pre-litigation letters (registered mail via CTT), dispatched after approval
-- ---------------------------------------------------------------------------
create table legal_letters (
    id uuid primary key default gen_random_uuid(),
    condominium_id uuid not null references condominiums(id) on delete cascade,
    fraction_id uuid not null references fractions(id) on delete cascade,
    amount_due numeric(10,2) not null,
    status varchar(10) not null default 'SENT' check (status in ('SENT', 'FAILED')),
    ctt_tracking varchar(40),
    sent_at timestamp with time zone default now(),
    approved_by varchar(255)
);
create index legal_letters_fraction_idx on legal_letters(fraction_id, sent_at desc);

alter table resident_login_tokens enable row level security;
alter table whatsapp_messages enable row level security;
alter table assemblies enable row level security;
alter table assembly_agenda_items enable row level security;
alter table convocations enable row level security;
alter table assembly_attendance enable row level security;
alter table assembly_votes enable row level security;
alter table minutes enable row level security;
alter table vendors enable row level security;
alter table rfps enable row level security;
alter table rfp_invitations enable row level security;
alter table vendor_quotes enable row level security;
alter table vendor_invoices enable row level security;
alter table legal_letters enable row level security;
