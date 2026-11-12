-- Photo import waitlist: anyone can add themselves; nobody can read it through the API.
-- You read it in the Supabase dashboard (Table editor) or with the service-role key.
create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null check (length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  planner text not null default '' check (length(planner) <= 20),
  other text not null default '' check (length(other) <= 60),
  source text not null default '' check (length(source) <= 20),
  created_at timestamptz not null default now()
);
create unique index if not exists waitlist_email_key on waitlist (lower(email));

alter table waitlist enable row level security;
create policy "Anyone can join the waitlist" on waitlist for insert to anon, authenticated with check (true);
-- no select, update or delete policies: the public key can only add rows
