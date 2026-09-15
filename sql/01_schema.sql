-- =========================================================
-- BOMB ARENA — 01_schema.sql
-- Run this ONCE in Supabase SQL Editor (Project > SQL Editor > New query)
-- =========================================================

create extension if not exists pgcrypto; -- gives us gen_random_uuid()

-- =========================================================
-- 1. PROFILES
-- One row per registered user. Created automatically when
-- someone signs up (see trigger at the bottom of this file).
-- =========================================================
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  username        text unique not null,
  full_name       text not null,
  email           text not null,
  avatar_url      text default null,
  role            text not null default 'user' check (role in ('user', 'admin')),
  account_status  text not null default 'active' check (account_status in ('active', 'disabled')),
  total_wins      int not null default 0,
  total_kills     int not null default 0,
  total_deaths    int not null default 0,
  created_at      timestamptz not null default now(),
  last_active     timestamptz not null default now()
);

create index if not exists idx_profiles_username on public.profiles (username);
create index if not exists idx_profiles_role on public.profiles (role);

-- =========================================================
-- 2. CHARACTERS
-- One customized character per user.
-- =========================================================
create table if not exists public.characters (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique references public.profiles(id) on delete cascade,
  body          text not null default 'body_1',
  body_color    text not null default '#f1c27d',
  hair          text not null default 'hair_1',
  hair_color    text not null default '#2b1b0e',
  shirt         text not null default 'shirt_1',
  shirt_color   text not null default '#3498db',
  pants         text not null default 'pants_1',
  pants_color   text not null default '#2c3e50',
  shoes         text not null default 'shoes_1',
  shoes_color   text not null default '#111111',
  accessory     text not null default 'none',
  updated_at    timestamptz not null default now()
);

create index if not exists idx_characters_user_id on public.characters (user_id);

-- =========================================================
-- 3. GAME_ROOMS
-- =========================================================
create table if not exists public.game_rooms (
  id                      uuid primary key default gen_random_uuid(),
  room_code               text unique not null,
  room_name               text not null,
  host_id                 uuid not null references public.profiles(id) on delete cascade,
  player_limit            int not null check (player_limit between 2 and 10),
  map                     text not null default 'arena1' check (map in ('arena1', 'arena2', 'arena3')),
  round_duration_seconds  int not null default 300 check (round_duration_seconds in (180, 300, 600)),
  status                  text not null default 'waiting' check (status in ('waiting', 'starting', 'playing', 'finished')),
  current_round_id        uuid default null, -- filled in once game_rounds exists (see fk added below)
  created_at              timestamptz not null default now(),
  started_at              timestamptz,
  ended_at                timestamptz
);

create index if not exists idx_game_rooms_room_code on public.game_rooms (room_code);
create index if not exists idx_game_rooms_status on public.game_rooms (status);
create index if not exists idx_game_rooms_host_id on public.game_rooms (host_id);

-- =========================================================
-- 4. ROOM_PLAYERS
-- Who is in which room, ready status, host flag.
-- =========================================================
create table if not exists public.room_players (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.game_rooms(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  is_ready    boolean not null default false,
  is_host     boolean not null default false,
  joined_at   timestamptz not null default now(),
  left_at     timestamptz,
  unique (room_id, user_id)
);

create index if not exists idx_room_players_room_id on public.room_players (room_id);
create index if not exists idx_room_players_user_id on public.room_players (user_id);

-- =========================================================
-- 5. GAME_ROUNDS
-- A single "round" of play inside a room.
-- =========================================================
create table if not exists public.game_rounds (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.game_rooms(id) on delete cascade,
  round_number  int not null default 1,
  map           text not null,
  status        text not null default 'active' check (status in ('active', 'finished')),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz
);

create index if not exists idx_game_rounds_room_id on public.game_rounds (room_id);

-- now that game_rounds exists, link game_rooms.current_round_id to it
alter table public.game_rooms
  add constraint fk_current_round
  foreign key (current_round_id) references public.game_rounds(id) on delete set null;

-- =========================================================
-- 6. PLAYER_SCORES
-- Each player's stats for a specific round.
-- =========================================================
create table if not exists public.player_scores (
  id                uuid primary key default gen_random_uuid(),
  round_id          uuid not null references public.game_rounds(id) on delete cascade,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  kills             int not null default 0,
  deaths            int not null default 0,
  bombs_picked_up   int not null default 0,
  bombs_thrown      int not null default 0,
  hits              int not null default 0,
  score             int not null default 0,
  updated_at        timestamptz not null default now(),
  unique (round_id, user_id)
);

create index if not exists idx_player_scores_round_id on public.player_scores (round_id);

-- =========================================================
-- 7. GAME_RESULTS
-- Final snapshot of a finished round (winner + full leaderboard).
-- =========================================================
create table if not exists public.game_results (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null unique references public.game_rounds(id) on delete cascade,
  room_id     uuid not null references public.game_rooms(id) on delete cascade,
  winner_id   uuid references public.profiles(id),
  leaderboard jsonb not null default '[]', -- sorted array snapshot: [{user_id, username, kills, deaths, score}, ...]
  created_at  timestamptz not null default now()
);

create index if not exists idx_game_results_room_id on public.game_results (room_id);

-- =========================================================
-- 8. MESSAGES (chat)
-- =========================================================
create table if not exists public.messages (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.game_rooms(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  message       text not null check (char_length(message) > 0 and char_length(message) <= 500),
  message_type  text not null default 'chat' check (message_type in ('chat', 'system')),
  deleted       boolean not null default false,
  edited        boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists idx_messages_room_id_created_at on public.messages (room_id, created_at);

-- =========================================================
-- 9. REPORTS
-- =========================================================
create table if not exists public.reports (
  id                 uuid primary key default gen_random_uuid(),
  reporter_id        uuid not null references public.profiles(id) on delete cascade,
  reported_user_id   uuid references public.profiles(id) on delete cascade,
  room_id            uuid references public.game_rooms(id) on delete set null,
  message_id         uuid references public.messages(id) on delete set null,
  reason             text not null check (char_length(reason) > 0),
  status             text not null default 'pending' check (status in ('pending', 'reviewed', 'resolved')),
  created_at         timestamptz not null default now()
);

create index if not exists idx_reports_status on public.reports (status);

-- =========================================================
-- AUTO-CREATE PROFILE + CHARACTER ON SIGNUP
-- When a new user signs up via Supabase Auth, this trigger
-- automatically creates their profiles row and a default
-- characters row, using metadata passed at signup time.
-- =========================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'full_name', 'Player'),
    new.email
  );

  insert into public.characters (user_id) values (new.id);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================
-- KEEP updated_at / last_active FRESH
-- =========================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_characters_updated_at on public.characters;
create trigger trg_characters_updated_at
  before update on public.characters
  for each row execute function public.set_updated_at();
