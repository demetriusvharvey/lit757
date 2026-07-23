-- Buzz real-time activity platform
-- Durable truth, watches, groups, observer reputation, business facts, scenes, and product metrics.

create extension if not exists pgcrypto;

create table if not exists public.buzz_signal_provenance (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  source text not null,
  family text not null check (family in ('verified_presence','community_report','official_venue','traffic','parking','event','historical','model')),
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  direct boolean not null default false,
  verified_nearby boolean not null default false,
  geographic_accuracy_m numeric,
  corroborations integer not null default 0 check (corroborations >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists buzz_signal_provenance_venue_expiry_idx on public.buzz_signal_provenance(venue_id, expires_at desc);
create index if not exists buzz_signal_provenance_family_observed_idx on public.buzz_signal_provenance(family, observed_at desc);

create table if not exists public.buzz_observer_reputation (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reputation numeric(6,3) not null default 0.5 check (reputation between 0 and 1),
  trusted_observer boolean not null default false,
  observer_role text,
  reports_submitted integer not null default 0,
  reports_corroborated integer not null default 0,
  reports_disputed integer not null default 0,
  velocity_flags integer not null default 0,
  impossible_travel_flags integer not null default 0,
  last_report_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.buzz_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('venue','area','category','event','plan')),
  target_id text not null,
  target_name text not null,
  alert_mode text not null default 'balanced' check (alert_mode in ('essential','balanced','live','scheduled','digest')),
  min_state text check (min_state in ('unknown','quiet','active','hot')),
  require_rising boolean not null default true,
  max_distance_miles numeric(6,2),
  quiet_hour_start smallint check (quiet_hour_start between 0 and 23),
  quiet_hour_end smallint check (quiet_hour_end between 0 and 23),
  active_days smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
  active_start timestamptz,
  active_end timestamptz,
  enabled boolean not null default true,
  last_notified_at timestamptz,
  last_notified_state text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, kind, target_id)
);
create index if not exists buzz_watches_enabled_idx on public.buzz_watches(enabled, kind, target_id);

create table if not exists public.buzz_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  watch_id uuid not null references public.buzz_watches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id uuid references public.venues(id) on delete set null,
  previous_state text,
  next_state text,
  previous_trend text,
  next_trend text,
  reason text not null,
  suppressed boolean not null default false,
  suppression_reason text,
  delivered_at timestamptz,
  opened_at timestamptz,
  directions_started_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists buzz_alert_deliveries_user_created_idx on public.buzz_alert_deliveries(user_id, created_at desc);

create table if not exists public.buzz_area_snapshots (
  id uuid primary key default gen_random_uuid(),
  area_id text not null,
  area_name text not null,
  geohash_prefix text not null,
  venue_count integer not null check (venue_count >= 3),
  activity_score numeric(5,2) not null,
  activity_state text not null,
  trend text not null,
  confidence numeric(4,3) not null,
  computed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists buzz_area_snapshots_area_time_idx on public.buzz_area_snapshots(area_id, computed_at desc);

create table if not exists public.buzz_group_rooms (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  code text not null unique,
  title text not null default 'Buzz crew plan',
  city text,
  desired_energy text check (desired_energy in ('chill','balanced','high')),
  parking_important boolean not null default false,
  budget text check (budget in ('free','moderate','any')),
  max_distance_miles numeric(6,2),
  selected_venue_id uuid references public.venues(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);

create table if not exists public.buzz_group_votes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.buzz_group_rooms(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  voter_id uuid references auth.users(id) on delete set null,
  anonymous_token_hash text,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  unique(room_id, venue_id, voter_id)
);

create table if not exists public.buzz_scenes (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  storage_path text not null,
  media_type text not null check (media_type in ('image','video')),
  duration_seconds numeric(4,1) check (duration_seconds between 0 and 7),
  verified_nearby boolean not null default false,
  faces_blurred boolean not null default false,
  moderation_status text not null default 'pending' check (moderation_status in ('pending','approved','rejected','removed')),
  expires_at timestamptz not null default (now() + interval '2 hours'),
  created_at timestamptz not null default now()
);
create index if not exists buzz_scenes_venue_expiry_idx on public.buzz_scenes(venue_id, expires_at desc) where moderation_status = 'approved';

create table if not exists public.buzz_verified_businesses (
  venue_id uuid primary key references public.venues(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','rejected','suspended')),
  official_hours jsonb,
  official_events jsonb not null default '[]'::jsonb,
  cover_charge text,
  age_requirement text,
  dress_policy text,
  parking_instructions text,
  accessibility text,
  temporary_status text,
  updated_at timestamptz not null default now()
);

create table if not exists public.buzz_product_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  anonymous_id text,
  event_name text not null,
  venue_id uuid references public.venues(id) on delete set null,
  area_id text,
  truth_mode text,
  confidence text,
  intent text,
  horizon text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists buzz_product_events_name_time_idx on public.buzz_product_events(event_name, created_at desc);

alter table public.buzz_signal_provenance enable row level security;
alter table public.buzz_observer_reputation enable row level security;
alter table public.buzz_watches enable row level security;
alter table public.buzz_alert_deliveries enable row level security;
alter table public.buzz_area_snapshots enable row level security;
alter table public.buzz_group_rooms enable row level security;
alter table public.buzz_group_votes enable row level security;
alter table public.buzz_scenes enable row level security;
alter table public.buzz_verified_businesses enable row level security;
alter table public.buzz_product_events enable row level security;

-- Public reads expose aggregated truth, never individual presence.
drop policy if exists "public reads fresh signal provenance" on public.buzz_signal_provenance;
create policy "public reads fresh signal provenance" on public.buzz_signal_provenance for select using (expires_at > now());
drop policy if exists "public reads fresh areas" on public.buzz_area_snapshots;
create policy "public reads fresh areas" on public.buzz_area_snapshots for select using (expires_at > now() and venue_count >= 3);
drop policy if exists "public reads active approved scenes" on public.buzz_scenes;
create policy "public reads active approved scenes" on public.buzz_scenes for select using (moderation_status = 'approved' and expires_at > now());
drop policy if exists "public reads active group rooms" on public.buzz_group_rooms;
create policy "public reads active group rooms" on public.buzz_group_rooms for select using (expires_at > now());
drop policy if exists "public reads group votes" on public.buzz_group_votes;
create policy "public reads group votes" on public.buzz_group_votes for select using (exists (select 1 from public.buzz_group_rooms r where r.id = room_id and r.expires_at > now()));

-- Private user-owned data.
drop policy if exists "users manage own watches" on public.buzz_watches;
create policy "users manage own watches" on public.buzz_watches for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "users read own alerts" on public.buzz_alert_deliveries;
create policy "users read own alerts" on public.buzz_alert_deliveries for select using (auth.uid() = user_id);
drop policy if exists "users read own reputation" on public.buzz_observer_reputation;
create policy "users read own reputation" on public.buzz_observer_reputation for select using (auth.uid() = user_id);
drop policy if exists "users create own scenes" on public.buzz_scenes;
create policy "users create own scenes" on public.buzz_scenes for insert with check (auth.uid() = user_id);
drop policy if exists "users manage own business facts" on public.buzz_verified_businesses;
create policy "users manage own business facts" on public.buzz_verified_businesses for all using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
drop policy if exists "users insert product events" on public.buzz_product_events;
create policy "users insert product events" on public.buzz_product_events for insert with check (user_id is null or auth.uid() = user_id);

-- Group rooms allow anonymous, expiring participation through server-side APIs only.
-- Service-role APIs validate room expiry, hash anonymous tokens, and rate-limit votes.

create or replace function public.expire_buzz_ephemeral_data() returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.buzz_scenes where expires_at < now() - interval '1 day';
  delete from public.buzz_group_rooms where expires_at < now() - interval '7 days';
  delete from public.buzz_signal_provenance where expires_at < now() - interval '7 days';
end;
$$;

create or replace view public.buzz_truth_quality as
select
  count(*) filter (where expires_at > now()) as fresh_signal_count,
  count(*) filter (where direct and expires_at > now()) as fresh_direct_count,
  count(*) filter (where verified_nearby and expires_at > now()) as fresh_verified_count,
  round(avg(confidence) filter (where expires_at > now()), 3) as average_fresh_confidence,
  count(distinct venue_id) filter (where expires_at > now()) as covered_venues
from public.buzz_signal_provenance;
