# Life.OS Setup Guide

Complete setup for Google Calendar sync, photo OCR, and bidirectional sync.

## Table of Contents

- [Quick Start (5 min)](#quick-start)
- [Part 1: Create Google OAuth Credentials](#part-1-google-oauth)
- [Part 2: Get Claude API Key](#part-2-claude-api)
- [Part 3: Deploy Backend](#part-3-deploy-backend)
- [Part 4: Connect in Life.OS](#part-4-connect-lifeos)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

**If you just want to try it locally:**

```bash
cd server
npm install
cp .env.example .env
# Fill in GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ANTHROPIC_API_KEY in .env
npm run dev
```

Then open Life.OS and Settings → **Connect Google Calendar**.

---

## Part 1: Google OAuth

To let Life.OS access your Google Calendar, you need to set up OAuth credentials.

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown (top left)
3. Click **NEW PROJECT**
4. Name it `Life.OS` and click **CREATE**
5. Wait ~1 minute for the project to activate

### Step 2: Enable Calendar API

1. In the Cloud Console, go to **APIs & Services** → **Library**
2. Search for `Google Calendar API`
3. Click it and click **ENABLE**
4. Search for `Google+ API` (or **People API**)
5. Click it and click **ENABLE**

### Step 3: Create OAuth Credentials

1. Go to **APIs & Services** → **Credentials** (left sidebar)
2. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
3. If you see "To create an OAuth client ID, you must first set a product name on the OAuth consent screen," click **CONFIGURE CONSENT SCREEN**
   - Choose **External** (or **Internal** if in a Google Workspace)
   - Click **CREATE**
   - Fill in:
     - App name: `Life.OS`
     - User support email: your email
     - Developer contact: your email
   - Click **SAVE AND CONTINUE**
   - Scopes: Click **ADD OR REMOVE SCOPES** → search `calendar` → check `Google Calendar API` → **SAVE**
   - Click **SAVE AND CONTINUE** again
   - Click **BACK TO DASHBOARD**
4. Go back to **Credentials**
5. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
6. Application type: **Web application**
7. Name: `Life.OS`
8. Authorized redirect URIs: add:
   - `http://localhost:3000/auth/callback` (for local testing)
   - `https://yourdomain.com/auth/callback` (replace with your actual domain when deploying)
9. Click **CREATE**
10. Copy **Client ID** and **Client Secret** — you'll need these

**Save these for Part 3:**
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

---

## Part 2: Claude API

For photo OCR, you need a Claude API key.

1. Go to [Anthropic Console](https://console.anthropic.com)
2. Log in (create account if needed)
3. Click **API keys** (left sidebar)
4. Click **+ Create Key**
5. Name: `Life.OS`
6. Copy the key (you'll only see it once!)

**Save for Part 3:**
- `ANTHROPIC_API_KEY`

---

## Part 3: Deploy Backend

Choose one of these options:

### Option A: Vercel (Recommended, 2 min)

Vercel auto-deploys from GitHub and is free.

1. **Push to GitHub** (if not already)
   - Make sure you're on branch `claude/kind-hypatia-hbn6ej`
   - Push: `git push origin claude/kind-hypatia-hbn6ej`

2. Go to [Vercel](https://vercel.com)
3. Click **Add New** → **Project**
4. Import your GitHub repo (`TestingRino/LifeOS`)
5. Under "Root Directory," select `server/`
6. Click **Environment Variables** and add:
   - `GOOGLE_CLIENT_ID` = (from Part 1)
   - `GOOGLE_CLIENT_SECRET` = (from Part 1)
   - `ANTHROPIC_API_KEY` = (from Part 2)
   - `GOOGLE_REDIRECT_URI` = `https://[your-vercel-url].vercel.app/auth/callback`
     (You'll get the URL after first deploy; redeploy after adding this)
7. Click **DEPLOY**
8. Wait for deployment to finish
9. Copy the deployment URL (e.g., `https://lifeos-api.vercel.app`)
10. Go to [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials)
11. Click your OAuth credential
12. Add to **Authorized redirect URIs:**
    - `https://[your-vercel-url].vercel.app/auth/callback`
13. **SAVE**

**Your API base URL:** `https://[your-vercel-url].vercel.app`

### Option B: Railway (2–3 min)

1. Go to [Railway](https://railway.app)
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your LifeOS repo
4. Railway auto-detects `server/` as the service
5. Under the service settings, add variables:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `ANTHROPIC_API_KEY`
   - `GOOGLE_REDIRECT_URI` = `https://[generated-url].up.railway.app/auth/callback`
6. Auto-deploys when you push
7. Copy your deployment URL from the service settings

**Your API base URL:** `https://[generated-url].up.railway.app`

### Option C: Heroku (Free tier ended; use Railway or Vercel)

### Option D: Local (For testing only)

```bash
cd server
npm install
cp .env.example .env
# Edit .env with your credentials
npm run dev
```

Opens on `http://localhost:3001`. **Note:** Can't use localhost if accessing from phone.

---

## Part 4: Connect Life.OS

### Update Frontend Configuration

1. Open `index.html` in a text editor
2. Find the line with `const API_BASE = ...` in `js/app.js` (around line 12)
3. Update it:
   ```javascript
   const API_BASE = 'https://your-vercel-url.vercel.app';  // Replace with your deployed URL
   ```
4. Or set an environment variable (if deploying to GitHub Pages):
   ```bash
   export REACT_APP_API_BASE=https://your-vercel-url.vercel.app
   ```
5. Save and commit

### Connect in Life.OS

1. Open Life.OS in your browser
2. Go to Settings ⚙
3. Click **Connect Google Calendar**
4. Log in to your Google account
5. Grant permission to access your calendar
6. You're connected! 🎉

Now:
- **Calendar events** will sync to your schedule
- **Upload Photo** button lets you OCR planner photos
- All data stays in your browser; backend only handles OCR and Calendar

---

## Using Photo OCR

### Take a Photo of Your Planner

1. Click **Upload Photo** in Settings
2. Choose a photo from your phone or computer
3. Life.OS detects what's in the photo (schedule, goals, habits, etc.)
4. Choose where to add it:
   - "Add to this week's schedule" → adds appointments
   - "Create Google Calendar events" → syncs to Calendar
   - "Add to Roles & Goals" → creates new goals
   - etc.
5. Confirm and done!

### Supported Photo Types

- 📅 **Schedule/Calendar:** Photos of calendar pages with dates and events
- ⭐ **Goals:** Photos of written goals with target dates
- 🏃 **Workouts:** Workout logs with dates, types, duration
- ⚖️ **Weights:** Weight logs or trend charts
- ✅ **Habits:** Habit trackers with names and targets
- 🛒 **Shopping:** Shopping lists
- 📓 **Journal:** Handwritten or printed notes
- 🎯 **Bucket List:** Goals and dreams
- 📚 **Reading:** Reading lists with titles and authors
- 🎨 **Projects:** Project plans with steps
- 📍 **Events:** Key dates and anniversaries

---

## Calendar Sync (Phase 1 & 3)

### What Syncs?

- ✅ Calendar events → Your Life.OS **Schedule** (Week page)
- ✅ Life.OS schedule entries → **Google Calendar** (when you add them)
- ✅ OCR'd photos → **Google Calendar** (if you choose that route)

### Auto-Sync

Calendar events are fetched when you open Life.OS. Add a scheduled sync in the browser:

1. Settings → enable browser notifications
2. Each day at your notification time, check for new calendar events

---

## Troubleshooting

### "Server connection failed" or "API base not set"

**Solution:** Check that you've set `API_BASE` correctly in `js/app.js` and it matches your deployed backend URL.

### "Google login failed" or "Invalid OAuth credentials"

**Solution:**
- Make sure your `GOOGLE_REDIRECT_URI` in `.env` matches what you added to Google Cloud Console Credentials
- Verify `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are correct
- Check that Calendar API is **enabled** in Google Cloud Console

### "OCR failed" or "Claude API error"

**Solution:**
- Verify `ANTHROPIC_API_KEY` is correct in server `.env`
- Check that you have available credits on your Anthropic account
- Try uploading a clearer photo (good lighting, focused)

### "Photo not recognized"

**Solution:**
- Make sure the photo is clear and well-lit
- Try cropping to just the content (not including the whole page)
- Re-upload with `type: auto` to let Claude detect

### "Calendar events not syncing"

**Solution:**
- Go to Settings and **Connect Google Calendar** again to refresh the token
- Wait a few seconds after connecting
- Check that your calendar in Google Calendar is not in "Other calendars" or archived

### "Data disappeared after reload"

**Solution:**
- Life.OS stores data in browser localStorage, which is per-site
- If you access from different URLs (localhost vs. deployed), data is separate
- Use Settings → **Export backup** and **Import** to move data between URLs

---

## Privacy & Security

- **Your data stays local:** Life.OS stores everything in your browser, not on our servers
- **Photos are temporary:** Uploaded photos are sent to Claude API for OCR, processed, and deleted immediately
- **Tokens are secure:** Google and Claude API tokens are stored in your browser's localStorage
- **Export regularly:** Use Settings → **Export backup** to keep a local copy

---

## Next Steps

1. ✅ OAuth setup (Part 1)
2. ✅ API key (Part 2)
3. ✅ Deploy backend (Part 3)
4. ✅ Connect in Life.OS (Part 4)
5. 🚀 Start uploading photos and syncing your calendar!

**Questions?** Check the [server README](../server/README.md) for technical details.

---

## Feedback

If something isn't working, check:
- Browser console (F12 → Console tab) for error messages
- Server logs (if running locally: check terminal)
- This troubleshooting section above
