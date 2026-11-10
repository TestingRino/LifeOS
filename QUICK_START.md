# Life.OS — Quick Start for Friends & Family

## Option A: Just Use It (No Setup)

Open https://lifeos-app.example.com in your browser. That's it. No backend needed.

Everything stays in your browser. Totally private.

---

## Option B: Add Calendar & Photo OCR (5 min setup)

### 1️⃣ Get Your Keys (3 minutes)

**Google Calendar key:**
- Go to https://console.cloud.google.com
- Create a project: `Life.OS`
- APIs: Enable `Google Calendar API`
- Credentials: Create OAuth → Web application
- Copy **Client ID** and **Client Secret**

**Claude API key:**
- Go to https://console.anthropic.com
- Create API key
- Copy the key

### 2️⃣ Deploy Backend (1 minute)

Click this button:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FTestingRino%2FLifeOS&project-name=lifeos-api&repository-name=LifeOS&env=GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,ANTHROPIC_API_KEY)

Paste your keys when asked. Click Deploy. Wait 1 minute.

You'll get a URL like: `https://lifeos-api-xyz.vercel.app`

### 3️⃣ Connect in Life.OS (1 minute)

1. Open Life.OS
2. Settings ⚙
3. Click **Connect Google Calendar**
4. Log in to Google
5. Done!

---

## What You Can Now Do

✅ **Calendar syncs** — Your Google Calendar shows up in Life.OS  
✅ **Upload photos** — Take a photo of your planner → AI extracts the data  
✅ **Auto-fill** — Choose where data goes (schedule, goals, habits, etc.)  

---

## Photos Supported

- 📅 Calendar/schedule
- ⭐ Goals
- 🏃 Workouts
- ✅ Habits
- 🛒 Shopping lists
- 📓 Journal notes
- 🎯 Bucket list
- 📚 Reading lists
- 🎨 Projects
- And more!

---

## Privacy

- Your data stays in your browser (100% offline by default)
- Your backend only handles Calendar sync and photo processing
- No data sent to us or anyone else
- Photos are processed by Claude API, then deleted

---

## Need Help?

- **Setup issues?** → See [DEPLOY.md](DEPLOY.md)
- **Technical details?** → See [docs/SETUP.md](docs/SETUP.md)
- **Backend questions?** → See [server/README.md](server/README.md)

---

**Happy planning! 🎯**
