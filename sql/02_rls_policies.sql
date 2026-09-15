-- =========================================================
-- BOMB ARENA — 02_rls_policies.sql
-- Run this AFTER 01_schema.sql, in the Supabase SQL Editor.
-- =========================================================

-- ---------------------------------------------------------
-- Helper function: is_admin()
-- SECURITY DEFINER means this function runs with the
-- permissions of the function's OWNER (not the caller), so
-- it can safely check the profiles table without triggering
-- infinite RLS recursion on profiles itself.
-- This is the standard Supabase pattern for admin checks.
-- ---------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------
-- Helper view: public_profiles
-- A safe, read-only view exposing ONLY non-sensitive columns.
-- Other players' username/avatar are shown via this view
-- (lobby, leaderboard, chat) instead of the raw profiles
-- table, so emails/status/role are never leaked to everyone.
-- Views in Postgres run with the owner's privileges by
-- default, so this bypasses the strict profiles RLS below
-- on purpose, but only exposes these 4 columns.
-- ---------------------------------------------------------
create or replace view public.public_profiles as
  select id, username, avatar_url, created_at
  from public.profiles;

grant select on public.public_profiles to authenticated;

-- =========================================================
-- PROFILES
-- =========================================================
alter table public.profiles enable row level security;

create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own_or_admin"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

-- Prevent a normal (non-admin) user from promoting themselves
-- to admin or re-enabling a disabled account via the API.
create or replace function public.protect_privileged_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    new.role := old.role;
    new.account_status := old.account_status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_fields on public.profiles;
create trigger trg_protect_profile_fields
  before update on public.profiles
  for each row execute function public.protect_privileged_profile_fields();

-- =========================================================
-- CHARACTERS
-- =========================================================
alter table public.characters enable row level security;

create policy "characters_select_any_logged_in"
  on public.characters for select
  using (auth.uid() is not null);

create policy "characters_insert_own"
  on public.characters for insert
  with check (auth.uid() = user_id);

create policy "characters_update_own"
  on public.characters for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =========================================================
-- GAME_ROOMS
-- =========================================================
alter table public.game_rooms enable row level security;

create policy "rooms_select_any_logged_in"
  on public.game_rooms for select
  using (auth.uid() is not null);

create policy "rooms_insert_as_host"
  on public.game_rooms for insert
  with check (auth.uid() = host_id);

create policy "rooms_update_host_or_admin"
  on public.game_rooms for update
  using (auth.uid() = host_id or public.is_admin())
  with check (auth.uid() = host_id or public.is_admin());

create policy "rooms_delete_host_or_admin"
  on public.game_rooms for delete
  using (auth.uid() = host_id or public.is_admin());

-- =========================================================
-- ROOM_PLAYERS
-- =========================================================
alter table public.room_players enable row level security;

create policy "room_players_select_any_logged_in"
  on public.room_players for select
  using (auth.uid() is not null);

create policy "room_players_insert_self"
  on public.room_players for insert
  with check (auth.uid() = user_id);

create policy "room_players_update_self_or_admin"
  on public.room_players for update
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

create policy "room_players_delete_self_or_admin"
  on public.room_players for delete
  using (auth.uid() = user_id or public.is_admin());

-- =========================================================
-- GAME_ROUNDS
-- =========================================================
alter table public.game_rounds enable row level security;

create policy "rounds_select_any_logged_in"
  on public.game_rounds for select
  using (auth.uid() is not null);

create policy "rounds_insert_host_or_admin"
  on public.game_rounds for insert
  with check (
    public.is_admin() or
    exists (
      select 1 from public.game_rooms gr
      where gr.id = room_id and gr.host_id = auth.uid()
    )
  );

create policy "rounds_update_host_or_admin"
  on public.game_rounds for update
  using (
    public.is_admin() or
    exists (
      select 1 from public.game_rooms gr
      where gr.id = room_id and gr.host_id = auth.uid()
    )
  );

-- =========================================================
-- PLAYER_SCORES
-- Every player writes ONLY their own score row. This keeps
-- policies simple: kills are credited by the attacker's own
-- client, deaths by the victim's own client.
-- =========================================================
alter table public.player_scores enable row level security;

create policy "scores_select_any_logged_in"
  on public.player_scores for select
  using (auth.uid() is not null);

create policy "scores_insert_own"
  on public.player_scores for insert
  with check (auth.uid() = user_id);

create policy "scores_update_own"
  on public.player_scores for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =========================================================
-- GAME_RESULTS
-- =========================================================
alter table public.game_results enable row level security;

create policy "results_select_any_logged_in"
  on public.game_results for select
  using (auth.uid() is not null);

create policy "results_insert_host_or_admin"
  on public.game_results for insert
  with check (
    public.is_admin() or
    exists (
      select 1 from public.game_rooms gr
      where gr.id = room_id and gr.host_id = auth.uid()
    )
  );

-- =========================================================
-- MESSAGES (chat) — only room members can read/write
-- =========================================================
alter table public.messages enable row level security;

create policy "messages_select_room_members_or_admin"
  on public.messages for select
  using (
    public.is_admin() or
    exists (
      select 1 from public.room_players rp
      where rp.room_id = messages.room_id and rp.user_id = auth.uid()
    )
  );

create policy "messages_insert_room_members"
  on public.messages for insert
  with check (
    auth.uid() = user_id and
    exists (
      select 1 from public.room_players rp
      where rp.room_id = messages.room_id and rp.user_id = auth.uid()
    )
  );

-- Soft-delete only: users can mark their own message deleted=true,
-- admins can also moderate any message.
create policy "messages_update_own_or_admin"
  on public.messages for update
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

create policy "messages_delete_admin_only"
  on public.messages for delete
  using (public.is_admin());

-- =========================================================
-- REPORTS
-- =========================================================
alter table public.reports enable row level security;

create policy "reports_select_own_or_admin"
  on public.reports for select
  using (auth.uid() = reporter_id or public.is_admin());

create policy "reports_insert_own"
  on public.reports for insert
  with check (auth.uid() = reporter_id);

create policy "reports_update_admin_only"
  on public.reports for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "reports_delete_admin_only"
  on public.reports for delete
  using (public.is_admin());

-- =========================================================
-- ENABLE REALTIME on the tables we need live updates from
-- (Lobby player list, room status changes, chat messages).
-- Game movement/bombs/explosions will use Broadcast channels
-- instead of the database — configured later in realtime.js.
-- =========================================================
alter publication supabase_realtime add table public.room_players;
alter publication supabase_realtime add table public.game_rooms;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.player_scores;
