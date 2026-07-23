create table if not exists public.buzz_calibration_models (
  id uuid primary key default gen_random_uuid(),
  model_key text not null unique,
  version text not null,
  model jsonb not null default '{}'::jsonb,
  training_rows integer not null default 0,
  mean_absolute_error numeric,
  trained_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists buzz_calibration_models_key_idx
  on public.buzz_calibration_models(model_key);

alter table public.buzz_calibration_models enable row level security;

revoke all on table public.buzz_calibration_models from anon, authenticated;
grant all on table public.buzz_calibration_models to service_role;
