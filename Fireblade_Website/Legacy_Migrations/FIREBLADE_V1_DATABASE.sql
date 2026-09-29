-- Already applied to the connected Supabase project as migration:
-- fireblade_v1_business_tables
-- Included here for source control / future deployments.

create extension if not exists pgcrypto;

create table if not exists public.fireblade_contacts (
  id uuid primary key default gen_random_uuid(),
  phone_number_normalized text not null,
  person_name text not null,
  company_name text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fireblade_contacts_phone_idx on public.fireblade_contacts (phone_number_normalized);
create index if not exists fireblade_contacts_person_idx on public.fireblade_contacts (lower(person_name));

create table if not exists public.fireblade_call_enquiries (
  id uuid primary key default gen_random_uuid(),
  call_id bigint not null unique references public.phase0_calls(id) on delete cascade,
  contact_id uuid not null references public.fireblade_contacts(id) on delete restrict,
  product_name text not null,
  requirement_details text,
  notes text,
  status text not null default 'COMPLETED' check (status in ('PENDING','COMPLETED')),
  entered_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fireblade_enquiries_contact_idx on public.fireblade_call_enquiries (contact_id);
create index if not exists fireblade_enquiries_product_idx on public.fireblade_call_enquiries (lower(product_name));

alter table public.fireblade_contacts enable row level security;
alter table public.fireblade_call_enquiries enable row level security;

create or replace view public.fireblade_incoming_calls with (security_invoker = true) as
select c.id as call_id, c.device_id, c.employee_name as collector_employee,
       c.phone_number_raw, c.phone_number_normalized, c.contact_name as phone_contact_name,
       c.direction, c.started_at_epoch_ms, to_timestamp(c.started_at_epoch_ms / 1000.0) as started_at,
       c.duration_seconds, c.received_at,
       e.id as enquiry_id, e.status as enquiry_status, e.product_name, e.requirement_details,
       e.notes, e.entered_by, e.created_at as enquiry_created_at, e.updated_at as enquiry_updated_at,
       fc.id as contact_id, fc.person_name, fc.company_name,
       (select count(*)::int from public.fireblade_contacts known where known.phone_number_normalized = c.phone_number_normalized) as known_contact_count
from public.phase0_calls c
left join public.fireblade_call_enquiries e on e.call_id = c.id
left join public.fireblade_contacts fc on fc.id = e.contact_id
where c.direction in ('INCOMING_ANSWERED','INCOMING_MISSED');
