-- FIREBLADE GEN 2.1.3 - RECOVER + OEM CALLBACK RESOLUTION
-- Production migration for Fireblade Web 2.1.3.
--
-- Adds:
--   * RECOVERED enquiry outcome so an employee can undo an accidental Disqualified action.
--   * Full audit trail for DISQUALIFIED -> RECOVERED.
--   * Conservative OEM callback recognition: OTHER_100 resolves a missed call only when
--     it is for the same employee + same customer number, occurs later, and duration > 0.
--   * Management Information Sent remains restricted to real DETAILS_ENTERED enquiries.

begin;

-- RECOVERED is an intermediate/pending state. It intentionally has no contact/details yet.
alter table public.fireblade_call_enquiries
  drop constraint if exists fireblade_call_enquiries_resolution_outcome_check;

alter table public.fireblade_call_enquiries
  add constraint fireblade_call_enquiries_resolution_outcome_check
  check (resolution_outcome in ('DETAILS_ENTERED', 'DISQUALIFIED', 'RECOVERED'));

alter table public.fireblade_call_enquiries
  drop constraint if exists fireblade_call_enquiries_contact_required_for_details_check;

alter table public.fireblade_call_enquiries
  add constraint fireblade_call_enquiries_contact_required_for_details_check
  check (resolution_outcome in ('DISQUALIFIED', 'RECOVERED') or contact_id is not null);

-- Allow a previously recovered call to be disqualified again, while still refusing
-- any call that already has genuine customer/enquiry details.
create or replace function public.fireblade_mark_call_disqualified(
  p_call_id bigint,
  p_employee_id text,
  p_actor text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enquiry_id uuid;
  v_existing_outcome text;
  v_employee_name text;
  v_department_name text;
  v_actor text := coalesce(nullif(btrim(p_actor), ''), p_employee_id);
begin
  select e.employee_name, d.name
    into v_employee_name, v_department_name
  from public.fireblade_employees e
  left join public.fireblade_departments d on d.id = e.department_id
  where e.employee_id = p_employee_id
    and e.active = true;

  if v_employee_name is null then
    raise exception 'Active employee not found';
  end if;

  if upper(coalesce(v_department_name, '')) <> 'MARKETING' then
    raise exception 'Disqualified action is limited to Marketing employees';
  end if;

  if not exists (
    select 1
    from public.fireblade_incoming_calls c
    where c.call_id = p_call_id
      and c.registered_employee_id = p_employee_id
  ) then
    raise exception 'Call is not assigned to this employee';
  end if;

  select e.id, e.resolution_outcome
    into v_enquiry_id, v_existing_outcome
  from public.fireblade_call_enquiries e
  where e.call_id = p_call_id
  for update;

  if v_enquiry_id is not null and v_existing_outcome = 'DETAILS_ENTERED' then
    raise exception 'Call already has enquiry details';
  end if;

  if v_enquiry_id is not null then
    delete from public.fireblade_enquiry_information_sent
    where enquiry_id = v_enquiry_id;

    update public.fireblade_call_enquiries
       set contact_id = null,
           product_name = 'Disqualified',
           requirement_details = null,
           notes = null,
           status = 'COMPLETED',
           resolution_outcome = 'DISQUALIFIED',
           resolution_at = now(),
           resolution_by = v_actor,
           entered_by = coalesce(entered_by, p_employee_id),
           updated_by = v_actor,
           last_updated_by = v_actor,
           updated_at = now()
     where id = v_enquiry_id;
  else
    insert into public.fireblade_call_enquiries (
      call_id,
      contact_id,
      product_name,
      requirement_details,
      notes,
      status,
      entered_by,
      updated_by,
      last_updated_by,
      resolution_outcome,
      resolution_at,
      resolution_by
    )
    values (
      p_call_id,
      null,
      'Disqualified',
      null,
      null,
      'COMPLETED',
      p_employee_id,
      v_actor,
      v_actor,
      'DISQUALIFIED',
      now(),
      v_actor
    )
    returning id into v_enquiry_id;
  end if;

  insert into public.fireblade_enquiry_audit (
    enquiry_id,
    call_id,
    action,
    changed_by,
    snapshot
  )
  values (
    v_enquiry_id,
    p_call_id,
    'DISQUALIFIED',
    v_actor,
    jsonb_build_object(
      'employee_id', p_employee_id,
      'employee_name', v_employee_name,
      'resolution_outcome', 'DISQUALIFIED',
      'resolved_at', now()
    )
  );

  return v_enquiry_id;
end;
$$;

revoke all on function public.fireblade_mark_call_disqualified(bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.fireblade_mark_call_disqualified(bigint, text, text)
  to service_role;

create or replace function public.fireblade_recover_disqualified_call(
  p_call_id bigint,
  p_employee_id text,
  p_actor text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enquiry_id uuid;
  v_existing_outcome text;
  v_employee_name text;
  v_department_name text;
  v_actor text := coalesce(nullif(btrim(p_actor), ''), p_employee_id);
  v_now timestamptz := now();
begin
  select e.employee_name, d.name
    into v_employee_name, v_department_name
  from public.fireblade_employees e
  left join public.fireblade_departments d on d.id = e.department_id
  where e.employee_id = p_employee_id
    and e.active = true;

  if v_employee_name is null then
    raise exception 'Active employee not found';
  end if;

  if upper(coalesce(v_department_name, '')) <> 'MARKETING' then
    raise exception 'Recover action is limited to Marketing employees';
  end if;

  if not exists (
    select 1
    from public.fireblade_incoming_calls c
    where c.call_id = p_call_id
      and c.registered_employee_id = p_employee_id
  ) then
    raise exception 'Call is not assigned to this employee';
  end if;

  select e.id, e.resolution_outcome
    into v_enquiry_id, v_existing_outcome
  from public.fireblade_call_enquiries e
  where e.call_id = p_call_id
  for update;

  if v_enquiry_id is null or v_existing_outcome <> 'DISQUALIFIED' then
    raise exception 'Call is not currently disqualified';
  end if;

  -- Defensive cleanup. The database guard normally prevents any Information Sent rows
  -- while the call is Disqualified.
  delete from public.fireblade_enquiry_information_sent
  where enquiry_id = v_enquiry_id;

  update public.fireblade_call_enquiries
     set contact_id = null,
         product_name = '',
         requirement_details = null,
         notes = null,
         status = 'PENDING',
         resolution_outcome = 'RECOVERED',
         resolution_at = null,
         resolution_by = null,
         updated_by = v_actor,
         last_updated_by = v_actor,
         updated_at = v_now
   where id = v_enquiry_id;

  insert into public.fireblade_enquiry_audit (
    enquiry_id,
    call_id,
    action,
    changed_by,
    snapshot
  )
  values (
    v_enquiry_id,
    p_call_id,
    'RECOVERED',
    v_actor,
    jsonb_build_object(
      'employee_id', p_employee_id,
      'employee_name', v_employee_name,
      'from_outcome', 'DISQUALIFIED',
      'resolution_outcome', 'RECOVERED',
      'recovered_at', v_now
    )
  );

  return v_enquiry_id;
end;
$$;

revoke all on function public.fireblade_recover_disqualified_call(bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.fireblade_recover_disqualified_call(bigint, text, text)
  to service_role;

-- Information Sent only applies to real enquiry details, never Disqualified/Recovered.
create or replace function public.fireblade_block_info_sent_for_disqualified()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.fireblade_call_enquiries e
    where e.id = new.enquiry_id
      and e.resolution_outcome <> 'DETAILS_ENTERED'
  ) then
    raise exception 'Information Sent is only applicable after customer details are entered';
  end if;
  return new;
end;
$$;

revoke all on function public.fireblade_block_info_sent_for_disqualified()
  from public, anon, authenticated;
grant execute on function public.fireblade_block_info_sent_for_disqualified()
  to service_role;

create or replace view public.fireblade_management_information_sent_enquiries
with (security_invoker = true)
as
select
  id,
  call_id,
  contact_id,
  product_name,
  requirement_details,
  notes,
  status,
  entered_by,
  created_at,
  updated_at,
  last_updated_by,
  updated_by,
  resolution_outcome,
  resolution_at,
  resolution_by
from public.fireblade_call_enquiries e
where e.resolution_outcome = 'DETAILS_ENTERED';

create or replace function public.fireblade_information_sent_report(
  p_start_date date,
  p_end_date date
)
returns table(
  enquiry_id uuid,
  call_id bigint,
  call_at timestamptz,
  employee_id text,
  employee_name text,
  customer_name text,
  customer_company text,
  customer_phone text,
  product_name text,
  requirement_details text,
  notes text,
  information_items jsonb
)
language sql
stable
set search_path = public, pg_temp
as $$
with base as (
  select
    q.id as enquiry_id,
    q.call_id,
    to_timestamp(c.started_at_epoch_ms / 1000.0) as call_at,
    coalesce(a.employee_id, '') as employee_id,
    coalesce(e.employee_name, nullif(c.employee_name,''), a.employee_id, 'Unassigned') as employee_name,
    coalesce(ct.person_name, '') as customer_name,
    coalesce(ct.company_name, '') as customer_company,
    coalesce(nullif(c.phone_number_normalized,''), c.phone_number_raw, '') as customer_phone,
    q.product_name,
    q.requirement_details,
    q.notes
  from public.fireblade_call_enquiries q
  join public.phase0_calls c on c.id = q.call_id
  join public.fireblade_contacts ct on ct.id = q.contact_id
  left join lateral (
    select da.employee_id
    from public.fireblade_device_assignments da
    where da.device_id = c.device_id
      and da.assigned_from <= to_timestamp(c.started_at_epoch_ms / 1000.0)
      and (da.assigned_until is null or da.assigned_until > to_timestamp(c.started_at_epoch_ms / 1000.0))
    order by da.assigned_from desc
    limit 1
  ) a on true
  left join public.fireblade_employees e on e.employee_id = a.employee_id
  where q.resolution_outcome = 'DETAILS_ENTERED'
    and (to_timestamp(c.started_at_epoch_ms / 1000.0) at time zone 'Asia/Kolkata')::date
        between p_start_date and p_end_date
)
select
  b.enquiry_id,
  b.call_id,
  b.call_at,
  b.employee_id,
  b.employee_name,
  b.customer_name,
  b.customer_company,
  b.customer_phone,
  b.product_name,
  b.requirement_details,
  b.notes,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'code', t.code,
        'label', t.label,
        'sort_order', t.sort_order,
        'sent', r.sent,
        'remarks', r.remarks,
        'answered_by', r.answered_by,
        'updated_at', r.updated_at
      ) order by t.sort_order, t.label
    ) filter (where t.id is not null),
    '[]'::jsonb
  ) as information_items
from base b
left join public.fireblade_enquiry_information_sent r on r.enquiry_id = b.enquiry_id
left join public.fireblade_information_types t on t.id = r.information_type_id
group by
  b.enquiry_id, b.call_id, b.call_at, b.employee_id, b.employee_name,
  b.customer_name, b.customer_company, b.customer_phone,
  b.product_name, b.requirement_details, b.notes
order by b.employee_name, b.customer_name, b.product_name, b.call_at;
$$;

-- Missed-call callback resolution. OTHER_100 is accepted only when it is a later,
-- positive-duration event for the same employee and customer number.
create or replace view public.fireblade_missed_call_tasks as
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
  (m.started_at at time zone 'Asia/Kolkata')::date as missed_date_ist,
  resolved.call_id as callback_call_id,
  resolved.device_id as callback_device_id,
  resolved.started_at_epoch_ms as callback_at_epoch_ms,
  resolved.started_at as callback_at,
  resolved.duration_seconds as callback_duration_seconds,
  case when resolved.call_id is null then 'PENDING' else 'RESOLVED' end as callback_status,
  case
    when resolved.call_id is null then null::numeric
    else greatest(0::numeric, round((resolved.started_at_epoch_ms - m.started_at_epoch_ms)::numeric / 60000.0, 2))
  end as callback_minutes
from public.fireblade_call_events m
left join lateral (
  select o.*
  from public.fireblade_call_events o
  where o.employee_id = m.employee_id
    and nullif(o.phone_number_normalized, '') is not null
    and o.phone_number_normalized = m.phone_number_normalized
    and (
      o.direction in ('OUTGOING_CONNECTED', 'INCOMING_ANSWERED')
      or (o.direction = 'OTHER_100' and coalesce(o.duration_seconds, 0) > 0)
    )
    and o.started_at_epoch_ms > m.started_at_epoch_ms
  order by o.started_at_epoch_ms, o.call_id
  limit 1
) resolved on true
where m.direction = 'INCOMING_MISSED'
  and m.employee_id is not null;

create or replace function public.fireblade_pending_call_report_yesterday(p_report_date_ist date)
returns table(
  missed_call_id bigint,
  employee_id text,
  employee_name text,
  department_id uuid,
  department_name text,
  missed_device_id text,
  phone_number_raw text,
  phone_number_normalized text,
  missed_at_epoch_ms bigint,
  missed_at timestamptz,
  missed_date_ist date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with bounds as (
    select
      (extract(epoch from (p_report_date_ist::timestamp at time zone 'Asia/Kolkata')) * 1000)::bigint as start_ms,
      (extract(epoch from ((p_report_date_ist + 1)::timestamp at time zone 'Asia/Kolkata')) * 1000)::bigint as end_ms
  ), missed as (
    select
      ce.call_id as missed_call_id,
      ce.employee_id,
      ce.employee_name,
      ce.department_id,
      ce.department_name,
      ce.device_id as missed_device_id,
      ce.phone_number_raw,
      ce.phone_number_normalized,
      ce.started_at_epoch_ms as missed_at_epoch_ms,
      ce.started_at as missed_at,
      p_report_date_ist as missed_date_ist
    from public.fireblade_call_events ce
    cross join bounds b
    where ce.direction = 'INCOMING_MISSED'
      and ce.employee_id is not null
      and nullif(ce.phone_number_normalized, '') is not null
      and ce.started_at_epoch_ms >= b.start_ms
      and ce.started_at_epoch_ms < b.end_ms
  )
  select
    m.missed_call_id,
    m.employee_id,
    m.employee_name,
    m.department_id,
    m.department_name,
    m.missed_device_id,
    m.phone_number_raw,
    m.phone_number_normalized,
    m.missed_at_epoch_ms,
    m.missed_at,
    m.missed_date_ist
  from missed m
  where not exists (
    select 1
    from public.fireblade_call_events o
    where o.employee_id = m.employee_id
      and o.phone_number_normalized = m.phone_number_normalized
      and (
        o.direction in ('OUTGOING_CONNECTED', 'INCOMING_ANSWERED')
        or (o.direction = 'OTHER_100' and coalesce(o.duration_seconds, 0) > 0)
      )
      and o.started_at_epoch_ms > m.missed_at_epoch_ms
  )
  order by m.employee_id, m.missed_at_epoch_ms;
$$;

-- Keep the existing performance-intelligence JSON contract intact while teaching its
-- internal callback matcher about positive-duration OTHER_100 events.
do $$
declare
  v_def text;
  v_before text;
begin
  select pg_get_functiondef('public.fireblade_performance_intelligence_fast(bigint,bigint,bigint,bigint)'::regprocedure)
    into v_def;

  v_before := v_def;
  v_def := regexp_replace(
    v_def,
    'pc\\.started_at_epoch_ms,[[:space:]]*a\\.employee_id',
    'pc.started_at_epoch_ms, pc.duration_seconds, a.employee_id',
    'g'
  );
  if v_def = v_before then
    raise exception 'Could not patch fireblade_performance_intelligence_fast duration selection';
  end if;

  v_before := v_def;
  v_def := regexp_replace(
    v_def,
    'pc\\.direction[[:space:]]+in[[:space:]]*\\([[:space:]]*''INCOMING_ANSWERED''[[:space:]]*,[[:space:]]*''INCOMING_MISSED''[[:space:]]*,[[:space:]]*''OUTGOING_CONNECTED''[[:space:]]*\\)',
    'pc.direction in (''INCOMING_ANSWERED'', ''INCOMING_MISSED'', ''OUTGOING_CONNECTED'', ''OTHER_100'')',
    'g'
  );
  if v_def = v_before then
    raise exception 'Could not patch fireblade_performance_intelligence_fast mapped direction filter';
  end if;

  v_before := v_def;
  v_def := regexp_replace(
    v_def,
    'o\\.direction[[:space:]]+in[[:space:]]*\\([[:space:]]*''OUTGOING_CONNECTED''[[:space:]]*,[[:space:]]*''INCOMING_ANSWERED''[[:space:]]*\\)',
    '(o.direction in (''OUTGOING_CONNECTED'', ''INCOMING_ANSWERED'') or (o.direction = ''OTHER_100'' and coalesce(o.duration_seconds, 0) > 0))',
    'g'
  );
  if v_def = v_before then
    raise exception 'Could not patch fireblade_performance_intelligence_fast callback matcher';
  end if;

  execute v_def;
end;
$$;

commit;
