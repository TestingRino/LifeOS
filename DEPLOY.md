# Deploying Telos

One document for everything. Telos is a static website plus an optional small backend:

```
Browser (GitHub Pages)            Supabase (optional, accounts)          Vercel backend (optional)
  index.html + js/*  ───────────▶  Auth: Google, Apple, email   ◀─────   /api/calendar   Google Calendar overlay
  localStorage (offline cache)     Postgres: one private row per user    /api/ocr        photo import (allow-listed users)
                                   Edge function: delete-user            /api/events     anonymous funnel events
```

- **Without any backend** the app works fully on one device (data in the browser).
- **With Supabase** people sign in with Google, Apple or email, and their plan follows them to any device.
- **Without Supabase** but with the Vercel backend, the older Google sign-in with a copy in the user's Drive still works.
- The Vercel backend is only needed for the Google Calendar overlay, photo import, and first-party analytics.

## 1. The website (GitHub Pages)

1. Push to `main`; Pages serves the repo root at `https://<user>.github.io/LifeOS/`.
2. Before committing changes to `css/` or `js/`, run `npm run stamp`. It versions the asset links and the service worker so browsers never mix old scripts with a new page.
3. `js/config.js` holds all public settings (see below). It is safe to publish.

## 2. Accounts and cloud copy (Supabase)

1. Create a project at supabase.com. Note the **Project URL** and the **anon** key (Settings → API).
2. SQL editor: run `supabase/migrations/001_create_plans.sql`. It creates the `plans` table, Row Level Security (each user can touch only their own row) and the `updated_at` trigger the app uses as its version check.
3. Authentication → Providers:
   - **Google**: enable; paste your Google Cloud OAuth client ID and secret; add Supabase's callback URL to the client's authorised redirect URIs.
   - **Email**: enabled by default; turn on "Confirm email" for production.
   - **Apple** (optional, $99/yr Apple Developer account; required later for the App Store): enable and add the Services ID and key.
   - Authentication → URL Configuration: set **Site URL** and add `https://<user>.github.io/LifeOS/` to the redirect allow-list.
4. Deploy the delete-account function (the browser cannot delete an auth user by itself):
   ```bash
   supabase functions deploy delete-user
   supabase secrets set ALLOWED_ORIGIN=https://<user>.github.io
   ```
5. Fill in `js/config.js`:
   ```js
   window.LIFEOS_CONFIG = { supabaseUrl: 'https://xxxx.supabase.co', supabaseAnonKey: 'eyJ...', posthogKey: '', posthogHost: 'https://us.i.posthog.com', identifyEmail: false };
   ```
   Run `npm run stamp`, commit and push. The login dialog now offers Google, Apple and email.

How sync works: the app keeps saving to the browser first (offline works). When signed in it copies the plan to the account about a second after each change, and checks the account on load and when the tab regains focus. It only overwrites the version it last saw; if another device wrote first, it pulls, merges (deleted items stay deleted) and tries again, so nothing is lost.

## 3. The backend (Vercel): Calendar, photo import, events

Deploy the repo to Vercel (`vercel.json` routes everything to `api/index.mjs`, which loads `server/app.js`). Environment variables:

| Variable | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google Calendar connection (and the older Google sign-in). Redirect URI is the website URL, e.g. `https://<user>.github.io/LifeOS/` |
| `ANTHROPIC_API_KEY` | Photo import |
| `OCR_ALLOWED_EMAILS` | Comma-separated accounts allowed to use photo import (`*` = everyone signed in). Empty = closed to all |
| `OCR_HOURLY_LIMIT`, `OCR_DAILY_LIMIT` | Per-user photo import caps (defaults 20 and 60) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Lets photo import accept Supabase session tokens |
| `ALLOWED_ORIGINS` | Sites allowed to call the API from a browser (default: the GitHub Pages site and localhost) |
| `ANALYTICS_WEBHOOK_URL` | Optional: forward first-party funnel events to a webhook |
| `WAITLIST_WEBHOOK_URL` | Optional: forward photo-import waitlist sign-ups (email + planner brand) to a webhook, e.g. a Google Sheet script. They are always written to the Vercel log too, as `{"waitlist": {...}}` |

Google Cloud Console (APIs & Services): enable the **Google Calendar API** (and **Drive API** only if you keep the older Drive mode). Add the website URL as an authorised redirect URI. The OAuth consent screen needs the privacy policy URL (`https://<user>.github.io/LifeOS/privacy.html`) before verification. The app asks for calendar *read-only* by default and for *create events* only when someone uses a feature that adds events.

Local backend: `cd server && cp .env.example .env && npm install && npm start` (port 3001; the site uses it automatically on `localhost`).

## Admin, licensing and subscriptions

One admin screen (**More → Admin**, visible only to admins) shows people, the photo-import waitlist, plans and settings. Approvals take effect immediately, with no redeploy.

**Set it up (accounts mode)**
1. In Supabase run `supabase/migrations/002_waitlist.sql` and `003_admin_entitlements.sql`.
2. Vercel environment variables (server only): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, **`SUPABASE_SERVICE_ROLE_KEY`** (Supabase → Settings → API; it bypasses row-level security, so it must never go in `js/config.js` or the browser) and `ADMIN_EMAILS` (your login email, comma separated). Redeploy once.
3. Optional, so admins live in the database instead of the environment: `insert into admins (user_id) select id from auth.users where email = 'you@example.com';`
4. Sign in on the site. **More → Admin** appears for admin accounts.

**What the admin screen does**
- **Overview:** people, new this week, paid, waitlist, photo imports, and which planners people asked for.
- **Waitlist:** Approve or Decline. Approving creates an entitlement (photo import on). "Copy invite note" gives you a message to send.
- **People:** search, then Edit a person's plan (Free or Plus), status (active or suspended), a photo-import override (follow the plan, always allow, block), per-person hourly and daily limits and notes. "Grant photo import" adds an email directly.
- **Settings:** a kill switch for photo import, an on/off for the waitlist, and what each plan includes (photo import yes/no, hourly and daily limits).

**How access is decided:** `OCR_ALLOWED_EMAILS` still always allows (use it for yourself). Otherwise a person's override wins, then their plan's setting, then the global switch. A suspended person, or a Stripe subscription more than 3 days past due, loses photo import.

**Subscriptions (Stripe)**
1. In Stripe create a product and a recurring price for "Telos Plus" (you choose the price) and a webhook endpoint `https://<your-vercel-domain>/api/billing/webhook` for: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.
2. Vercel environment variables: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PLUS` (the price id), `STRIPE_WEBHOOK_SECRET`, `SITE_URL` (the website URL).
3. In `js/config.js` set `billing: true` and `plusPrice: '$X/month'`, run `npm run stamp`, push. **Settings → Your plan** now offers Upgrade (Stripe's hosted checkout) and Manage billing (Stripe's portal). The webhook updates the person's plan, and the admin screen shows it.
4. Stripe's Customer Portal must be enabled in Stripe (Settings → Billing → Customer portal). Refunds and invoices are handled in the Stripe dashboard.
5. Vercel's Hobby plan is for non-commercial use: move to Pro before charging.

## Photo import waitlist

The landing page, the demo and Today (when the schedule is empty) offer "Request an invite", which collects an email and the planner brand. Where it lands:
- **Supabase configured:** run `supabase/migrations/002_waitlist.sql`. Sign-ups go to the `waitlist` table (insert-only for the public key; read it in the dashboard). If that table is missing the app falls back to the backend.
- **Otherwise:** the Vercel backend logs each one and forwards it to `WAITLIST_WEBHOOK_URL` if set.
- **Which planners to tune first:** count rows by `planner`. The app also sends an `invite_requested` analytics event with the planner brand (never the email).
- **Granting access:** add the person's account email to `OCR_ALLOWED_EMAILS`.

## 4. Analytics

Five milestones, each sent once per person: `setup_started`, `setup_completed`, `big3_set`, `weekly_review_done`, `day7_return` (plus `landed`, `signed_in`, `first_task`). Never any plan content. Off when the browser sends Do Not Track or Global Privacy Control, or when the person switches it off in Settings.

- **PostHog** (recommended): put your project key in `js/config.js` (`posthogKey`). Events go straight to PostHog's capture endpoint; the distinct id is the account id when signed in.
- **Without PostHog**: events go to `/api/events` on the Vercel backend and are written to its logs as `{"analytics": {...}}`; set `ANALYTICS_WEBHOOK_URL` to forward them.

## 5. Before inviting real users

- [ ] Privacy policy and terms are live (`privacy.html`, `terms.html`) and the policy matches what you actually run (Supabase, PostHog)
- [ ] Google OAuth consent screen: app name, support email, privacy policy URL, scopes listed; submit for verification
- [ ] Supabase "Confirm email" is on; redirect allow-list is set
- [ ] Sign in with each provider, add a goal, sign out and back in, clear site data and sign in again: the goal returns
- [ ] Two devices: delete a task on one, edit on the other, both converge
- [ ] Settings → Delete everything removes the plan and the account
- [ ] `npm test` passes; no console errors on the landing page, Today, Week, Tasks, Settings

## 6. Moving an existing install from Google Drive sync to accounts

People who used the Drive mode keep their plan in the browser and in their Drive. After you set `supabaseUrl`, their first sign-in pushes their local plan to the new account. A plan that only lives in Drive (cleared browser) is not reachable by the new sign-in: ask them to sign in once on the old version, or use Settings → Export before the switch. When everyone has moved, the Drive code (`syncNow`, `driveFetch`, `reconcile`, the `drive.appdata` scope) and `server/routes/auth.js` can be deleted.

## Troubleshooting

- **Old page after a deploy**: Pages caches for about 10 minutes. The footer shows the build version.
- **"Failed to start login"** (older mode): the backend is not reachable; check `GOOGLE_*` variables on Vercel.
- **Sign-in returns to a blank page**: add the exact website URL to Supabase's redirect allow-list.
- **Photo import says closed**: add the account to `OCR_ALLOWED_EMAILS`.

## Telos cutover checklist (human steps, before merging the rebrand)

The product name is now **Telos**. These URL-level items still say `LifeOS` on purpose and change only after the steps below are done:

1. USPTO TESS search for TELOS in classes 9 and 42, then file an intent-to-use application.
2. Secure a domain (`telos.app`, `usetelos.com` or `gettelos.com`).
3. Rename the GitHub repo (the old URL redirects). Then update `<base href>` in `index.html`, `SITE_URL`, `GOOGLE_REDIRECT_URI`, `ALLOWED_ORIGINS`, the Supabase redirect allow-list, and the repo links in `privacy.html`, `terms.html`, README and USER_GUIDE.
4. Rename the OAuth app in Google Cloud Console.
5. Replace the placeholder artwork in `icons/` (a plain serif τ, generated for this change) with designed Telos artwork: `icon-180/192/512.png`, `favicon-16/32.png`, and the 1200×630 `social.png`.
6. After the domain exists, update the absolute URLs for link previews: `og:url`, `og:image` and `twitter:image` in `index.html`, and `homepage` in `package.json`.
7. Google OAuth consent screen (Google Cloud Console, branding): app name **Telos**, and describe the Drive access as: “Telos would like to access your Google Drive. Telos uses your Drive to store your planner data privately in your own account. We don’t see it. We don’t keep a copy. Your telos is yours.” Link the privacy policy (`/privacy`) and terms (`/terms`).
8. Set `supportEmail` in `js/config.js` so the Contact page shows an address (kept out of the repo until you choose one).
9. `#/landing` now redirects on the client to the root (`/`); GitHub Pages cannot send a real 302. If you move to a host that can, add the redirect there.
10. Claim social handles (X, Instagram, TikTok, Threads, Bluesky, Reddit, YouTube) and email existing users.

Set `USE_LEGACY_LABELS: true` in `js/config.js` to bring back the old section names (Week, Tasks, Goals, Track, Lists) for one release; remove the flag after that.

Internal identifiers (localStorage keys, Drive file names, service-worker cache names, `LIFEOS_CONFIG`) are unchanged so existing users keep their data.

## Reminders: push and email

Real reminders work even when the app is closed: a morning digest ("3 tasks for today: …"), event reminders ("Team standup in 10 minutes") and an optional morning email. They need the server, Supabase and a scheduler.

How it works: the app uploads a small snapshot of the next few days (Big 3, tasks, events, and upcoming times, never the whole plan) whenever your plan changes. A scheduler calls `/api/cron/digest` every few minutes. The server sends whatever has come due, once.

1. **Apply the migration.** Run `supabase/migrations/004_reminders.sql` in the Supabase SQL editor. It adds `reminder_profiles` and `push_subscriptions`, both server-only (row-level security on, no policies). Reminders also need `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` on the server.
2. **Generate VAPID keys** (the identity your server presents to browsers' push services):
   ```bash
   npx web-push generate-vapid-keys
   ```
   Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:you@example.com` or your site's https address) in the server environment. Keep the private key secret; the public key is sent to browsers by `/api/reminders/config`.
3. **Email (optional, for people who decline push).** Create a [Resend](https://resend.com) account, verify a sending domain, and set `RESEND_API_KEY` and `DIGEST_FROM` (for example `Telos <digest@yourdomain.com>`). Every email carries a signed unsubscribe link.
4. **Set the scheduler secret.** Choose a long random `CRON_SECRET`. The scheduler sends it as `Authorization: Bearer <secret>` or `x-cron-secret: <secret>`. It also signs unsubscribe links unless you set `REMINDER_SECRET`. Optionally set `PUBLIC_API_URL` (your server's public address) for those links.
5. **Trigger `/api/cron/digest` every 15 minutes.** Pick one:

   **(a) Supabase `pg_cron` + `pg_net`** (free, reliable). Enable both extensions (Database → Extensions), then in the SQL editor:
   ```sql
   select cron.schedule('telos-reminders', '*/15 * * * *', $$
     select net.http_post(
       url := 'https://YOUR-SERVER.vercel.app/api/cron/digest',
       headers := jsonb_build_object('x-cron-secret', 'YOUR_CRON_SECRET')
     );
   $$);
   ```
   Remove it later with `select cron.unschedule('telos-reminders');`.

   **(b) Vercel Cron.** Only on a plan that allows it. **Vercel Hobby allows a cron job to run at most once per day, and an invalid schedule makes the deployment fail.** That is why `vercel.json` has no `crons` entry. On Pro, add `"crons": [{ "path": "/api/cron/digest", "schedule": "*/15 * * * *" }]` and set `CRON_SECRET` (Vercel sends it as the bearer token). On Hobby, use (a) or (c).

   **(c) GitHub Actions.** `.github/workflows/reminders.yml` calls the endpoint every 15 minutes. Add repository secrets `REMINDERS_URL` (the full `/api/cron/digest` address) and `CRON_SECRET`. Without them it does nothing and passes. GitHub can delay scheduled runs by several minutes, and pauses them on inactive repositories.

**Precision.** A digest or reminder goes out on the first run after it comes due, so delivery is only as precise as the trigger: every 15 minutes means up to 15 minutes late. Each digest goes out once per local day and each reminder once, however often the endpoint runs.

**Check it.** `curl -X POST -H "x-cron-secret: $CRON_SECRET" https://YOUR-SERVER/api/cron/digest` returns counts (`digestsPush`, `digestsEmail`, `reminders`, `skipped`, `errors`, `subsRemoved`). `401` means a wrong secret, `503` means `CRON_SECRET` or Supabase is not set. In the app, the "Send a test" button calls `/api/reminders/test`.
