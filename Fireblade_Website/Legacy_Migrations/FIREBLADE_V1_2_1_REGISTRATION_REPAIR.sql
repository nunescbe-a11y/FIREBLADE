begin;

-- Fireblade V1.2.1 registration compatibility repair
-- Safe for existing call, contact, enquiry, employee and device data.
--
-- Some early V1.1 attempts created extra legacy columns directly on
-- fireblade_device_assignments. The final architecture stores phone metadata in
-- fireblade_devices, but those old NOT NULL columns can still block a new
-- assignment insert. Make any such legacy columns nullable and backfill the
-- phone number from fireblade_devices where possible.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='fireblade_device_assignments'
      and column_name='company_phone_number'
  ) then
    execute $q$
      update public.fireblade_device_assignments a
      set company_phone_number = d.company_phone_number
      from public.fireblade_devices d
      where a.device_id = d.device_id
        and a.company_phone_number is null
    $q$;
    execute 'alter table public.fireblade_device_assignments alter column company_phone_number drop not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='fireblade_device_assignments'
      and column_name='device_name'
  ) then
    execute 'alter table public.fireblade_device_assignments alter column device_name drop not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='fireblade_device_assignments'
      and column_name='phone_label'
  ) then
    execute 'alter table public.fireblade_device_assignments alter column phone_label drop not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='fireblade_device_assignments'
      and column_name='status'
  ) then
    execute 'alter table public.fireblade_device_assignments alter column status drop not null';
  end if;
end $$;

-- Keep the final source-of-truth tables protected by RLS.
alter table public.fireblade_employees enable row level security;
alter table public.fireblade_devices enable row level security;
alter table public.fireblade_device_assignments enable row level security;

commit;

-- Verification: legacy assignment columns, if present, should now be nullable.
select column_name, is_nullable
from information_schema.columns
where table_schema='public'
  and table_name='fireblade_device_assignments'
  and column_name in ('company_phone_number','device_name','phone_label','status')
order by column_name;
