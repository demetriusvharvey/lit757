create table if not exists public.event_engagement (
  event_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('interested', 'going')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index if not exists event_engagement_event_status_idx
  on public.event_engagement (event_id, status);

alter table public.event_engagement enable row level security;

alter table public.events
  add column if not exists capacity integer,
  add column if not exists tickets_sold integer,
  add column if not exists ticket_sales_source text,
  add column if not exists ticket_sales_verified boolean not null default false,
  add column if not exists ticket_sales_updated_at timestamptz;

alter table public.events
  drop constraint if exists events_ticket_numbers_valid;

alter table public.events
  add constraint events_ticket_numbers_valid check (
    (capacity is null or capacity >= 0)
    and (tickets_sold is null or tickets_sold >= 0)
    and (capacity is null or tickets_sold is null or tickets_sold <= capacity)
  );

comment on column public.events.capacity is 'Organizer-provided total sellable ticket capacity.';
comment on column public.events.tickets_sold is 'Organizer or authorized ticket-source sales count.';
comment on column public.events.ticket_sales_verified is 'True only for organizer or authorized source data.';
