-- Admin, licensing and limits.
-- Run after 001 and 002. The browser (anon key) can only read its own entitlement row; everything
-- else is written by the server with the service-role key, or by you in the dashboard.

-- Who is an admin. Add yourself once, in the SQL editor:
--   insert into admins (user_id) select id from auth.users where email = 'you@example.com';
create table if not exists admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table admins enable row level security;
create policy "Admins can see themselves" on admins for select using (auth.uid() = user_id);

create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from admins where user_id = auth.uid()) $$;

-- One row per person with a tier and any per-person overrides. Keyed by lower-case email so it also works
-- for people who signed in the older Google way.
create table if not exists entitlements (
  email text primary key check (email = lower(email)),
  user_id uuid references auth.users(id) on delete set null,
  tier text not null default 'free' check (tier in ('free', 'plus')),
  ocr boolean,                          -- null = follow the tier, true/false = override
  ocr_hourly integer check (ocr_hourly is null or ocr_hourly >= 0),
  ocr_daily integer check (ocr_daily is null or ocr_daily >= 0),
  status text not null default 'active' check (status in ('active', 'suspended', 'canceled', 'past_due')),
  source text not null default 'admin' check (source in ('admin', 'waitlist', 'stripe')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  notes text not null default '' check (length(notes) <= 500),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table entitlements enable row level security;
create policy "People can read their own entitlement" on entitlements for select using (lower(auth.jwt() ->> 'email') = email);
create policy "Admins can read all entitlements" on entitlements for select using (is_admin());
create policy "Admins can edit entitlements" on entitlements for all using (is_admin()) with check (is_admin());

-- Settings that apply to everyone (tier defaults, kill switches). Admin-editable.
create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
create policy "Admins can read settings" on app_settings for select using (is_admin());
create policy "Admins can edit settings" on app_settings for all using (is_admin()) with check (is_admin());
insert into app_settings (key, value) values
  ('tiers', '{"free": {"ocr": false, "ocr_hourly": 0, "ocr_daily": 0}, "plus": {"ocr": true, "ocr_hourly": 20, "ocr_daily": 60}}'),
  ('flags', '{"ocr_enabled": true, "waitlist_open": true}')
on conflict (key) do nothing;

-- Photo import usage per person per day (written by the server).
create table if not exists usage_daily (
  email text not null,
  day date not null,
  ocr_count integer not null default 0,
  primary key (email, day)
);
alter table usage_daily enable row level security;
create policy "Admins can read usage" on usage_daily for select using (is_admin());
create or replace function increment_usage(p_email text, p_day date) returns void
  language sql security definer set search_path = public
  as $$ insert into usage_daily (email, day, ocr_count) values (lower(p_email), p_day, 1)
        on conflict (email, day) do update set ocr_count = usage_daily.ocr_count + 1 $$;
revoke all on function increment_usage(text, date) from public, anon, authenticated;

-- Waitlist: approval state (the table itself is created in 002).
alter table waitlist add column if not exists status text not null default 'new' check (status in ('new', 'approved', 'declined'));
alter table waitlist add column if not exists decided_at timestamptz;
create policy "Admins can read the waitlist" on waitlist for select using (is_admin());
create policy "Admins can update the waitlist" on waitlist for update using (is_admin()) with check (is_admin());

create or replace function touch_entitlement() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger entitlements_touch before update on entitlements for each row execute function touch_entitlement();
