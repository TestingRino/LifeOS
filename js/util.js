/* Life.OS — pure date & planning helpers (no DOM). Usable in the browser and in Node tests. */
(function (root) {
  'use strict';

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const parseMonthKey = (k) => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1); };
  const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
  const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const daysBetween = (a, b) => Math.round((parseISO(toISO(b)) - parseISO(toISO(a))) / 86400000);

  function startOfWeek(d, weekStart = 0) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return addDays(x, -((x.getDay() - weekStart + 7) % 7));
  }
  const weekKey = (d, weekStart = 0) => toISO(startOfWeek(d, weekStart));

  /* Planner convention: a week belongs to the month its LAST day falls in.
     e.g. Sun Sep 27 – Sat Oct 3 is "Week 1 of October". */
  function weekOfMonth(weekStartDate) {
    const end = addDays(weekStartDate, 6);
    return { n: Math.ceil(end.getDate() / 7), month: end.getMonth(), year: end.getFullYear(), monthKey: monthKey(end) };
  }

  /* Weeks (start dates) whose last day falls in the given month. */
  function weeksOfMonth(mKey, weekStart = 0) {
    const first = parseMonthKey(mKey);
    let ws = startOfWeek(first, weekStart);
    if (addDays(ws, 6) < first) ws = addDays(ws, 7);
    const out = [];
    while (monthKey(addDays(ws, 6)) === mKey) { out.push(ws); ws = addDays(ws, 7); }
    return out;
  }

  /* 2D grid of Date objects for a calendar month (full weeks). */
  function monthGrid(mKey, weekStart = 0) {
    const first = parseMonthKey(mKey);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    let d = startOfWeek(first, weekStart);
    const rows = [];
    while (d <= last) {
      const row = [];
      for (let i = 0; i < 7; i++) { row.push(d); d = addDays(d, 1); }
      rows.push(row);
    }
    return rows;
  }

  /* The 12 planner months (M1..M12) starting from the planner's first month. */
  function plannerMonths(startYear, startMonth) {
    const out = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(startYear, startMonth + i, 1);
      out.push({ index: i + 1, key: monthKey(d), name: MONTHS[d.getMonth()], year: d.getFullYear() });
    }
    return out;
  }

  /* Planner year that contains a date, given the month the planner starts on. */
  function plannerYearStart(date, startMonth) {
    const y = date.getMonth() >= startMonth ? date.getFullYear() : date.getFullYear() - 1;
    return { year: y, month: startMonth };
  }

  /* Events: {start, end?, yearly?}. Does the event touch ISO day `iso`? */
  function eventOn(ev, iso) {
    if (!ev || !ev.start) return false;
    if (ev.yearly) {
      const md = iso.slice(5);
      const s = ev.start.slice(5), e = (ev.end || ev.start).slice(5);
      return s <= e ? md >= s && md <= e : md >= s || md <= e;
    }
    const end = ev.end && ev.end >= ev.start ? ev.end : ev.start;
    return iso >= ev.start && iso <= end;
  }
  const eventsOn = (events, iso) => (events || []).filter((e) => eventOn(e, iso));

  /* Next occurrence (ISO) of an event on/after `fromIso`, or null if it has passed. */
  function nextOccurrence(ev, fromIso) {
    if (!ev.yearly) {
      const end = ev.end && ev.end >= ev.start ? ev.end : ev.start;
      if (end < fromIso) return null;
      return ev.start >= fromIso ? ev.start : fromIso;
    }
    const y = Number(fromIso.slice(0, 4));
    for (const yy of [y, y + 1]) {
      const s = `${yy}${ev.start.slice(4)}`;
      const e = `${yy}${(ev.end || ev.start).slice(4)}`;
      if (e >= fromIso) return s >= fromIso ? s : fromIso;
    }
    return null;
  }

  const cycleContaining = (cycles, iso) =>
    (cycles || []).find((c) => c.start <= iso && iso <= c.end) || null;

  /* Default cycle beginning on a given date and lasting `months` months. */
  function makeCycleDates(startIso, months) {
    const s = parseISO(startIso);
    const end = addDays(new Date(s.getFullYear(), s.getMonth() + months, s.getDate()), -1);
    return { start: startIso, end: toISO(end) };
  }

  function cycleName(startIso, endIso) {
    const s = parseISO(startIso), e = parseISO(endIso);
    const a = `${MONTHS[s.getMonth()].slice(0, 3)} ${s.getFullYear()}`;
    const b = `${MONTHS[e.getMonth()].slice(0, 3)} ${e.getFullYear()}`;
    return `${a} – ${b}`;
  }

  function fmtDate(iso, opts) {
    const d = parseISO(iso);
    return d.toLocaleDateString(undefined, opts || { month: 'short', day: 'numeric' });
  }

  const api = {
    MONTHS, DAYS, pad, toISO, parseISO, monthKey, parseMonthKey, addDays, addMonths, daysInMonth,
    daysBetween, startOfWeek, weekKey, weekOfMonth, weeksOfMonth, monthGrid, plannerMonths,
    plannerYearStart, eventOn, eventsOn, nextOccurrence, cycleContaining, makeCycleDates, cycleName, fmtDate,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LifeUtil = api;
})(typeof window !== 'undefined' ? window : globalThis);
