-- Reminders: web push subscriptions, morning digest and event reminders.
-- Run after 003. Both tables are written only by the server (service-role key); RLS is on with no policies,
-- so the browser (anon key) cannot read or change them.

-- One row per person: when they want the morning digest and a small snapshot of the next few days that the app
-- uploads whenever the plan changes (Big 3, tasks, events). The server never needs the full plan.
create table if not exists reminder_profiles (
  email text primary key check (email = lower(email)),
  tz text not null default 'UTC',
  digest_time text not null default '08:30' check (digest_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  digest_push boolean not null default false,
  digest_email boolean not null default false,
  lead_min integer not null default 10 check (lead_min between 0 and 120),     -- minutes before an event; 0 = no event reminders
  snapshot jsonb not null default '{}'::jsonb,                                  -- { days: {date: {big3, tasks, events}}, upcoming: [{id, at, text}] }
  sent jsonb not null default '[]'::jsonb,                                      -- upcoming ids already reminded
  last_digest date,                                                             -- local date of the last digest, so it sends once a day
  updated_at timestamptz not null default now()
);
alter table reminder_profiles enable row level security;

-- One row per browser/device that allowed push.
create table if not exists push_subscriptions (
  endpoint text primary key,
  email text not null check (email = lower(email)),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_email_idx on push_subscriptions (email);
alter table push_subscriptions enable row level security;
