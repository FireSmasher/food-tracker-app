-- Saulog OS (Kain + Buhat) shared database schema.
--
-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query -> paste -> Run).
-- See HANDOFF.md "Setup: Supabase" for the surrounding steps.
--
-- Safe to re-run against a project that's already partly set up: tables and indexes are
-- `if not exists`, and every policy is preceded by a `drop policy if exists` because Postgres
-- has no `create policy if not exists` (a plain re-run died with 42710 "policy already
-- exists" on 2026-09-09 when the newer tables were added to an existing project).
--
-- Security model: this app is a public GitHub repo, so the anon key embedded in config.js is
-- readable by anyone. That is fine BY DESIGN as long as these Row Level Security policies are
-- in place — they mean the anon key alone can never read or write a row, only a request
-- carrying a valid logged-in session (auth.uid()) for a row it actually owns can. Do not
-- disable RLS on these tables, and do not add a policy that allows anon/public access.

create table if not exists public.food_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  time text not null,
  name text not null,
  grams numeric not null,
  quantity text,
  notes text,
  kcal numeric not null,
  protein numeric not null,
  carb numeric not null,
  fat numeric not null,
  is_restaurant boolean not null default false,
  item_type text,
  item_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  time text not null,
  split text not null,
  exercise text not null,
  muscle text,
  sets jsonb not null,
  notes text,
  created_at timestamptz not null default now()
);

-- Nippard -> Kain direction of the targets sync (added 2026-09-08). One row per user,
-- written ONLY by scripts/push-targets.py using the service_role key — there is
-- deliberately no insert/update/delete policy for `authenticated` below, so the app
-- itself can only ever read this table, never write it. That's the whole point: targets
-- flow from Nippard into the app, not the other way around.
create table if not exists public.targets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  kcal numeric not null,
  protein numeric not null,
  fat numeric not null,
  carb numeric not null,
  updated_at timestamptz not null default now()
);

-- Quarters (added 2026-09-09): the 15-min time tracker, rebuilt as a Saulog OS tab
-- alongside Kain/Buhat instead of living only in its old Claude Artifact db. Fresh
-- start per Edwin's call -- pre-migration days stay archived in the old Artifact,
-- not backfilled here. One row per 15-min slot (96/day), `time` in HH:MM 24h.
create table if not exists public.quarters_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  time text not null,
  label text not null,
  category text not null default 'unsorted',
  confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, date, time)
);

-- Body weight (added 2026-09-09): one entry per day, the real outcome measure for the
-- recomp goal that food/workout/time logs don't otherwise connect to. Lives in Buhat.
create table if not exists public.weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  kg numeric not null,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

-- Apple Health metrics (added 2026-09-09), written by an iOS Shortcut Edwin runs on his
-- phone (Safari/a PWA can never read HealthKit directly -- this is the only real bridge).
-- One row per day; a Shortcut run upserts (PATCH on conflict) rather than inserting blind,
-- so re-running it the same day just updates today's numbers.
create table if not exists public.health_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  steps integer,
  sleep_hours numeric,
  active_energy_kcal numeric,
  exercise_minutes numeric,
  workout_type text,
  resting_hr numeric,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

-- Added 2026-09-09, after health_logs already existed in the live project: `create table
-- if not exists` above is a no-op there, so new columns need explicit alters. Edwin picked
-- these four when Strava fell through and Apple Health/Fitness became the only body-data
-- source. Nothing sums active_energy_kcal against Kain's food totals -- his kcal target is
-- a fixed Nippard number, so this is informational, not a TDEE adjustment.
alter table public.health_logs add column if not exists active_energy_kcal numeric;
alter table public.health_logs add column if not exists exercise_minutes numeric;
alter table public.health_logs add column if not exists workout_type text;
alter table public.health_logs add column if not exists resting_hr numeric;

create index if not exists food_logs_user_date_idx on public.food_logs (user_id, date);
create index if not exists workout_logs_user_date_idx on public.workout_logs (user_id, date);
create index if not exists quarters_logs_user_date_idx on public.quarters_logs (user_id, date);
create index if not exists weight_logs_user_date_idx on public.weight_logs (user_id, date);
-- Strava (added 2026-09-09): pulled in by scripts/sync_strava.py using a refresh token
-- Edwin generates himself (see docs/strava-setup.md), not written by the app itself. One
-- row per Strava activity, kept separate from workout_logs (different shape -- distance/
-- pace/elevation, not sets/reps) so Buhat's own strength/cardio logging is untouched.
create table if not exists public.strava_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  strava_id bigint not null,
  date date not null,
  name text,
  type text,
  distance_km numeric,
  moving_time_min numeric,
  elevation_m numeric,
  avg_hr numeric,
  created_at timestamptz not null default now(),
  unique (user_id, strava_id)
);

create index if not exists health_logs_user_date_idx on public.health_logs (user_id, date);
create index if not exists strava_activities_user_date_idx on public.strava_activities (user_id, date);

alter table public.food_logs enable row level security;
alter table public.workout_logs enable row level security;
alter table public.targets enable row level security;
alter table public.quarters_logs enable row level security;
alter table public.weight_logs enable row level security;
alter table public.health_logs enable row level security;
alter table public.strava_activities enable row level security;

-- Each user (in practice: just Edwin) can only ever see or touch their own rows.
drop policy if exists "food_logs: owner select" on public.food_logs;
create policy "food_logs: owner select" on public.food_logs
  for select using (auth.uid() = user_id);
drop policy if exists "food_logs: owner insert" on public.food_logs;
create policy "food_logs: owner insert" on public.food_logs
  for insert with check (auth.uid() = user_id);
drop policy if exists "food_logs: owner update" on public.food_logs;
create policy "food_logs: owner update" on public.food_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "food_logs: owner delete" on public.food_logs;
create policy "food_logs: owner delete" on public.food_logs
  for delete using (auth.uid() = user_id);

drop policy if exists "workout_logs: owner select" on public.workout_logs;
create policy "workout_logs: owner select" on public.workout_logs
  for select using (auth.uid() = user_id);
drop policy if exists "workout_logs: owner insert" on public.workout_logs;
create policy "workout_logs: owner insert" on public.workout_logs
  for insert with check (auth.uid() = user_id);
drop policy if exists "workout_logs: owner update" on public.workout_logs;
create policy "workout_logs: owner update" on public.workout_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "workout_logs: owner delete" on public.workout_logs;
create policy "workout_logs: owner delete" on public.workout_logs
  for delete using (auth.uid() = user_id);

-- Read-only for the signed-in owner; no insert/update/delete policy exists for
-- `authenticated` on purpose (see comment on the table above).
drop policy if exists "targets: owner select" on public.targets;
create policy "targets: owner select" on public.targets
  for select using (auth.uid() = user_id);

drop policy if exists "quarters_logs: owner select" on public.quarters_logs;
create policy "quarters_logs: owner select" on public.quarters_logs
  for select using (auth.uid() = user_id);
drop policy if exists "quarters_logs: owner insert" on public.quarters_logs;
create policy "quarters_logs: owner insert" on public.quarters_logs
  for insert with check (auth.uid() = user_id);
drop policy if exists "quarters_logs: owner update" on public.quarters_logs;
create policy "quarters_logs: owner update" on public.quarters_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "quarters_logs: owner delete" on public.quarters_logs;
create policy "quarters_logs: owner delete" on public.quarters_logs
  for delete using (auth.uid() = user_id);

drop policy if exists "weight_logs: owner select" on public.weight_logs;
create policy "weight_logs: owner select" on public.weight_logs
  for select using (auth.uid() = user_id);
drop policy if exists "weight_logs: owner insert" on public.weight_logs;
create policy "weight_logs: owner insert" on public.weight_logs
  for insert with check (auth.uid() = user_id);
drop policy if exists "weight_logs: owner update" on public.weight_logs;
create policy "weight_logs: owner update" on public.weight_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "weight_logs: owner delete" on public.weight_logs;
create policy "weight_logs: owner delete" on public.weight_logs
  for delete using (auth.uid() = user_id);

drop policy if exists "health_logs: owner select" on public.health_logs;
create policy "health_logs: owner select" on public.health_logs
  for select using (auth.uid() = user_id);
drop policy if exists "health_logs: owner insert" on public.health_logs;
create policy "health_logs: owner insert" on public.health_logs
  for insert with check (auth.uid() = user_id);
drop policy if exists "health_logs: owner update" on public.health_logs;
create policy "health_logs: owner update" on public.health_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "health_logs: owner delete" on public.health_logs;
create policy "health_logs: owner delete" on public.health_logs
  for delete using (auth.uid() = user_id);

drop policy if exists "strava_activities: owner select" on public.strava_activities;
create policy "strava_activities: owner select" on public.strava_activities
  for select using (auth.uid() = user_id);
drop policy if exists "strava_activities: owner insert" on public.strava_activities;
create policy "strava_activities: owner insert" on public.strava_activities
  for insert with check (auth.uid() = user_id);
drop policy if exists "strava_activities: owner update" on public.strava_activities;
create policy "strava_activities: owner update" on public.strava_activities
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "strava_activities: owner delete" on public.strava_activities;
create policy "strava_activities: owner delete" on public.strava_activities
  for delete using (auth.uid() = user_id);

-- RLS restricts access, it doesn't grant it — a role still needs the baseline table-level
-- privilege before Postgres even evaluates a policy. If "Automatically expose new tables"
-- is off at project creation (the recommended setting, see HANDOFF.md), these grants are
-- NOT applied automatically and both the app (authenticated) and Nippard/Sevro's read
-- script (service_role) get a bare 42501 permission-denied without them.
grant select, insert, update, delete on public.food_logs to authenticated, service_role;
grant select, insert, update, delete on public.workout_logs to authenticated, service_role;
grant select on public.targets to authenticated;
grant select, insert, update, delete on public.targets to service_role;
grant select, insert, update, delete on public.quarters_logs to authenticated, service_role;
grant select, insert, update, delete on public.weight_logs to authenticated, service_role;
grant select, insert, update, delete on public.health_logs to authenticated, service_role;
-- strava_activities is written only by scripts/sync_strava.py (service_role) but read by the
-- app itself (authenticated) for the in-app Strava view, so both roles need it -- same missed-
-- grant bug flagged above almost shipped here too.
grant select, insert, update, delete on public.strava_activities to service_role;
grant select on public.strava_activities to authenticated;

-- Nippard/Sevro read access goes through scripts/query-logs.py using the service_role key,
-- which bypasses RLS by design (it's a trusted server-side key, never shipped in this repo).
-- No separate policy is needed for that path.
