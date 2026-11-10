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
