create table if not exists public.fireblade_shane_call_details (
    id uuid primary key default gen_random_uuid(),
    detail_id uuid not null unique,
    call_id bigint null references public.phase0_calls(id) on delete set null,
    source_call_id text null,
    device_id text not null references public.fireblade_devices(device_id),
    employee_id text not null references public.fireblade_employees(employee_id),
    phone_number_raw text not null default '',
    phone_number_normalized text not null default '',
    call_started_at_epoch_ms bigint not null,
    customer_name text not null default '',
    product_asked text not null default '',
    location text not null default '',
    notes text not null default '',
    very_urgent boolean not null default false,
    client_updated_at_epoch_ms bigint not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_fireblade_shane_call_details_employee_started
    on public.fireblade_shane_call_details(employee_id, call_started_at_epoch_ms desc);

create index if not exists idx_fireblade_shane_call_details_phone
    on public.fireblade_shane_call_details(phone_number_normalized, call_started_at_epoch_ms desc);

create index if not exists idx_fireblade_shane_call_details_urgent
    on public.fireblade_shane_call_details(employee_id, very_urgent, call_started_at_epoch_ms desc);

alter table public.fireblade_shane_call_details enable row level security;
