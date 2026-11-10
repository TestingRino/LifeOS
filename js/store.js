/* Life.OS — state, persistence and path helpers. */
(function (root) {
  'use strict';

  const KEY = 'lifeos.v1';
  const VERSION = 1;

  const AREAS = [
    { id: 'work', name: 'Work & Career' },
    { id: 'home', name: 'Home & Admin' },
    { id: 'friends', name: 'Friends & Networks' },
    { id: 'projects', name: 'Projects & Passion' },
    { id: 'fun', name: 'Fun & Activities' },
    { id: 'health', name: 'Health & Habits' },
  ];

  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

  function defaultState() {
    return {
      version: VERSION,
      settings: { plannerStartMonth: 9, weekStart: 0, cycleMonths: 6, weightUnit: 'lbs', weightGoal: '', workoutTarget: 5, notificationsEnabled: false, gcalSelected: [], notificationTime: '09:00', quietStart: '20:00', quietEnd: '08:00' },
      foundation: { vision: '', eulogy: '', mission: '', values: '' },
      roles: [],          // {id, name, why}
      cycles: [],         // {id, name, start, end, review:{wins,lessons,adjust}, roleActions:{roleId:{monthly,weekly,daily}}}
      goals: [],          // {id, cycleId, roleId, title, area, tier, why, measure, target, doneBy, progress, status}
      events: [],         // {id, start, end, text, yearly}
      months: {},         // 'YYYY-MM' -> month page
      weeks: {},          // 'YYYY-MM-DD' (week start) -> week page
      bucket: [],         // {id, text, star, budget, target, details, done}
      reading: [],        // {id, title, by, genre, nutshell, done}
      notesIndex: [],     // {id, topic, page}
      schedule: [],       // {id, date, time, text}            — appointments / time blocks
      workouts: [],       // {id, date, type, details, minutes, done}  — planned & logged
      shopping: [],       // {id, text, done}                   — running shopping list
      projects: [],       // {id, name, status, goalId, notes, steps:[{id,text,done}]} — hobby & project plans
      weights: [],        // {id, date, value}
      journals: [],       // {id, date, text, tags}
      focus: {},          // 'YYYY-Qn' -> [goalId] — the 3–4 goals chosen as this quarter's focus
      bigAuto: {},        // 'YYYY-MM-DD' -> true once that day's Big 3 was auto-filled
      big3: [],           // {id, date, text, goalId, done, migrated} — Daily Big 3 (Full Focus / Bullet Journal style)
      gcalCalendars: [],  // [{id, name, color, primary}] — the user's Google calendars (view-only)
      inbox: [],          // {id, kind 'todo'|'goal'|'note', text, date, done} — quick capture
      memories: [],       // {id, date, kind 'memory'|'quote'|'event', who, text}
      sessions: {},       // 'cadence:period' -> {steps:{id:true}, done:'YYYY-MM-DD'} — guided planning sessions
      idealWeek: [],      // {id, quarter 'YYYY-Qn', dow 0-6, time, text, goalId, workout} — the ideal week, set per quarter
      idealCarried: {},   // 'YYYY-Qn' -> previous quarter it was copied from (until reviewed)
      idealLog: {},       // 'YYYY-MM-DD' -> {itemId: true|'skip'} — per-day done / skipped
      reviews: {},        // 'YYYY-MM-DD' -> {purpose, goals, ideal} — daily review check-offs
      wheel: [],          // {id, date, scores:{physical..social: 1-10}, note} — Wheel of Life assessments
      lastNotifications: {},  // {key: timestamp} — prevent notification spam
    };
  }

  function migrate(s) {
    const base = defaultState();
    const out = Object.assign(base, s || {});
    out.settings = Object.assign(defaultState().settings, (s && s.settings) || {});
    out.foundation = Object.assign(defaultState().foundation, (s && s.foundation) || {});
    out.version = VERSION;
    return out;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? migrate(JSON.parse(raw)) : defaultState();
    } catch (e) {
      console.warn('Life.OS: could not read saved data', e);
      return defaultState();
    }
  }

  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch (e) { console.warn('Life.OS: could not save', e); return false; }
  }

  function emptyMonth() {
    return { actions: [], ideas: '', grateful: '', strengths: '', notes: '',
      reflection: { progress: '', improve: '', memories: '' } };
  }
  function emptyWeek() {
    return { actions: [], top3: [], habits: [], notToDo: [], notes: '', gratitude: '', dreams: '', rating: 0, pulse: {} };
  }

  /* Path syntax: dot-separated; a segment "@id" selects the array item with that id. */
  function resolve(obj, segs, create) {
    let cur = obj;
    for (const seg of segs) {
      if (cur == null) return undefined;
      if (seg[0] === '@') {
        cur = Array.isArray(cur) ? cur.find((x) => x && x.id === seg.slice(1)) : undefined;
      } else {
        if (cur[seg] == null && create) cur[seg] = {};
        cur = cur[seg];
      }
    }
    return cur;
  }
  const getPath = (obj, path) => resolve(obj, path.split('.'), false);
  function setPath(obj, path, value) {
    const segs = path.split('.');
    const last = segs.pop();
    const parent = resolve(obj, segs, true);
    if (parent == null) return false;
    parent[last] = value;
    return true;
  }

  const api = { KEY, AREAS, uid, defaultState, migrate, load, save, emptyMonth, emptyWeek, getPath, setPath };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LifeStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
