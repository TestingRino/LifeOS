# Life.OS

A purpose-based life planning tool built to work **alongside a physical planner**.
Start with who you want to become, set 10–12 goals per planning cycle, then revisit them
every quarter, month and week. The app keeps it all connected so every weekly action traces
back to a goal, every goal to a role, and every role to your vision.

## How it fits together

```
Foundation  →  Roles & WHY  →  Goals (10–12 per cycle)  →  Monthly actions  →  Weekly actions  →  Daily (paper)
 vision, eulogy,     Parent, Husband,    6-month (bi-annual) or       6 planner areas       priorities, habits,
 mission, values     Professional…       3-month cycles               + reflections         schedule, workouts
```

| Page | Mirrors in the planner | What it does |
|---|---|---|
| **Today** | — | Vision reminder, today's schedule and workouts, rituals that are due (planning session, quarterly check-in, month plan/reflection, weekly review), weekly progress, upcoming key dates, goal health (flags goals with no actions planned). |
| **Foundation** | — | 5–10 year vision, eulogy ("what I hope people say at my funeral"), personal mission, core values. |
| **Roles & Goals** | Roles & Goals pages | Roles with a WHY, goals per role (purpose ★ or pursuit, area, target date, done by, progress, status), monthly/weekly/daily role actions, cycle review, "Start next cycle" with carry-forward. |
| **Year** | Annual Key Dates Overview & Annual Planning Notes | Key dates (ranges, yearly birthdays) and notes for M1–M12. |
| **Month** | Monthly calendar + Goals & Priority Actions | Calendar with key dates; priority actions in the six planner areas, each linkable to a goal (with "no action yet" nudges); ideas, gratitude, affirmations; end-of-month reflections. |
| **Week** | Weekly spread | Schedule (appointments per day), priority actions by area, habit tracker, workouts (plan + log), goal pulse (on track / slipping / stalled), shopping list, not-to-do list, notes, gratitude & health, "Are you chasing your dreams?", rate your week. |
| **Track** | — | Weight log with trend chart and target, workouts per week (12-week chart, by type), habit history heatmap with streaks, goal progress with trend sparklines. |
| **Lists** | Bucket List, Reading & Entertainment, Notes Index | Plus hobby/project plans (next-step checklists linked to goals) and a running shopping list. |

**Copy for planner** on the Month and Week pages produces a plain-text summary to transcribe into the paper spread.

Weeks follow the planner's convention: a week belongs to the month its last day falls in
(Sun Sep 27 – Sat Oct 3 is "Week 1 of October"). The planner year starts in October by default
(change in ⚙ Settings).

## For Friends & Family

**Open Life.OS:** https://testingrino.github.io/LifeOS/

Everything works offline. No login, no signup, no accounts needed.

Optionally: Calendar sync + photo OCR (if your admin set it up). See [USER_GUIDE.md](USER_GUIDE.md).

---

## For Admins: Deploy Shared Backend (One-Time)

Want to provide Calendar sync and photo OCR to your friends/family?

**[→ BACKEND_SETUP.md](BACKEND_SETUP.md)** — Deploy ONE shared backend (10 min)

No friction for users — they just open the link and use it:
- 📅 **Google Calendar sync** (events show up in their Week view)
- 📸 **Photo OCR** (upload photos, auto-fill schedule/goals/habits)
- 🔄 **No setup needed** — they don't know or care about the backend

## Running it

No build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```bash
npm start
```

Then visit http://localhost:8080. It also works as-is on GitHub Pages.

**With backend (optional):**
```bash
npm start                          # Frontend on port 8080
cd server && npm install && npm run dev  # Backend on port 3001
```

## On your phone

Life.OS adapts to phones: a bottom tab bar (Today, Week, Month, Goals,
Track, More), 16px fields so iOS doesn't zoom on every tap, touch-sized controls, and phone layouts for the
calendar, schedule and habit tracker.

To use it like an app, host it (e.g. GitHub Pages), open it in Safari or Chrome on your phone, and choose
**Add to Home Screen**. It then opens full-screen with its own icon.

Note: browsers keep data per site *and* per app. An installed home-screen copy on iOS has its own storage,
separate from Safari, so pick one place to use it and move data between devices with Export/Import.

## Your data

Everything is stored in your browser's `localStorage`; nothing is sent anywhere.
Use **⚙ Settings → Export backup** regularly, and **Import backup** to restore or move to another device.

## Development

```
index.html      shell + navigation
css/style.css   styles (warm paper light theme)
js/util.js      pure date/planning helpers (unit-tested)
js/store.js     state shape, persistence, path helpers
js/app.js       router, views, interactions
tests/          node:test unit tests
```

```bash
npm test
```

Append `?today=2026-11-10` to the URL to preview the app as of another date.
