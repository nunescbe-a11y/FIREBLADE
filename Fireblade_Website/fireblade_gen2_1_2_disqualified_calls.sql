-- FIREBLADE GEN 2.1.2 - DISQUALIFIED CALL HANDLING
-- Apply once to the existing Fireblade production Supabase project before deploying Web 2.1.2.
--
-- Purpose:
--   * Marketing employees may mark an owned call as DISQUALIFIED.
--   * DISQUALIFIED counts as handled/completed (so it is not pending).
--   * No customer/contact or Information Sent answers are required.
--   * Management/Admin Information Sent reports and exports exclude DISQUALIFIED.
--   * Existing Send Product backend tables/routes are unchanged.

begin;

alter table public.fireblade_call_enquiries
  add column if not exists resolution_outcome text not null default 'DETAILS_ENTERED',
  add column if not exists resolution_at timestamptz null,
  add column if not exists resolution_by text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.fireblade_call_enquiries'::regclass
      and conname = 'fireblade_call_enquiries_resolution_outcome_check'
  ) then
    alter table public.fireblade_call_enquiries
      add constraint fireblade_call_enquiries_resolution_outcome_check
      check (resolution_outcome in ('DETAILS_ENTERED', 'DISQUALIFIED'));
  end if;
end $$;

-- Existing enquiry rows are normal details-filled rows.
update public.fireblade_call_enquiries
set resolution_outcome = 'DETAILS_ENTERED',
    resolution_at = coalesce(resolution_at, updated_at, created_at),
    resolution_by = coalesce(resolution_by, updated_by, last_updated_by, entered_by)
where resolution_outcome = 'DETAILS_ENTERED'
  and resolution_at is null;

-- A disqualified call intentionally has no customer/contact record.
alter table public.fireblade_call_enquiries
  alter column contact_id drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.fireblade_call_enquiries'::regclass
      and conname = 'fireblade_call_enquiries_contact_required_for_details_check'
  ) then
    alter table public.fireblade_call_enquiries
      add constraint fireblade_call_enquiries_contact_required_for_details_check
      check (resolution_outcome = 'DISQUALIFIED' or contact_id is not null);
  end if;
end $$;

create index if not exists fireblade_call_enquiries_resolution_outcome_idx
  on public.fireblade_call_enquiries (resolution_outcome, call_id);

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
  v_employee_name text;
  v_department_name text;
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

  -- Ownership is resolved through the same incoming-call view used by employee login.
  if not exists (
    select 1
    from public.fireblade_incoming_calls c
    where c.call_id = p_call_id
      and c.registered_employee_id = p_employee_id
  ) then
    raise exception 'Call is not assigned to this employee';
  end if;

  select e.id
    into v_enquiry_id
  from public.fireblade_call_enquiries e
  where e.call_id = p_call_id;

  if v_enquiry_id is not null then
    if exists (
      select 1
      from public.fireblade_call_enquiries e
      where e.id = v_enquiry_id
        and e.resolution_outcome <> 'DISQUALIFIED'
    ) then
      raise exception 'Call already has enquiry details';
    end if;

    update public.fireblade_call_enquiries
       set status = 'COMPLETED',
           resolution_outcome = 'DISQUALIFIED',
           resolution_at = now(),
           resolution_by = coalesce(nullif(btrim(p_actor), ''), p_employee_id),
           entered_by = coalesce(entered_by, p_employee_id),
           updated_by = coalesce(nullif(btrim(p_actor), ''), p_employee_id),
           last_updated_by = coalesce(nullif(btrim(p_actor), ''), p_employee_id),
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
      coalesce(nullif(btrim(p_actor), ''), p_employee_id),
      coalesce(nullif(btrim(p_actor), ''), p_employee_id),
      'DISQUALIFIED',
      now(),
      coalesce(nullif(btrim(p_actor), ''), p_employee_id)
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
    coalesce(nullif(btrim(p_actor), ''), p_employee_id),
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

-- Information Sent has no meaning for a disqualified call. Keep the backend data model intact,
-- but prevent any checklist answers from being attached to this outcome.
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
      and e.resolution_outcome = 'DISQUALIFIED'
  ) then
    raise exception 'Information Sent is not applicable to a disqualified call';
  end if;
  return new;
end;
$$;

revoke all on function public.fireblade_block_info_sent_for_disqualified()
  from public, anon, authenticated;
grant execute on function public.fireblade_block_info_sent_for_disqualified()
  to service_role;

drop trigger if exists fireblade_block_info_sent_for_disqualified_trg
  on public.fireblade_enquiry_information_sent;

create trigger fireblade_block_info_sent_for_disqualified_trg
before insert or update on public.fireblade_enquiry_information_sent
for each row
execute function public.fireblade_block_info_sent_for_disqualified();

-- Management/Admin Customer Follow-Up -> Information Sent uses this RPC.
-- DISQUALIFIED rows are explicitly excluded from screen rows, count, CSV and Excel.
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
  where q.resolution_outcome <> 'DISQUALIFIED'
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

commit;
