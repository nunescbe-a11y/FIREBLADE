-- Migration: Add location to fireblade_call_enquiries and update fireblade_information_sent_report
-- Safe additive migration.

alter table public.fireblade_call_enquiries
  add column if not exists location text not null default '';

alter table public.fireblade_contacts
  add column if not exists location text not null default '';

create index if not exists fireblade_enquiries_location_idx
  on public.fireblade_call_enquiries (lower(location));

-- Drop and re-create information sent report with location column
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
  location text,
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
    coalesce(q.location, ct.location, '') as location,
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
  b.location,
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
  b.product_name, b.location, b.requirement_details, b.notes
order by b.employee_name, b.customer_name, b.product_name, b.call_at;
$$;
