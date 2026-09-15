-- =========================================================
-- BOMB ARENA — 03_functions.sql
-- Run this AFTER 01_schema.sql and 02_rls_policies.sql.
-- This file will keep growing in later phases (room codes,
-- scoring helpers, etc.) — always safe to re-run in full.
-- =========================================================

-- ---------------------------------------------------------
-- is_username_taken()
-- Lets the REGISTER page check username availability BEFORE
-- calling auth.signUp(), even though the caller isn't logged
-- in yet (anon role). security definer bypasses the normal
-- "only see your own profile" RLS rule, but this function
-- only ever returns true/false — no actual data is exposed.
-- ---------------------------------------------------------
create or replace function public.is_username_taken(check_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where lower(username) = lower(check_username)
  );
$$;

grant execute on function public.is_username_taken(text) to anon, authenticated;

-- ---------------------------------------------------------
-- AVATAR STORAGE BUCKET
-- Public bucket (so <img> tags can load avatars directly),
-- but uploads/updates/deletes are restricted to the owner's
-- own folder: avatars/{user_id}/filename.ext
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatar_public_read" on storage.objects;
create policy "avatar_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatar_upload_own_folder" on storage.objects;
create policy "avatar_upload_own_folder"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatar_update_own_folder" on storage.objects;
create policy "avatar_update_own_folder"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatar_delete_own_folder" on storage.objects;
create policy "avatar_delete_own_folder"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------
-- increment_profile_stats()
-- Called by each player's OWN client at the end of a round to
-- add that round's kills/deaths (and a win, if applicable) to
-- their lifetime profile totals. security invoker (default) is
-- fine here: it only ever touches auth.uid()'s own row, which
-- the existing profiles RLS policy already allows.
-- Doing this as one atomic UPDATE avoids a read-then-write race
-- if a player is somehow in two finalizing rounds at once.
-- ---------------------------------------------------------
create or replace function public.increment_profile_stats(p_kills int, p_deaths int, p_won boolean)
returns void
language plpgsql
as $$
begin
  update public.profiles
  set total_kills = total_kills + p_kills,
      total_deaths = total_deaths + p_deaths,
      total_wins = total_wins + case when p_won then 1 else 0 end,
      last_active = now()
  where id = auth.uid();
end;
$$;

grant execute on function public.increment_profile_stats(int, int, boolean) to authenticated;

-- ---------------------------------------------------------
-- Basic profanity filter (server-side safety net).
-- The chat UI also filters client-side for instant feedback,
-- but this trigger guarantees filtering even if someone calls
-- the API directly, bypassing the frontend entirely.
-- This is a SMALL starter list — expand it as needed.
-- ---------------------------------------------------------
create or replace function public.filter_profanity()
returns trigger
language plpgsql
as $$
declare
  bad_words text[] := array['damn', 'hell', 'stupid', 'idiot']; -- starter list, expand as needed
  word text;
  cleaned text;
begin
  cleaned := new.message;
  foreach word in array bad_words loop
    cleaned := regexp_replace(cleaned, word, repeat('*', length(word)), 'gi');
  end loop;
  new.message := cleaned;
  return new;
end;
$$;

drop trigger if exists trg_filter_profanity on public.messages;
create trigger trg_filter_profanity
  before insert on public.messages
  for each row execute function public.filter_profanity();

-- ---------------------------------------------------------
-- UPDATED: protect_privileged_profile_fields()
-- Redefines the trigger from 02_rls_policies.sql so that
-- direct SQL Editor / service-role changes (where auth.uid()
-- is NULL, meaning there's no logged-in API caller at all)
-- are allowed through. This is what lets YOU bootstrap your
-- first admin account by running a plain UPDATE in the SQL
-- Editor. Normal API calls always have a real auth.uid(), so
-- non-admin users still cannot self-promote — this only opens
-- the door for direct, trusted database access.
-- ---------------------------------------------------------
create or replace function public.protect_privileged_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role := old.role;
    new.account_status := old.account_status;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------
-- UPDATED: public_profiles view — now also exposes win/kill/
-- death totals (not sensitive) so the leaderboard page can
-- rank all players without needing raw profiles table access.
-- ---------------------------------------------------------
create or replace view public.public_profiles as
  select id, username, avatar_url, created_at, total_wins, total_kills, total_deaths
  from public.profiles;

grant select on public.public_profiles to authenticated;
