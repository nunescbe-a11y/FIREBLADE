-- Fireblade targeted release safety gate
-- Allows a published APK to be visible to one enrolled test phone before promotion.

alter table public.fireblade_app_releases
  add column if not exists target_device_id text null
  references public.fireblade_devices(device_id);

create index if not exists fireblade_app_releases_target
  on public.fireblade_app_releases(target_device_id, status, version_code desc);

comment on column public.fireblade_app_releases.target_device_id is
  'NULL = stable/all eligible devices. Non-NULL = only that enrolled device may discover/download this release.';
