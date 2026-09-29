-- FIREBLADE GEN 2
-- Additive migration. Preserves raw call history, device IDs, SIM metadata and assignments.
begin;

create table if not exists public.fireblade_user_profiles (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  login_email text not null unique,
  role text not null check (role in ('ADMIN','MARKETING','MANAGEMENT')),
  employee_id text unique references public.fireblade_employees(employee_id),
  active boolean not null default true,
  force_password_change boolean not null default true,
  session_version bigint not null default 1,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((role = 'MARKETING' and employee_id is not null) or role <> 'MARKETING')
);

alter table public.fireblade_user_profiles
  add column if not exists session_version bigint not null default 1;

create table if not exists public.fireblade_user_preferences (
  principal text primary key,
  theme text not null default 'STANDARD' check (theme in ('STANDARD','NIGHTMARE','SYSTEM')),
  updated_at timestamptz not null default now()
);

create table if not exists public.fireblade_whatsapp_connections (
  employee_id text primary key references public.fireblade_employees(employee_id),
  session_key text not null unique,
  whatsapp_number text,
  status text not null default 'DISCONNECTED' check (status in ('DISCONNECTED','STARTING','QR_READY','CONNECTED','ERROR')),
  connected_at timestamptz,
  last_seen_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

-- Product communication compatibility layer. Production V3 may not yet have the V5
-- catalogue/message schema; staging already has richer versions of these tables, so
-- CREATE TABLE IF NOT EXISTS is a no-op there.
create table if not exists public.fireblade_products (
  id uuid primary key default gen_random_uuid(),
  product_code text not null unique,
  canonical_name text not null,
  normalized_name text not null default '',
  brand text,
  manufacturer text,
  category text,
  subcategory text,
  lifecycle_status text not null default 'ACTIVE',
  publish_status text not null default 'DRAFT',
  verification_status text not null default 'NEEDS_REVIEW',
  current_revision_id uuid,
  created_by text not null default 'GEN2',
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.fireblade_product_revisions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.fireblade_products(id) on delete cascade,
  revision_no integer not null,
  snapshot jsonb not null default '{}'::jsonb,
  snapshot_sha256 text not null default '',
  status text not null default 'PUBLISHED',
  published_by text not null default 'GEN2',
  published_at timestamptz not null default now(),
  unique(product_id, revision_no)
);

create table if not exists public.fireblade_product_specs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.fireblade_products(id) on delete cascade,
  spec_key text not null,
  spec_label text not null,
  value_text text not null,
  numeric_value numeric,
  unit text,
  customer_priority smallint not null default 50,
  verification_status text not null default 'NEEDS_REVIEW',
  active boolean not null default true,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_by text not null default 'GEN2',
  created_at timestamptz not null default now()
);

create table if not exists public.fireblade_product_assets (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.fireblade_products(id) on delete cascade,
  asset_type text not null,
  title text not null,
  storage_bucket text,
  storage_object_path text,
  sha256 text,
  revision_label text,
  revision_date date,
  verification_status text not null default 'NEEDS_REVIEW',
  customer_sendable boolean not null default false,
  active boolean not null default true,
  created_by text not null default 'GEN2',
  created_at timestamptz not null default now()
);

-- Gen 2 supports manually approved Admin uploads as product assets. The richer V5
-- staging schema originally required every asset to come from an ingestion source file;
-- manual Admin uploads intentionally have no source_file_id.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='fireblade_product_assets' and column_name='source_file_id'
  ) then
    execute 'alter table public.fireblade_product_assets alter column source_file_id drop not null';
  end if;
end $$;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values (
  'fireblade-product-assets',
  'fireblade-product-assets',
  false,
  20971520,
  array['application/pdf','image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.fireblade_message_bundles (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid references public.fireblade_call_enquiries(id),
  channel text not null default 'WHATSAPP',
  recipient_number text not null,
  mode text not null default 'SESSION',
  rendered_text text not null,
  payload_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'READY',
  idempotency_key uuid not null default gen_random_uuid() unique,
  created_by text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  error_message text
);

create table if not exists public.fireblade_message_bundle_assets (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.fireblade_message_bundles(id) on delete cascade,
  asset_id uuid not null references public.fireblade_product_assets(id),
  item_order integer not null,
  asset_sha256 text
);

create table if not exists public.fireblade_whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid references public.fireblade_message_bundles(id) on delete cascade,
  direction text not null,
  recipient_number text,
  sender_number text,
  message_type text not null,
  bundle_asset_id uuid references public.fireblade_message_bundle_assets(id),
  provider_message_id text,
  status text not null default 'QUEUED',
  payload jsonb not null default '{}'::jsonb,
  provider_response jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fireblade_gen2_products_publish_idx on public.fireblade_products(lifecycle_status,publish_status,verification_status);
create index if not exists fireblade_gen2_specs_product_idx on public.fireblade_product_specs(product_id,active,verification_status);
create index if not exists fireblade_gen2_assets_product_idx on public.fireblade_product_assets(product_id,active,customer_sendable,verification_status);
create index if not exists fireblade_gen2_messages_bundle_idx on public.fireblade_whatsapp_messages(bundle_id,created_at desc);

alter table public.fireblade_message_bundles
  add column if not exists employee_id text references public.fireblade_employees(employee_id),
  add column if not exists call_id bigint references public.phase0_calls(id),
  add column if not exists product_revision_snapshot jsonb not null default '[]'::jsonb;

-- Gen 2 permits a bundle to originate directly from an employee-owned call even before an enquiry exists.
alter table public.fireblade_message_bundles alter column enquiry_id drop not null;

create index if not exists fireblade_profiles_employee_idx on public.fireblade_user_profiles(employee_id);
create index if not exists fireblade_bundles_employee_call_idx on public.fireblade_message_bundles(employee_id, call_id, created_at desc);
create index if not exists phase0_calls_employee_callback_idx on public.phase0_calls(device_id, phone_number_normalized, started_at_epoch_ms desc);

-- Resolve employee ownership at event time, not from the device's current owner.
create or replace view public.fireblade_call_events
with (security_invoker=true)
as
select
  pc.id as call_id,
  pc.device_id,
  pc.employee_name as collector_employee,
  pc.source_call_id,
  pc.phone_number_raw,
  pc.phone_number_normalized,
  pc.contact_name,
  pc.direction,
  pc.started_at_epoch_ms,
  to_timestamp(pc.started_at_epoch_ms / 1000.0) as started_at,
  pc.duration_seconds,
  pc.received_at,
  pc.phone_account_id,
  pc.phone_account_component,
  pc.subscription_id,
  pc.sim_slot_index,
  a.employee_id,
  e.employee_name,
  e.department_id,
  d.name as department_name
from public.phase0_calls pc
left join lateral (
  select da.employee_id
  from public.fireblade_device_assignments da
  where da.device_id = pc.device_id
    and da.assigned_from <= to_timestamp(pc.started_at_epoch_ms / 1000.0)
    and (da.assigned_until is null or da.assigned_until > to_timestamp(pc.started_at_epoch_ms / 1000.0))
  order by da.assigned_from desc
  limit 1
) a on true
left join public.fireblade_employees e on e.employee_id = a.employee_id
left join public.fireblade_departments d on d.id = e.department_id;

-- Each missed call remains immutable history. A later connected callback by the SAME employee
-- resolves that missed call, even if the callback originates from another assigned device/SIM.
create or replace view public.fireblade_missed_call_tasks
with (security_invoker=true)
as
select
  m.call_id as missed_call_id,
  m.employee_id,
  m.employee_name,
  m.department_id,
  m.department_name,
  m.device_id as missed_device_id,
  m.phone_number_raw,
  m.phone_number_normalized,
  m.started_at_epoch_ms as missed_at_epoch_ms,
  m.started_at as missed_at,
  ((m.started_at at time zone 'Asia/Kolkata')::date) as missed_date_ist,
  cb.call_id as callback_call_id,
  cb.device_id as callback_device_id,
  cb.started_at_epoch_ms as callback_at_epoch_ms,
  cb.started_at as callback_at,
  cb.duration_seconds as callback_duration_seconds,
  case when cb.call_id is null then 'PENDING' else 'RESOLVED' end as callback_status,
  case when cb.call_id is null then null else greatest(0, round((cb.started_at_epoch_ms - m.started_at_epoch_ms) / 60000.0, 2)) end as callback_minutes
from public.fireblade_call_events m
left join lateral (
  select o.*
  from public.fireblade_call_events o
  where o.employee_id = m.employee_id
    and nullif(o.phone_number_normalized, '') is not null
    and o.phone_number_normalized = m.phone_number_normalized
    and o.direction = 'OUTGOING_CONNECTED'
    and o.started_at_epoch_ms > m.started_at_epoch_ms
  order by o.started_at_epoch_ms asc, o.call_id asc
  limit 1
) cb on true
where m.direction = 'INCOMING_MISSED'
  and m.employee_id is not null;

-- Optional direct-auth RLS foundation. The web server still performs explicit role/ownership checks.
create or replace function public.fireblade_current_employee_id()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select employee_id from public.fireblade_user_profiles
  where auth_user_id = auth.uid() and active = true and role = 'MARKETING'
  limit 1
$$;

alter table public.fireblade_user_profiles enable row level security;
alter table public.fireblade_user_preferences enable row level security;
alter table public.fireblade_whatsapp_connections enable row level security;

drop policy if exists fireblade_profile_self_select on public.fireblade_user_profiles;
create policy fireblade_profile_self_select on public.fireblade_user_profiles
  for select to authenticated using (auth_user_id = auth.uid());

drop policy if exists fireblade_whatsapp_self_select on public.fireblade_whatsapp_connections;
create policy fireblade_whatsapp_self_select on public.fireblade_whatsapp_connections
  for select to authenticated using (employee_id = public.fireblade_current_employee_id());

grant select on public.fireblade_call_events to authenticated, service_role;
grant select on public.fireblade_missed_call_tasks to authenticated, service_role;
grant select, insert, update, delete on public.fireblade_user_profiles to service_role;
grant select, insert, update, delete on public.fireblade_user_preferences to service_role;
grant select, insert, update, delete on public.fireblade_whatsapp_connections to service_role;

revoke all on function public.fireblade_current_employee_id() from public;
grant execute on function public.fireblade_current_employee_id() to authenticated, service_role;

-- GEN 2 AUTOMATED PRODUCT SEARCH / PACKAGE ASSEMBLY

create extension if not exists pg_trgm with schema extensions;

alter table public.fireblade_products
  add column if not exists master_key text,
  add column if not exists search_text text not null default '';

create unique index if not exists fireblade_products_master_key_uidx
  on public.fireblade_products(master_key)
  where master_key is not null;
create unique index if not exists fireblade_products_master_key_upsert_uidx
  on public.fireblade_products(master_key);

alter table public.fireblade_product_specs
  add column if not exists source_key text;
create unique index if not exists fireblade_product_specs_source_key_uidx
  on public.fireblade_product_specs(source_key)
  where source_key is not null;
create unique index if not exists fireblade_product_specs_source_key_upsert_uidx
  on public.fireblade_product_specs(source_key);

-- Production Gen 2 did not previously require a separate price table.
create table if not exists public.fireblade_product_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.fireblade_products(id) on delete cascade,
  variant_id uuid,
  amount numeric not null check (amount >= 0),
  currency text not null default 'INR',
  quantity_min numeric,
  quantity_max numeric,
  tax_note text,
  commercial_note text,
  effective_from date,
  effective_until date,
  verification_status text not null default 'NEEDS_REVIEW',
  active boolean not null default true,
  created_by text not null default 'GEN2',
  created_at timestamptz not null default now()
);
alter table public.fireblade_product_prices
  add column if not exists customer_sendable boolean not null default false,
  add column if not exists price_kind text not null default 'INTERNAL_PURCHASE',
  add column if not exists source_key text;
create unique index if not exists fireblade_product_prices_source_key_uidx
  on public.fireblade_product_prices(source_key)
  where source_key is not null;
create unique index if not exists fireblade_product_prices_source_key_upsert_uidx
  on public.fireblade_product_prices(source_key);
create index if not exists fireblade_product_prices_customer_idx
  on public.fireblade_product_prices(product_id, customer_sendable, active, verification_status, effective_from desc);

-- Source metadata lets Fireblade attach existing Drive catalogues automatically.
create table if not exists public.fireblade_product_source_roots (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  display_name text not null,
  source_type text not null default 'GOOGLE_SHEET',
  drive_id text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.fireblade_product_source_roots
  add column if not exists customer_share_trusted boolean not null default false;

create table if not exists public.fireblade_product_source_files (
  id uuid primary key default gen_random_uuid(),
  root_id uuid not null references public.fireblade_product_source_roots(id),
  drive_file_id text not null unique,
  drive_parent_id text,
  relative_path text,
  name text not null,
  mime_type text not null default 'application/pdf',
  web_view_url text,
  source_modified_at timestamptz,
  source_size_bytes bigint,
  sha256 text,
  parse_status text not null default 'DISCOVERED',
  parse_error text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb
);

-- Optional search aliases / models for large-catalogue matching.
create table if not exists public.fireblade_product_aliases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.fireblade_products(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  alias_type text not null default 'SEARCH',
  source_file_id uuid references public.fireblade_product_source_files(id),
  verified boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists fireblade_product_aliases_product_norm_uidx
  on public.fireblade_product_aliases(product_id, normalized_alias);

create table if not exists public.fireblade_product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.fireblade_products(id) on delete cascade,
  model_code text,
  normalized_model_code text,
  variant_name text,
  normalized_variant_name text,
  ordering_code text,
  status text not null default 'ACTIVE',
  verified boolean not null default true,
  source_file_id uuid references public.fireblade_product_source_files(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fireblade_product_variants_product_model_uidx
  on public.fireblade_product_variants(product_id, normalized_model_code)
  where normalized_model_code is not null and normalized_model_code <> '';
create unique index if not exists fireblade_product_variants_product_model_upsert_uidx
  on public.fireblade_product_variants(product_id, normalized_model_code);

create table if not exists public.fireblade_product_source_links (
  product_id uuid not null references public.fireblade_products(id) on delete cascade,
  source_file_id uuid not null references public.fireblade_product_source_files(id) on delete cascade,
  relationship text not null default 'SUPPORTING',
  created_at timestamptz not null default now(),
  primary key(product_id, source_file_id)
);

alter table public.fireblade_product_assets
  add column if not exists variant_id uuid,
  add column if not exists source_file_id uuid,
  add column if not exists source_key text;

-- Add the FK only when a legacy schema did not already define it.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fireblade_product_assets_source_file_id_fkey'
      and conrelid = 'public.fireblade_product_assets'::regclass
  ) then
    alter table public.fireblade_product_assets
      add constraint fireblade_product_assets_source_file_id_fkey
      foreign key (source_file_id) references public.fireblade_product_source_files(id);
  end if;
end $$;

create unique index if not exists fireblade_product_assets_source_key_uidx
  on public.fireblade_product_assets(source_key)
  where source_key is not null;
create unique index if not exists fireblade_product_assets_source_key_upsert_uidx
  on public.fireblade_product_assets(source_key);

-- GEN2 PRODUCT COMMUNICATION TABLE SECURITY
-- Product/package data is accessed through Fireblade server routes using the server secret.
-- Do not expose the large catalogue or message audit tables directly to browser roles.
alter table public.fireblade_products enable row level security;
alter table public.fireblade_product_revisions enable row level security;
alter table public.fireblade_product_specs enable row level security;
alter table public.fireblade_product_assets enable row level security;
alter table public.fireblade_product_prices enable row level security;
alter table public.fireblade_product_source_roots enable row level security;
alter table public.fireblade_product_source_files enable row level security;
alter table public.fireblade_product_aliases enable row level security;
alter table public.fireblade_product_variants enable row level security;
alter table public.fireblade_product_source_links enable row level security;
alter table public.fireblade_message_bundles enable row level security;
alter table public.fireblade_message_bundle_assets enable row level security;
alter table public.fireblade_whatsapp_messages enable row level security;

revoke all on public.fireblade_products from anon, authenticated;
revoke all on public.fireblade_product_revisions from anon, authenticated;
revoke all on public.fireblade_product_specs from anon, authenticated;
revoke all on public.fireblade_product_assets from anon, authenticated;
revoke all on public.fireblade_product_prices from anon, authenticated;
revoke all on public.fireblade_product_source_roots from anon, authenticated;
revoke all on public.fireblade_product_source_files from anon, authenticated;
revoke all on public.fireblade_product_aliases from anon, authenticated;
revoke all on public.fireblade_product_variants from anon, authenticated;
revoke all on public.fireblade_product_source_links from anon, authenticated;
revoke all on public.fireblade_message_bundles from anon, authenticated;
revoke all on public.fireblade_message_bundle_assets from anon, authenticated;
revoke all on public.fireblade_whatsapp_messages from anon, authenticated;

grant select, insert, update, delete on public.fireblade_products to service_role;
grant select, insert, update, delete on public.fireblade_product_revisions to service_role;
grant select, insert, update, delete on public.fireblade_product_specs to service_role;
grant select, insert, update, delete on public.fireblade_product_assets to service_role;
grant select, insert, update, delete on public.fireblade_product_prices to service_role;
grant select, insert, update, delete on public.fireblade_product_source_roots to service_role;
grant select, insert, update, delete on public.fireblade_product_source_files to service_role;
grant select, insert, update, delete on public.fireblade_product_aliases to service_role;
grant select, insert, update, delete on public.fireblade_product_variants to service_role;
grant select, insert, update, delete on public.fireblade_product_source_links to service_role;
grant select, insert, update, delete on public.fireblade_message_bundles to service_role;
grant select, insert, update, delete on public.fireblade_message_bundle_assets to service_role;
grant select, insert, update, delete on public.fireblade_whatsapp_messages to service_role;

-- Trigram search keeps type-ahead fast at large product counts.
create index if not exists fireblade_products_name_trgm_idx
  on public.fireblade_products using gin (lower(canonical_name) extensions.gin_trgm_ops);
create index if not exists fireblade_products_code_trgm_idx
  on public.fireblade_products using gin (lower(product_code) extensions.gin_trgm_ops);
create index if not exists fireblade_products_search_text_trgm_idx
  on public.fireblade_products using gin (lower(search_text) extensions.gin_trgm_ops);
create index if not exists fireblade_aliases_norm_trgm_idx
  on public.fireblade_product_aliases using gin (lower(normalized_alias) extensions.gin_trgm_ops);
create index if not exists fireblade_variants_model_trgm_idx
  on public.fireblade_product_variants using gin (lower(coalesce(normalized_model_code,'')) extensions.gin_trgm_ops);

create or replace function public.fireblade_search_products(p_query text, p_limit integer default 20)
returns table (
  id uuid,
  product_code text,
  canonical_name text,
  brand text,
  manufacturer text,
  category text,
  subcategory text,
  primary_model text,
  score real
)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with q as (
    select lower(trim(coalesce(p_query,''))) as needle,
           greatest(1, least(coalesce(p_limit,20),50)) as lim
  ), ranked as (
    select
      p.id,
      p.product_code,
      p.canonical_name,
      p.brand,
      p.manufacturer,
      p.category,
      p.subcategory,
      (
        select coalesce(v.model_code, v.variant_name)
        from public.fireblade_product_variants v
        where v.product_id=p.id and v.status='ACTIVE' and v.verified=true
        order by v.created_at asc
        limit 1
      ) as primary_model,
      greatest(
        case when lower(p.product_code)=q.needle then 1000 else 0 end,
        case when lower(p.canonical_name)=q.needle then 950 else 0 end,
        case when lower(p.product_code) like q.needle || '%' then 900 else 0 end,
        case when lower(p.canonical_name) like q.needle || '%' then 850 else 0 end,
        (extensions.similarity(lower(p.canonical_name), q.needle) * 500)::real,
        (extensions.similarity(lower(p.search_text), q.needle) * 250)::real,
        coalesce((select max(extensions.similarity(lower(a.normalized_alias),q.needle))*550 from public.fireblade_product_aliases a where a.product_id=p.id and a.verified=true),0)::real,
        coalesce((select max(extensions.similarity(lower(coalesce(v.normalized_model_code,'')),q.needle))*700 from public.fireblade_product_variants v where v.product_id=p.id and v.status='ACTIVE' and v.verified=true),0)::real
      )::real as score
    from public.fireblade_products p cross join q
    where q.needle <> ''
      and p.lifecycle_status='ACTIVE'
      and p.publish_status='PUBLISHED'
      and p.verification_status='VERIFIED'
      and (
        lower(p.product_code) like '%' || q.needle || '%'
        or lower(p.canonical_name) like '%' || q.needle || '%'
        or lower(p.search_text) like '%' || q.needle || '%'
        or extensions.similarity(lower(p.canonical_name), q.needle) >= 0.18
        or exists (
          select 1 from public.fireblade_product_aliases a
          where a.product_id=p.id and a.verified=true
            and (lower(a.normalized_alias) like '%' || q.needle || '%' or extensions.similarity(lower(a.normalized_alias),q.needle)>=0.22)
        )
        or exists (
          select 1 from public.fireblade_product_variants v
          where v.product_id=p.id and v.status='ACTIVE' and v.verified=true
            and (lower(coalesce(v.normalized_model_code,'')) like '%' || q.needle || '%' or extensions.similarity(lower(coalesce(v.normalized_model_code,'')),q.needle)>=0.22)
        )
      )
  )
  select r.id,r.product_code,r.canonical_name,r.brand,r.manufacturer,r.category,r.subcategory,r.primary_model,r.score
  from ranked r cross join q
  order by r.score desc, r.canonical_name asc
  limit (select lim from q);
$$;

revoke all on function public.fireblade_search_products(text,integer) from public, anon, authenticated;
grant execute on function public.fireblade_search_products(text,integer) to service_role;

commit;
