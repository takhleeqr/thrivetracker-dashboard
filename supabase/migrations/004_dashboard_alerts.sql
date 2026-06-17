create table if not exists public.dashboard_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  va_name text not null,
  type text not null check (type in ('low_activity', 'stale_heartbeat', 'missing_heartbeat', 'crash_closed', 'late_start', 'no_show')),
  severity text not null check (severity in ('warning', 'critical')),
  title text not null,
  message text not null,
  source text not null default 'dashboard_cron',
  is_active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_dashboard_alerts_active on public.dashboard_alerts(is_active, user_id);
create index if not exists idx_dashboard_alerts_user_seen on public.dashboard_alerts(user_id, last_seen_at desc);

alter table public.dashboard_alerts enable row level security;

drop policy if exists "admins_read_dashboard_alerts" on public.dashboard_alerts;
create policy "admins_read_dashboard_alerts"
on public.dashboard_alerts
for select
to authenticated
using (public.is_admin());
