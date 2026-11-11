# Deploying Life.OS

One document for everything. Life.OS is a static website plus an optional small backend:

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

Google Cloud Console (APIs & Services): enable the **Google Calendar API** (and **Drive API** only if you keep the older Drive mode). Add the website URL as an authorised redirect URI. The OAuth consent screen needs the privacy policy URL (`https://<user>.github.io/LifeOS/privacy.html`) before verification. The app asks for calendar *read-only* by default and for *create events* only when someone uses a feature that adds events.

Local backend: `cd server && cp .env.example .env && npm install && npm start` (port 3001; the site uses it automatically on `localhost`).

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
