-- Security reconciliation prepared offline.
-- Apply only after a production backup and after every earlier migration succeeds.
-- This migration is intentionally idempotent so a partially initialized project
-- can be reconciled without reopening private tables.

-- Server-owned evidence must never be writable through the anon/authenticated
-- PostgREST roles. Service-role API routes retain BYPASSRLS access.
revoke all on table
  public.buzz_provider_venues,
  public.buzz_provider_events,
  public.buzz_signal_snapshots,
  public.buzz_score_history,
  public.venue_partner_pulses,
  public.buzz_user_reports,
  public.buzz_ground_truth,
  public.buzz_conversion_events,
  public.buzz_signal_provenance,
  public.buzz_observer_reputation,
  public.buzz_alert_deliveries,
  public.buzz_group_rooms,
  public.buzz_group_votes,
  public.buzz_scenes,
  public.buzz_product_events
from anon, authenticated;

-- The current score snapshot is deliberately sanitized for public discovery.
revoke all on table public.buzz_score_snapshots from anon, authenticated;
grant select on table public.buzz_score_snapshots to anon, authenticated;

-- Direct reads of raw evidence, invite codes, vote identities and storage paths
-- contradicted the server-API trust boundary documented in the platform migration.
drop policy if exists "public reads fresh signal provenance" on public.buzz_signal_provenance;
drop policy if exists "public reads active group rooms" on public.buzz_group_rooms;
drop policy if exists "public reads group votes" on public.buzz_group_votes;
drop policy if exists "public reads active approved scenes" on public.buzz_scenes;
drop policy if exists "users create own scenes" on public.buzz_scenes;
drop policy if exists "users insert product events" on public.buzz_product_events;

-- These views expose raw evidence through the view owner unless permissions are
-- explicitly removed. Server routes can still query the base tables.
revoke all on table public.buzz_current_signals from public, anon, authenticated;
revoke all on table public.buzz_truth_quality from public, anon, authenticated;

-- Owners may maintain facts, but verification state and ownership are controlled
-- exclusively by trusted server-side review.
drop policy if exists "users manage own business facts" on public.buzz_verified_businesses;
drop policy if exists "owners read own business facts" on public.buzz_verified_businesses;
create policy "owners read own business facts"
  on public.buzz_verified_businesses for select to authenticated
  using (auth.uid() = owner_user_id);
drop policy if exists "owners submit pending business facts" on public.buzz_verified_businesses;
create policy "owners submit pending business facts"
  on public.buzz_verified_businesses for insert to authenticated
  with check (auth.uid() = owner_user_id and verification_status = 'pending');
drop policy if exists "owners update own business facts" on public.buzz_verified_businesses;
create policy "owners update own business facts"
  on public.buzz_verified_businesses for update to authenticated
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

create or replace function public.protect_buzz_managed_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if tg_table_name = 'buzz_verified_businesses' then
      if tg_op = 'INSERT' then
        new.verification_status := 'pending';
      elsif new.owner_user_id is distinct from old.owner_user_id
         or new.verification_status is distinct from old.verification_status then
        raise exception 'Managed verification fields cannot be changed by clients';
      end if;
    elsif tg_table_name = 'organizer_profiles' then
      if tg_op = 'INSERT' then
        new.status := 'pending';
      elsif new.status is distinct from old.status then
        raise exception 'Organizer verification status is server-managed';
      end if;
    elsif tg_table_name = 'organizer_venues' then
      if tg_op = 'INSERT' then
        new.status := 'pending';
      elsif new.status is distinct from old.status then
        raise exception 'Organizer claim status is server-managed';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_buzz_verified_business_fields on public.buzz_verified_businesses;
create trigger protect_buzz_verified_business_fields
before insert or update on public.buzz_verified_businesses
for each row execute function public.protect_buzz_managed_fields();

drop trigger if exists protect_organizer_profile_status on public.organizer_profiles;
create trigger protect_organizer_profile_status
before insert or update on public.organizer_profiles
for each row execute function public.protect_buzz_managed_fields();

drop trigger if exists protect_organizer_venue_status on public.organizer_venues;
create trigger protect_organizer_venue_status
before insert or update on public.organizer_venues
for each row execute function public.protect_buzz_managed_fields();

-- SECURITY DEFINER helpers are internal maintenance functions, not public RPCs.
revoke all on function public.sync_event_momentum_counts(text) from public, anon, authenticated;
revoke all on function public.refresh_member_points(uuid) from public, anon, authenticated;
revoke all on function public.expire_buzz_ephemeral_data() from public, anon, authenticated;
revoke all on function public.protect_buzz_managed_fields() from public, anon, authenticated;

-- Force ownership policies even if future code accidentally uses a table-owner
-- connection. Supabase's service_role retains BYPASSRLS for trusted API work.
alter table public.member_profiles force row level security;
alter table public.points_ledger force row level security;
alter table public.activity_reports force row level security;
alter table public.owner_signup_notifications force row level security;
alter table public.event_engagement force row level security;
alter table public.event_responses force row level security;
alter table public.saved_venues force row level security;
alter table public.venue_alerts force row level security;
alter table public.push_subscriptions force row level security;
alter table public.organizer_profiles force row level security;
alter table public.organizer_venues force row level security;
alter table public.buzz_watches force row level security;
alter table public.buzz_verified_businesses force row level security;
