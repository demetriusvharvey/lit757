-- Privacy-safe first-party product analytics for Buzz sharing and referral funnels.
-- Raw location, phone numbers, message recipients, and shared content are intentionally excluded.

create extension if not exists pgcrypto;

create table if not exists public.buzz_conversion_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null check (event_name in (
    'share_attempt',
    'share_complete',
    'share_cancel',
    'share_fallback',
    'copy_link',
    'sms_open',
    'story_download',
    'shared_link_open',
    'venue_view',
    'favorite_add',
    'watch_add'
  )),
  venue_id uuid references public.venues(id) on delete set null,
  user_id uuid,
  anonymous_id text not null check (char_length(anonymous_id) between 8 and 128),
  session_id text check (session_id is null or char_length(session_id) between 8 and 128),
  referral_id text check (referral_id is null or char_length(referral_id) between 8 and 128),
  source text,
  channel text,
  truth_mode text check (truth_mode is null or truth_mode in ('live','forecast')),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists buzz_conversion_event_time_idx
  on public.buzz_conversion_events(event_name, occurred_at desc);
create index if not exists buzz_conversion_referral_idx
  on public.buzz_conversion_events(referral_id, occurred_at)
  where referral_id is not null;
create index if not exists buzz_conversion_venue_idx
  on public.buzz_conversion_events(venue_id, occurred_at desc)
  where venue_id is not null;
create index if not exists buzz_conversion_anonymous_idx
  on public.buzz_conversion_events(anonymous_id, occurred_at desc);
create index if not exists buzz_conversion_user_idx
  on public.buzz_conversion_events(user_id, occurred_at desc)
  where user_id is not null;

alter table public.buzz_conversion_events enable row level security;

-- No client policy is created. Browser events are validated and written by the
-- server route with the Supabase service role, which keeps the table private.
comment on table public.buzz_conversion_events is
  'First-party Buzz product analytics without precise location or message-recipient data.';
