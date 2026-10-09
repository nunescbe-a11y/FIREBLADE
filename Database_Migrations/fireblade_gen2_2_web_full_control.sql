-- Fireblade Gen 2.2 - Web Full Control / Management profile
-- Additive migration. Does not delete employees, devices, SIMs or call history.

begin;

create table if not exists public.fireblade_management_profiles (
  principal text primary key,
  display_name text not null default 'MD',
  profile_photo_path text,
  profile_photo_updated_at timestamptz,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fireblade_management_profiles enable row level security;

revoke all on public.fireblade_management_profiles from anon, authenticated;
grant select, insert, update, delete on public.fireblade_management_profiles to service_role;

comment on table public.fireblade_management_profiles is
  'Server-managed Fireblade Management/MD display profile. Management photo uses the existing private fireblade-employee-photos storage bucket under a separate management path.';

commit;