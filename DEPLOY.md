# Deploy Your Own Life.OS Backend

Get your own backend running in 5 minutes with Vercel.

## Quick Deploy (2 minutes)

### Step 1: Click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FTestingRino%2FLifeOS&project-name=lifeos-api&repository-name=LifeOS&env=GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,ANTHROPIC_API_KEY&envDescription=Get%20these%20from%20Google%20Cloud%20Console%20and%20Anthropic&envLink=https%3A%2F%2Fdocs.lifeos.app%2Fsetup)

### Step 2: Enter Your Secrets

When Vercel asks for environment variables:
- `GOOGLE_CLIENT_ID` → from Google Cloud Console
- `GOOGLE_CLIENT_SECRET` → from Google Cloud Console
- `ANTHROPIC_API_KEY` → from Anthropic console

### Step 3: Get Your URL

After deployment finishes, you'll see:
```
✓ Production URL: https://lifeos-api-abc123.vercel.app
```

**Save this URL** — you'll need it in Life.OS Settings.

---

## Setup Secrets (5 minutes)

### Google OAuth Credentials

**If you already have them:** Skip to "Vercel Deploy" above.

**If you don't:**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project: **Life.OS**
3. Enable these APIs:
   - Search `Google Calendar API` → Click → **ENABLE**
   - Search `Google+ API` → Click → **ENABLE**
4. Go to **APIs & Services** → **Credentials**
5. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
6. Choose **Web application**
7. Add **Authorized redirect URIs:**
   - `http://localhost:3000/auth/callback` (for testing)
   - `https://lifeos-api-YOURNAME.vercel.app/auth/callback` (replace YOURNAME)
8. Click **CREATE**
9. Copy **Client ID** and **Client Secret**

### Claude API Key

1. Go to [Anthropic Console](https://console.anthropic.com)
2. Click **API keys** → **+ Create Key**
3. Copy the key (you'll only see it once)

---

## Connect in Life.OS

1. Open Life.OS in your browser
2. Go to **Settings** ⚙
3. In the **Integrations** section, click **Connect Google Calendar**
4. Log in to Google
5. Grant permission
6. **Done!** 🎉

Your Life.OS is now connected to your Google Calendar and can upload photos.

---

## Using Photo OCR

1. Click **Upload photo** in Settings
2. Take a photo of your planner (schedule, goals, habits, etc.)
3. Life.OS detects what's in it and asks where to add it
4. Choose: "Add to schedule" or "Create Calendar event" etc.
5. Confirm and done!

---

## Troubleshooting

**"Deploy failed"**
- Make sure all 3 env vars are filled in correctly
- Try redeploying from Vercel dashboard

**"Google login failed"**
- Check your Redirect URI in Google Cloud Console matches your Vercel URL
- Make sure Calendar API is enabled

**"OCR failed"**
- Verify your Claude API key is correct
- Check that you have available credits at https://console.anthropic.com

---

## Advanced: Update Later

If you want to get the latest features:

```bash
git pull origin claude/kind-hypatia-hbn6ej
git push  # to your fork
# Then redeploy from Vercel (Settings → Deployments → Redeploy)
```

---

## Privacy

- Your data stays in your browser (Life.OS is offline-first)
- Your backend only handles Google Calendar sync and photo OCR
- Photos are sent to Claude API, processed, then deleted immediately
- Your Google and Claude tokens are stored only in your browser

---

**Need help?** Check [SETUP.md](docs/SETUP.md) for detailed instructions.
