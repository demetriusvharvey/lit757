-- LIT757 real notifications MVP
-- Safe to run more than once in the Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.saved_venues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id text not null,
  venue_name text,
  created_at timestamptz not null default now()
);

alter table public.saved_venues add column if not exists id uuid default gen_random_uuid();
alter table public.saved_venues add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.saved_venues add column if not exists venue_id text;
alter table public.saved_venues add column if not exists venue_name text;
alter table public.saved_venues add column if not exists created_at timestamptz default now();

create table if not exists public.venue_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id text not null,
  venue_name text,
  threshold integer not null default 80 check (threshold between 0 and 100),
  enabled boolean not null default true,
  quiet_hours_start time default '22:00',
  quiet_hours_end time default '08:00',
  timezone text not null default 'America/New_York',
  cooldown_minutes integer not null default 180,
  last_score integer,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.venue_alerts add column if not exists id uuid default gen_random_uuid();
alter table public.venue_alerts add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.venue_alerts add column if not exists venue_id text;
alter table public.venue_alerts add column if not exists venue_name text;
alter table public.venue_alerts add column if not exists threshold integer default 80;
alter table public.venue_alerts add column if not exists enabled boolean default true;
alter table public.venue_alerts add column if not exists quiet_hours_start time default '22:00';
alter table public.venue_alerts add column if not exists quiet_hours_end time default '08:00';
alter table public.venue_alerts add column if not exists timezone text default 'America/New_York';
alter table public.venue_alerts add column if not exists cooldown_minutes integer default 180;
alter table public.venue_alerts add column if not exists last_score integer;
alter table public.venue_alerts add column if not exists last_notified_at timestamptz;
alter table public.venue_alerts add column if not exists created_at timestamptz default now();
alter table public.venue_alerts add column if not exists updated_at timestamptz default now();

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  expiration_time bigint,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions add column if not exists id uuid default gen_random_uuid();
alter table public.push_subscriptions add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.push_subscriptions add column if not exists endpoint text;
alter table public.push_subscriptions add column if not exists p256dh text;
alter table public.push_subscriptions add column if not exists auth text;
alter table public.push_subscriptions add column if not exists expiration_time bigint;
alter table public.push_subscriptions add column if not exists user_agent text;
alter table public.push_subscriptions add column if not exists enabled boolean default true;
alter table public.push_subscriptions add column if not exists created_at timestamptz default now();
alter table public.push_subscriptions add column if not exists updated_at timestamptz default now();

-- Remove accidental duplicate rows before adding unique indexes.
delete from public.saved_venues a
using public.saved_venues b
where a.ctid < b.ctid
  and a.user_id = b.user_id
  and a.venue_id = b.venue_id;

delete from public.venue_alerts a
using public.venue_alerts b
where a.ctid < b.ctid
  and a.user_id = b.user_id
  and a.venue_id = b.venue_id;

delete from public.push_subscriptions a
using public.push_subscriptions b
where a.ctid < b.ctid
  and a.endpoint = b.endpoint;

create unique index if not exists saved_venues_user_venue_key
  on public.saved_venues(user_id, venue_id);
create unique index if not exists venue_alerts_user_venue_key
  on public.venue_alerts(user_id, venue_id);
create unique index if not exists push_subscriptions_endpoint_key
  on public.push_subscriptions(endpoint);
create index if not exists venue_alerts_enabled_idx
  on public.venue_alerts(enabled, venue_id);
create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id) where enabled = true;

alter table public.saved_venues enable row level security;
alter table public.venue_alerts enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "Users manage their saved venues" on public.saved_venues;
create policy "Users manage their saved venues"
on public.saved_venues for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users manage their venue alerts" on public.venue_alerts;
create policy "Users manage their venue alerts"
on public.venue_alerts for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users manage their push subscriptions" on public.push_subscriptions;
create policy "Users manage their push subscriptions"
on public.push_subscriptions for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update, delete on public.saved_venues to authenticated;
grant select, insert, update, delete on public.venue_alerts to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
