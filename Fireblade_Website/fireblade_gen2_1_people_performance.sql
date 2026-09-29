-- Fireblade Gen 2.1 - People + Performance
-- Employee profile photos and Admin/Management employee call performance dashboard.

alter table public.fireblade_employees
  add column if not exists profile_photo_path text,
  add column if not exists profile_photo_updated_at timestamptz;

create index if not exists fireblade_employees_department_active_idx
  on public.fireblade_employees (department_id, active, employee_name);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fireblade-employee-photos',
  'fireblade-employee-photos',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.fireblade_employee_call_performance(
  p_start_epoch_ms bigint,
  p_end_epoch_ms bigint
)
returns table (
  employee_id text,
  employee_name text,
  department_id uuid,
  department_name text,
  profile_photo_updated_at timestamptz,
  total_incoming bigint,
  answered_calls bigint,
  missed_calls bigint,
  called_back bigint,
  pending_callbacks bigint,
  callback_rate numeric,
  average_callback_minutes numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with incoming as (
    select
      ce.employee_id,
      count(*) filter (where ce.direction in ('INCOMING_ANSWERED','INCOMING_MISSED'))::bigint as total_incoming,
      count(*) filter (where ce.direction = 'INCOMING_ANSWERED')::bigint as answered_calls,
      count(*) filter (where ce.direction = 'INCOMING_MISSED')::bigint as missed_calls
    from public.fireblade_call_events ce
    where ce.started_at_epoch_ms >= p_start_epoch_ms
      and ce.started_at_epoch_ms < p_end_epoch_ms
      and ce.employee_id is not null
      and ce.direction in ('INCOMING_ANSWERED','INCOMING_MISSED')
    group by ce.employee_id
  ), callback as (
    select
      mt.employee_id,
      count(*) filter (where mt.callback_status = 'RESOLVED')::bigint as called_back,
      avg(mt.callback_minutes) filter (where mt.callback_status = 'RESOLVED' and mt.callback_minutes is not null) as average_callback_minutes
    from public.fireblade_missed_call_tasks mt
    where mt.missed_at_epoch_ms >= p_start_epoch_ms
      and mt.missed_at_epoch_ms < p_end_epoch_ms
      and mt.employee_id is not null
    group by mt.employee_id
  )
  select
    e.employee_id,
    e.employee_name,
    e.department_id,
    coalesce(d.name, 'Unassigned') as department_name,
    e.profile_photo_updated_at,
    coalesce(i.total_incoming, 0)::bigint as total_incoming,
    coalesce(i.answered_calls, 0)::bigint as answered_calls,
    coalesce(i.missed_calls, 0)::bigint as missed_calls,
    least(coalesce(c.called_back, 0), coalesce(i.missed_calls, 0))::bigint as called_back,
    greatest(coalesce(i.missed_calls, 0) - least(coalesce(c.called_back, 0), coalesce(i.missed_calls, 0)), 0)::bigint as pending_callbacks,
    case
      when coalesce(i.missed_calls, 0) = 0 then 0::numeric
      else round(least(coalesce(c.called_back, 0), coalesce(i.missed_calls, 0))::numeric * 100.0 / i.missed_calls::numeric, 1)
    end as callback_rate,
    case when c.average_callback_minutes is null then null else round(c.average_callback_minutes::numeric, 1) end as average_callback_minutes
  from public.fireblade_employees e
  left join public.fireblade_departments d on d.id = e.department_id
  left join incoming i on i.employee_id = e.employee_id
  left join callback c on c.employee_id = e.employee_id
  where e.active = true
  order by coalesce(d.name, 'Unassigned'), e.employee_name;
$$;

revoke all on function public.fireblade_employee_call_performance(bigint,bigint) from public;
grant execute on function public.fireblade_employee_call_performance(bigint,bigint) to service_role;

comment on function public.fireblade_employee_call_performance(bigint,bigint) is
'Fireblade Gen 2.1 server-side employee incoming/callback performance aggregation for Admin and Management.';
