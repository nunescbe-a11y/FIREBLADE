-- Apply AFTER the existing V1.2 device-health migration. Calls and enquiries are untouched.
begin;
create table if not exists public.fireblade_departments (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 80),
 active boolean not null default true, created_at timestamptz not null default now()
);
create unique index if not exists fireblade_department_name on public.fireblade_departments(lower(name));
alter table public.fireblade_employees add column if not exists department_id uuid references public.fireblade_departments(id);
create index if not exists fireblade_employee_department on public.fireblade_employees(department_id);
alter table public.fireblade_device_health add column if not exists received_at timestamptz;
alter table public.fireblade_device_health add column if not exists source_verified boolean not null default false;
alter table public.fireblade_device_health add column if not exists observed_at_epoch_ms bigint;
alter table public.fireblade_device_health add column if not exists app_version_code integer;
alter table public.fireblade_device_health add column if not exists permission_state jsonb;
create table if not exists public.fireblade_device_credentials (
 device_id text primary key references public.fireblade_devices(device_id), token_hash text not null,
 enrolled_at timestamptz not null default now(), revoked_at timestamptz
);
create table if not exists public.fireblade_enrollment_codes (
 code_hash text primary key, device_id text not null references public.fireblade_devices(device_id),
 expires_at timestamptz not null, used_at timestamptz, created_by text not null
);
create table if not exists public.fireblade_push_tokens (
 device_id text primary key references public.fireblade_devices(device_id), token text not null,
 updated_at timestamptz not null default now()
);
create table if not exists public.fireblade_device_checks (
 request_id uuid primary key default gen_random_uuid(), device_id text not null references public.fireblade_devices(device_id),
 requested_by text not null, requested_at timestamptz not null default now(),
 expires_at timestamptz not null default (now() + interval '90 seconds'),
 status text not null default 'PENDING' check(status in ('PENDING','RESPONDED')),
 responded_at timestamptz, snapshot jsonb, delivery_status text not null default 'QUEUED',
 check(expires_at > requested_at)
);
create index if not exists fireblade_checks_device_time on public.fireblade_device_checks(device_id,requested_at desc);
create index if not exists fireblade_checks_pending on public.fireblade_device_checks(device_id,expires_at) where status='PENDING';
create or replace view public.fireblade_latest_checks with(security_invoker=true) as
 select distinct on(device_id) * from public.fireblade_device_checks order by device_id,requested_at desc,request_id desc;
create table if not exists public.fireblade_app_releases (
 id uuid primary key default gen_random_uuid(), version_code integer not null unique check(version_code > 5),
 version_name text not null check(length(version_name) between 1 and 80),
 package_name text not null default 'com.nunes.callcollector' check(package_name='com.nunes.callcollector'),
 object_path text not null unique, sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 size_bytes bigint not null check(size_bytes between 1 and 157286400), notes text not null default '',
 status text not null default 'DRAFT' check(status in ('DRAFT','PUBLISHED')),
 created_by text not null, created_at timestamptz not null default now(), published_at timestamptz
);
create table if not exists public.fireblade_update_status (
 device_id text primary key references public.fireblade_devices(device_id),
 release_id uuid references public.fireblade_app_releases(id),
 stage text not null check(stage in ('CURRENT','AVAILABLE','DOWNLOADING','AWAITING_INSTALL','FAILED')),
 app_version_code integer, last_checked_at timestamptz not null default now(), message text
);
create table if not exists public.fireblade_audit (
 id bigint generated always as identity primary key, occurred_at timestamptz not null default now(),
 actor text not null, action text not null, subject text not null, details jsonb not null default '{}'::jsonb
);
create index if not exists fireblade_audit_time on public.fireblade_audit(occurred_at desc);
create index if not exists fireblade_audit_subject on public.fireblade_audit(subject,occurred_at desc);

-- Only the existing trusted server may reach these tables and functions.
alter table public.fireblade_departments enable row level security;
alter table public.fireblade_device_credentials enable row level security;
alter table public.fireblade_enrollment_codes enable row level security;
alter table public.fireblade_push_tokens enable row level security;
alter table public.fireblade_device_checks enable row level security;
alter table public.fireblade_app_releases enable row level security;
alter table public.fireblade_update_status enable row level security;
alter table public.fireblade_audit enable row level security;
revoke all on public.fireblade_departments,public.fireblade_device_credentials,public.fireblade_enrollment_codes,
 public.fireblade_push_tokens,public.fireblade_device_checks,public.fireblade_latest_checks,
 public.fireblade_app_releases,public.fireblade_update_status,public.fireblade_audit from anon,authenticated;
grant all on public.fireblade_departments,public.fireblade_device_credentials,public.fireblade_enrollment_codes,
 public.fireblade_push_tokens,public.fireblade_device_checks,public.fireblade_app_releases,public.fireblade_update_status to service_role;
grant select on public.fireblade_latest_checks to service_role;
grant select,insert on public.fireblade_audit to service_role;
grant usage,select on sequence public.fireblade_audit_id_seq to service_role;
grant select,update on public.fireblade_devices,public.fireblade_employees to service_role;
grant select,insert,update on public.fireblade_device_health to service_role;
grant select,insert on public.fireblade_device_health_history to service_role;

create or replace function public.fireblade_enroll_device(p_device_id text,p_code_hash text,p_token_hash text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.fireblade_devices where device_id=p_device_id and active) then return false; end if;
 update public.fireblade_enrollment_codes set used_at=now() where code_hash=p_code_hash and device_id=p_device_id and used_at is null and expires_at>now();
 if not found then return false; end if;
 insert into public.fireblade_device_credentials(device_id,token_hash) values(p_device_id,p_token_hash)
 on conflict(device_id) do update set token_hash=excluded.token_hash,enrolled_at=now(),revoked_at=null;
 delete from public.fireblade_push_tokens where device_id=p_device_id;
 insert into public.fireblade_audit(actor,action,subject) values(p_device_id,'DEVICE_ENROLLED',p_device_id);
 return true;
end $$;

create or replace function public.fireblade_request_check(p_device_id text,p_actor text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.fireblade_device_checks;
begin
 -- A row lock prevents overlapping requests from bypassing the cooldown.
 perform 1 from public.fireblade_devices where device_id=p_device_id and active for update;
 if not found then raise exception 'Device not active'; end if;
 if exists(select 1 from public.fireblade_device_checks where device_id=p_device_id and requested_at>now()-interval '15 seconds') then
   raise exception 'Please wait 15 seconds before checking this phone again';
 end if;
 insert into public.fireblade_device_checks(device_id,requested_by) values(p_device_id,p_actor) returning * into r;
 insert into public.fireblade_audit(actor,action,subject,details) values(p_actor,'CHECK_REQUESTED',p_device_id,jsonb_build_object('request_id',r.request_id));
 return to_jsonb(r);
end $$;

create or replace function public.fireblade_accept_health(p_report jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 insert into public.fireblade_device_health select * from jsonb_populate_record(null::public.fireblade_device_health,p_report)
 on conflict(device_id) do update set
 heartbeat_at=excluded.heartbeat_at,employee_name=excluded.employee_name,event_type=excluded.event_type,
 mobile_data_state=excluded.mobile_data_state,internet_available=excluded.internet_available,
 network_type=excluded.network_type,wifi_connected=excluded.wifi_connected,cellular_connected=excluded.cellular_connected,
 battery_percent=excluded.battery_percent,charging=excluded.charging,airplane_mode=excluded.airplane_mode,
 sim_count=excluded.sim_count,sim1_state=excluded.sim1_state,sim2_state=excluded.sim2_state,default_data_sim_slot=excluded.default_data_sim_slot,
 apk_version=excluded.apk_version,android_version=excluded.android_version,device_model=excluded.device_model,
 pending_uploads=excluded.pending_uploads,last_call_sync_epoch_ms=excluded.last_call_sync_epoch_ms,boot_epoch_ms=excluded.boot_epoch_ms,
 collector_state=excluded.collector_state,collector_message=excluded.collector_message,shutdown_confirmed_at=excluded.shutdown_confirmed_at,
 updated_at=excluded.updated_at,received_at=excluded.received_at,source_verified=excluded.source_verified,
 observed_at_epoch_ms=excluded.observed_at_epoch_ms,app_version_code=excluded.app_version_code,permission_state=excluded.permission_state
 where (not fireblade_device_health.source_verified or excluded.source_verified)
   and (excluded.observed_at_epoch_ms>=coalesce(fireblade_device_health.observed_at_epoch_ms,0) or excluded.event_type in ('BOOT','MANUAL_CHECK'));
 if not found then return false; end if;
 if p_report->>'event_type' in ('SHUTDOWN','BOOT','PACKAGE_REPLACED','CONFIG_SAVED') then
  insert into public.fireblade_audit(actor,action,subject,details)
   values(p_report->>'device_id',p_report->>'event_type',p_report->>'device_id',jsonb_build_object('apk_version',p_report->>'apk_version','verified',p_report->'source_verified'));
 end if;
 return true;
end $$;

create or replace function public.fireblade_respond_check(p_request_id uuid,p_device_id text,p_snapshot jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_snapshot->>'device_id' <> p_device_id then return false; end if;
 update public.fireblade_device_checks set status='RESPONDED',responded_at=now(),snapshot=p_snapshot
 where request_id=p_request_id and device_id=p_device_id and status='PENDING' and expires_at>now();
 if not found then return false; end if;
 perform public.fireblade_accept_health(p_snapshot || jsonb_build_object(
  'source_verified',true,'received_at',now(),'heartbeat_at',now(),'updated_at',now(),
  'event_type','MANUAL_CHECK','shutdown_confirmed_at',null));
 insert into public.fireblade_audit(actor,action,subject,details) values(p_device_id,'CHECK_RESPONDED',p_device_id,jsonb_build_object('request_id',p_request_id));
 return true;
end $$;

create or replace function public.fireblade_department_change(p_id uuid,p_name text,p_employee_id text,p_actor text,p_action text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_action='CREATE' then
  insert into public.fireblade_departments(name) values(trim(p_name));
 elsif p_action='RENAME' then
  update public.fireblade_departments set name=trim(p_name) where id=p_id;
  if not found then raise exception 'Department not found'; end if;
 elsif p_action='ASSIGN' then
  update public.fireblade_employees set department_id=p_id,updated_at=now() where employee_id=p_employee_id;
  if not found then raise exception 'Employee not found'; end if;
 else raise exception 'Invalid action'; end if;
 insert into public.fireblade_audit(actor,action,subject,details)
 values(p_actor,'DEPARTMENT_'||p_action,coalesce(p_employee_id,p_id::text,p_name),jsonb_build_object('department_id',p_id,'name',p_name));
end $$;

revoke all on function public.fireblade_enroll_device(text,text,text), public.fireblade_request_check(text,text),
 public.fireblade_accept_health(jsonb),public.fireblade_respond_check(uuid,text,jsonb),public.fireblade_department_change(uuid,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.fireblade_enroll_device(text,text,text),public.fireblade_request_check(text,text),
 public.fireblade_accept_health(jsonb),public.fireblade_respond_check(uuid,text,jsonb),public.fireblade_department_change(uuid,text,text,text,text)
 to service_role;

-- Private APK storage. No public read/write policies are added.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('fireblade-releases','fireblade-releases',false,157286400,array['application/vnd.android.package-archive','application/octet-stream'])
 on conflict(id) do nothing;
commit;
