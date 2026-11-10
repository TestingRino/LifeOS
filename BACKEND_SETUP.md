# Set Up Your Life.OS Backend (One-Time Setup)

Deploy a single shared backend for your friends/family. Takes ~10 minutes.

## What You're Doing

- Deploying ONE backend server (you pay for Claude API)
- Friends/family use the frontend (free GitHub Pages)
- They don't need Vercel, GitHub, or any accounts
- Calendar sync + photo OCR just works for everyone

## Step 1: Get Your Credentials (5 min)

### Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create project: `Life.OS`
3. Enable APIs:
   - Search `Google Calendar API` → **ENABLE**
   - Search `Google+ API` → **ENABLE**
4. Create credentials:
   - Go to **APIs & Services** → **Credentials**
   - **+ CREATE CREDENTIALS** → **OAuth client ID**
   - Type: **Web application**
   - Name: `Life.OS`
   - **Authorized redirect URIs:** (add both)
     ```
     http://localhost:3000/auth/callback
     https://your-backend-url.vercel.app/auth/callback
     ```
     (You'll get the URL after deploying; come back and add it)
   - **CREATE**
5. Copy **Client ID** and **Client Secret**

### Claude API Key

1. Go to [Anthropic Console](https://console.anthropic.com)
2. **API keys** → **+ Create Key**
3. Copy the key

## Step 2: Deploy Backend (3 min)

Click deploy button:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/TestingRino/LifeOS&project-name=lifeos-api&env=GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,ANTHROPIC_API_KEY&envDescription=Get%20credentials%20from%20Google%20Cloud%20and%20Anthropic)

When prompted, enter:
- `GOOGLE_CLIENT_ID` = (from Step 1)
- `GOOGLE_CLIENT_SECRET` = (from Step 1)
- `ANTHROPIC_API_KEY` = (from Step 1)

Click **Deploy**.

Wait 1-2 minutes. You'll get a URL like:
```
https://lifeos-api-abc123.vercel.app
```

**Save this URL.**

## Step 3: Update Google OAuth (1 min)

Go back to [Google Cloud Console](https://console.cloud.google.com):
1. Find your OAuth credential
2. Add to **Authorized redirect URIs:**
   ```
   https://lifeos-api-abc123.vercel.app/auth/callback
   ```
   (Replace `abc123` with your actual Vercel URL)
3. **SAVE**

## Step 4: Tell Your Friends

Share this link with friends/family:
```
https://testingrino.github.io/LifeOS/
```

In the app, Settings → **Backend URL** → paste your Vercel URL:
```
https://lifeos-api-abc123.vercel.app
```

Done! They can now:
- Sync their Google Calendar
- Upload photos and auto-fill their planner
- Everything just works, no setup needed for them

---

## Step 5: Choose who can use photo import (admin)

Photo import spends your Claude credits, so it is limited to Google accounts you approve. Everything else in Life.OS works for any signed-in or anonymous user.

In Vercel: **Project → Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `OCR_ALLOWED_EMAILS` | a comma-separated list, for example `you@gmail.com,spouse@gmail.com` |

Then **redeploy** (Deployments → the latest one → Redeploy). Changes take effect after the redeploy.

- Emails are not case-sensitive.
- If the list is empty or missing, **nobody** can use photo import (it fails closed).
- `*` allows any signed-in Google account. Only use it if you accept the cost.
- Do not commit real addresses to the repository. Keep them in Vercel only.

**Two separate lists.** In Google Cloud Console, the OAuth consent screen's **Test users** list controls who can sign in with Google at all while the project is in *Testing* mode. `OCR_ALLOWED_EMAILS` controls who can use photo import after signing in. A new person usually needs to be added to both, until you publish the Google project (then only the Vercel list matters).

To add someone: add their email to **Test users** (Cloud Console) and to `OCR_ALLOWED_EMAILS` (Vercel), then redeploy.

---

## Troubleshooting

**"Deploy failed"**
- Make sure all 3 env vars are entered correctly
- Try redeploying

**"Google login fails"**
- Make sure your Redirect URI in Google Cloud matches your Vercel URL exactly
- Make sure Calendar API is enabled

**"OCR fails"**
- Check that you have available Claude API credits
- Try uploading a clearer image

---

## Costs

- **Vercel:** Free tier (generous, includes auto-scaling)
- **Claude API:** ~$1-10/mo depending on OCR usage
- **Google APIs:** Free

**Total:** ~$5-15/mo for the backend

---

## Updates

To update the backend with new features:

```bash
git pull origin main
git push  # to your fork
# Then redeploy from Vercel dashboard
```

---

## That's It!

Your friends/family can now just open the link and use Life.OS with full Calendar sync and photo OCR. 🎉
