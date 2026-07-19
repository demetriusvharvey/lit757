create table if not exists public.member_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  home_city text,
  interests text[] not null default '{}',
  points integer not null default 25,
  reputation_level text not null default 'New Member',
  onboarding_complete boolean not null default false,
  signup_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_momentum (
  event_id text primary key,
  event_name text not null,
  venue_name text,
  capacity integer check (capacity is null or capacity >= 0),
  tickets_sold integer check (tickets_sold is null or tickets_sold >= 0),
  ticket_status text,
  sales_source text,
  sales_verified boolean not null default false,
  interested_count integer not null default 0 check (interested_count >= 0),
  going_count integer not null default 0 check (going_count >= 0),
  sales_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_count_valid check (capacity is null or tickets_sold is null or tickets_sold <= capacity)
);

create table if not exists public.event_responses (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null references public.event_momentum(event_id) on delete cascade,
  response text not null check (response in ('interested', 'going')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

alter table public.member_profiles enable row level security;
alter table public.event_momentum enable row level security;
alter table public.event_responses enable row level security;

do $$ begin
  create policy "members read own profile" on public.member_profiles for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "members update own profile" on public.member_profiles for update using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "public reads event momentum" on public.event_momentum for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "members manage own event responses" on public.event_responses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

create or replace function public.sync_event_momentum_counts(target_event_id text)
returns void language sql security definer set search_path = public as $$
  update public.event_momentum
  set interested_count = (select count(*) from public.event_responses where event_id = target_event_id and response = 'interested'),
      going_count = (select count(*) from public.event_responses where event_id = target_event_id and response = 'going'),
      updated_at = now()
  where event_id = target_event_id;
$$;
