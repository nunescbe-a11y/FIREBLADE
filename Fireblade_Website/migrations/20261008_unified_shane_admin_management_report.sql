-- Fireblade: show all saved Shane details in the existing Admin/Management Information Sent Report.
-- Non-destructive: preserve original report RPC and every existing enquiry/detail record.
alter table public.fireblade_call_enquiries add column if not exists location text not null default '';
alter table public.fireblade_contacts add column if not exists location text not null default '';
alter table public.fireblade_contacts add column if not exists phone_number_raw text;
alter table public.fireblade_shane_call_details add column if not exists quotation boolean;
alter table public.fireblade_shane_call_details add column if not exists catalogue boolean;
alter table public.fireblade_shane_call_details add column if not exists image boolean;
create index if not exists fireblade_call_enquiries_location_lower_idx
  on public.fireblade_call_enquiries (lower(location));

-- The existing RPC has a fixed return type; create v2 instead of dropping it,
-- so existing website clients keep working.
create or replace function public.fireblade_information_sent_report_v2(
  p_start_date date, p_end_date date
)
returns table (
  enquiry_id uuid,
  call_id bigint,
  call_at timestamptz,
  device_id text,
  employee_id text,
  employee_name text,
  customer_name text,
  customer_company text,
  customer_phone text,
  product_name text,
  location text,
  requirement_details text,
  notes text,
  very_urgent boolean,
  information_items jsonb,
  source_kind text
)
language sql stable
set search_path = public, pg_temp
as $$
  with normalized as (
    select
      r.enquiry_id, r.call_id, r.call_at,
      c.device_id,
      r.employee_id, r.employee_name,
      r.customer_name, r.customer_company, r.customer_phone,
      r.product_name,
      coalesce(nullif(q.location, ''), nullif(ct.location, ''), nullif(sd.location, ''), '') as location,
      r.requirement_details, r.notes,
      sd.very_urgent,
      r.information_items,
      'ENQUIRY'::text as source_kind
    from public.fireblade_information_sent_report(p_start_date, p_end_date) r
    join public.phase0_calls c on c.id = r.call_id
    join public.fireblade_call_enquiries q on q.id = r.enquiry_id
    left join public.fireblade_contacts ct on ct.id = q.contact_id
    left join lateral (
      select d.location, d.very_urgent
      from public.fireblade_shane_call_details d
      where d.call_id = r.call_id
      order by d.updated_at desc
      limit 1
    ) sd on true
  ),
  saved_phone_details as (
    select
      sd.detail_id as enquiry_id,
      sd.call_id,
      to_timestamp(sd.call_started_at_epoch_ms / 1000.0) as call_at,
      sd.device_id,
      sd.employee_id,
      coalesce(nullif(e.employee_name, ''), nullif(sd.employee_id, ''), 'Unassigned') as employee_name,
      sd.customer_name,
      ''::text as customer_company,
      coalesce(nullif(sd.phone_number_raw, ''), sd.phone_number_normalized, '') as customer_phone,
      sd.product_asked as product_name,
      coalesce(sd.location, '') as location,
      ''::text as requirement_details,
      coalesce(sd.notes, '') as notes,
      sd.very_urgent,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', t.id,
            'code', t.code,
            'label', t.label,
            'sort_order', t.sort_order,
            'sent', case t.code
              when 'QUOTATION' then sd.quotation
              when 'CATALOGUE' then sd.catalogue
              when 'IMAGE' then sd.image
              else null
            end,
            'remarks', null,
            'answered_by', sd.employee_id,
            'updated_at', sd.updated_at
          ) order by t.sort_order, t.label
        )
        from public.fireblade_information_types t
        where t.code in ('QUOTATION', 'CATALOGUE', 'IMAGE')
          and case t.code
            when 'QUOTATION' then sd.quotation
            when 'CATALOGUE' then sd.catalogue
            when 'IMAGE' then sd.image
            else null
          end is not null
      ), '[]'::jsonb) as information_items,
      'SAVED_PHONE_DETAILS'::text as source_kind
    from public.fireblade_shane_call_details sd
    left join public.fireblade_employees e on e.employee_id = sd.employee_id
    where sd.device_id <> 'MKT-001'
      and (to_timestamp(sd.call_started_at_epoch_ms / 1000.0) at time zone 'Asia/Kolkata')::date
          between p_start_date and p_end_date
      and not exists (
        select 1 from public.fireblade_call_enquiries q
        where q.call_id = sd.call_id
          and q.resolution_outcome = 'DETAILS_ENTERED'
      )
  )
  select * from normalized
  union all
  select * from saved_phone_details
  order by employee_name, call_at desc, customer_name;
$$;

-- The report is invoked server-side after verifying an Admin or Management session.
revoke all on function public.fireblade_information_sent_report_v2(date,date)
  from PUBLIC, anon, authenticated;
grant execute on function public.fireblade_information_sent_report_v2(date,date)
  to service_role;
