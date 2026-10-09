-- Fireblade Gen 2 internal patch 2.1.1
-- Daily 09:15 IST employee pending-call WhatsApp report audit + idempotent claim.

create table if not exists public.fireblade_pending_call_report_runs (
  id uuid primary key default gen_random_uuid(),
  report_date_ist date not null,
  employee_id text not null references public.fireblade_employees(employee_id) on update cascade on delete restrict,
  whatsapp_number text,
  pending_count integer not null default 0 check (pending_count >= 0),
  pending_call_ids jsonb not null default '[]'::jsonb,
  status text not null default 'SENDING' check (status in ('SENDING','SENT','FAILED')),
  attempt_count integer not null default 1 check (attempt_count >= 1),
  message_count integer not null default 0 check (message_count >= 0),
  provider_message_ids jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, report_date_ist)
);

create index if not exists fireblade_pending_call_report_runs_date_status_idx
  on public.fireblade_pending_call_report_runs (report_date_ist desc, status, employee_id);

alter table public.fireblade_pending_call_report_runs enable row level security;
revoke all on table public.fireblade_pending_call_report_runs from anon, authenticated;
grant select, insert, update, delete on table public.fireblade_pending_call_report_runs to service_role;

create or replace function public.fireblade_claim_pending_call_report(
  p_report_date_ist date,
  p_employee_id text,
  p_whatsapp_number text,
  p_pending_count integer,
  p_pending_call_ids jsonb
)
returns table (id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  insert into public.fireblade_pending_call_report_runs (
    report_date_ist,
    employee_id,
    whatsapp_number,
    pending_count,
    pending_call_ids,
    status,
    attempt_count,
    message_count,
    provider_message_ids,
    started_at,
    sent_at,
    last_error,
    created_at,
    updated_at
  ) values (
    p_report_date_ist,
    p_employee_id,
    p_whatsapp_number,
    greatest(coalesce(p_pending_count, 0), 0),
    coalesce(p_pending_call_ids, '[]'::jsonb),
    'SENDING',
    1,
    0,
    '[]'::jsonb,
    now(),
    null,
    null,
    now(),
    now()
  )
  on conflict (employee_id, report_date_ist) do update
  set
    whatsapp_number = excluded.whatsapp_number,
    pending_count = excluded.pending_count,
    pending_call_ids = excluded.pending_call_ids,
    status = 'SENDING',
    attempt_count = public.fireblade_pending_call_report_runs.attempt_count + 1,
    message_count = 0,
    provider_message_ids = '[]'::jsonb,
    started_at = now(),
    sent_at = null,
    last_error = null,
    updated_at = now()
  where public.fireblade_pending_call_report_runs.status = 'FAILED'
     or (
       public.fireblade_pending_call_report_runs.status = 'SENDING'
       and public.fireblade_pending_call_report_runs.updated_at < now() - interval '15 minutes'
     )
  returning public.fireblade_pending_call_report_runs.id;
end;
$$;

revoke all on function public.fireblade_claim_pending_call_report(date,text,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.fireblade_claim_pending_call_report(date,text,text,integer,jsonb) to service_role;

comment on table public.fireblade_pending_call_report_runs is
'Fireblade audit/idempotency log for the daily 09:15 IST employee pending-call WhatsApp report.';
