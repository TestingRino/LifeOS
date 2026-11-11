-- Life.OS: one private row per user holding their whole plan as JSON.
-- Users live in Supabase Auth (auth.users); this table only stores the plan.

create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id)
);

alter table plans enable row level security;

create policy "Users can read own plan"   on plans for select using (auth.uid() = user_id);
create policy "Users can insert own plan" on plans for insert with check (auth.uid() = user_id);
create policy "Users can update own plan" on plans for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own plan" on plans for delete using (auth.uid() = user_id);

create index if not exists idx_plans_user_id on plans(user_id);

-- updated_at doubles as the "version" the app checks before overwriting (optimistic concurrency),
-- so it must change on every write.
create or replace function update_updated_at() returns trigger as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$ language plpgsql;

create trigger plans_updated_at before update on plans
  for each row execute function update_updated_at();
