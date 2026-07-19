create table if not exists public.venue_alerts (
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id text not null,
  enabled boolean not null default true,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, venue_id)
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  business_name text,
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizer_venues (
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id text not null,
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  created_at timestamptz not null default now(),
  primary key (user_id, venue_id)
);

alter table public.venue_alerts enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.organizer_profiles enable row level security;
alter table public.organizer_venues enable row level security;

create policy "members manage venue alerts" on public.venue_alerts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "members manage push subscriptions" on public.push_subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "members manage organizer profile" on public.organizer_profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "members manage organizer claims" on public.organizer_venues for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
