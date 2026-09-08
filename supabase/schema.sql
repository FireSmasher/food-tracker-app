-- Saulog OS (Kain + Buhat) shared database schema.
--
-- Run this once in the Supabase SQL editor for a fresh project (Project -> SQL Editor ->
-- New query -> paste -> Run). See HANDOFF.md "Setup: Supabase" for the surrounding steps.
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

create index if not exists food_logs_user_date_idx on public.food_logs (user_id, date);
create index if not exists workout_logs_user_date_idx on public.workout_logs (user_id, date);

alter table public.food_logs enable row level security;
alter table public.workout_logs enable row level security;

-- Each user (in practice: just Edwin) can only ever see or touch their own rows.
create policy "food_logs: owner select" on public.food_logs
  for select using (auth.uid() = user_id);
create policy "food_logs: owner insert" on public.food_logs
  for insert with check (auth.uid() = user_id);
create policy "food_logs: owner update" on public.food_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "food_logs: owner delete" on public.food_logs
  for delete using (auth.uid() = user_id);

create policy "workout_logs: owner select" on public.workout_logs
  for select using (auth.uid() = user_id);
create policy "workout_logs: owner insert" on public.workout_logs
  for insert with check (auth.uid() = user_id);
create policy "workout_logs: owner update" on public.workout_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "workout_logs: owner delete" on public.workout_logs
  for delete using (auth.uid() = user_id);

-- RLS restricts access, it doesn't grant it — a role still needs the baseline table-level
-- privilege before Postgres even evaluates a policy. If "Automatically expose new tables"
-- is off at project creation (the recommended setting, see HANDOFF.md), these grants are
-- NOT applied automatically and both the app (authenticated) and Nippard/Sevro's read
-- script (service_role) get a bare 42501 permission-denied without them.
grant select, insert, update, delete on public.food_logs to authenticated, service_role;
grant select, insert, update, delete on public.workout_logs to authenticated, service_role;

-- Nippard/Sevro read access goes through scripts/query-logs.py using the service_role key,
-- which bypasses RLS by design (it's a trusted server-side key, never shipped in this repo).
-- No separate policy is needed for that path.
