/* Life.OS — application: router, views and interactions. */
(function () {
  'use strict';
  const U = window.LifeUtil;
  const S = window.LifeStore;
  const AREAS = S.AREAS;

  let firstRun = false;
  try { firstRun = localStorage.getItem(S.KEY) === null; } catch (e) { /* storage unavailable */ }
  let state = S.load();
  const app = document.getElementById('app');

  /* ---------- basics ---------- */
  const DEFAULT_API_BASE = 'https://life-os-bice-xi.vercel.app';
  const API_BASE = localStorage.getItem('api_base') || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : DEFAULT_API_BASE);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const qsToday = new URLSearchParams(location.search).get('today');
  const today = () => (qsToday ? U.parseISO(qsToday) : new Date());
  const todayISO = () => U.toISO(today());
  const ws = () => Number(state.settings.weekStart) || 0;
  const get = (path) => S.getPath(state, path);

  let saveTimer;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (S.save(state)) toast('Saved'); }, 300);
  }
  function commit() { S.save(state); render(); }

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1200);
  }

  const areaName = (id) => (AREAS.find((a) => a.id === id) || { name: 'Other' }).name;
  const roleName = (id) => (state.roles.find((r) => r.id === id) || { name: '' }).name;

  function getMonth(key) {
    const m = state.months[key] = Object.assign(S.emptyMonth(), state.months[key] || {});
    m.reflection = Object.assign(S.emptyMonth().reflection, m.reflection || {});
    return m;
  }

  function getWeek(key) {
    if (!state.weeks[key]) {
      const w = S.emptyWeek();
      const prev = Object.keys(state.weeks).filter((k) => k < key).sort().reverse();
      const withHabits = prev.find((k) => (state.weeks[k].habits || []).length);
      if (withHabits) {
        w.habits = state.weeks[withHabits].habits.map((h) => ({ id: S.uid(), name: h.name, target: h.target, days: [false, false, false, false, false, false, false] }));
      }
      const withNot = prev.find((k) => (state.weeks[k].notToDo || []).length);
      if (withNot) w.notToDo = state.weeks[withNot].notToDo.map((n) => ({ id: S.uid(), text: n.text }));
      state.weeks[key] = w;
    }
    return Object.assign(state.weeks[key], Object.assign(S.emptyWeek(), state.weeks[key]));
  }

  const cycleAt = (iso) => U.cycleContaining(state.cycles, iso);
  function currentCycle() {
    return cycleAt(todayISO()) ||
      state.cycles.slice().sort((a, b) => (a.start < b.start ? 1 : -1))[0] || null;
  }
  function cycleGoals(cid, includeClosed) {
    return state.goals
      .filter((g) => g.cycleId === cid && (includeClosed || g.status === 'active'))
      .sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'purpose' ? -1 : 1));
  }

  function goalActivity(goalId, mk, wk) {
    const tally = (list) => {
      const l = (list || []).filter((a) => a.goalId === goalId);
      return { total: l.length, done: l.filter((a) => a.done).length };
    };
    return {
      month: tally(state.months[mk] && state.months[mk].actions),
      week: tally(state.weeks[wk] && state.weeks[wk].actions),
    };
  }

  /* ---------- habit & routine trackers ---------- */
  const DAYS_ISO = (wk) => [0, 1, 2, 3, 4, 5, 6].map((i) => U.toISO(U.addDays(U.parseISO(wk), i)));
  const weekCount = (log, wk) => DAYS_ISO(wk).filter((d) => log && log[d]).length;
  function weekStreak(log, perWeek, wk) {
    let s = weekCount(log, wk) >= perWeek ? 1 : 0;
    for (let k = U.toISO(U.addDays(U.parseISO(wk), -7)), i = 0; i < 104; i++, k = U.toISO(U.addDays(U.parseISO(k), -7))) {
      if (weekCount(log, k) >= perWeek) s++; else break;
    }
    return s;
  }
  function trackers() {
    const cyc = currentCycle();
    const goals = cyc ? cycleGoals(cyc.id) : state.goals.filter((g) => g.status === 'active');
    const out = [];
    goals.forEach((g) => {
      if (g.kind === 'habit') out.push({ title: g.title, goal: g, base: `goals.@${g.id}`, perWeek: Number(g.perWeek) || 5, log: g.log || {} });
      (g.routines || []).forEach((r) => out.push({ title: r.text, goal: g, base: `goals.@${g.id}.routines.@${r.id}`, perWeek: Number(r.perWeek) || 1, log: r.log || {}, routine: true }));
    });
    return out.filter((t) => t.title);
  }
  function trackerRow(tk, wk, iso) {
    const n = weekCount(tk.log, wk);
    const dots = DAYS_ISO(wk).map((d) => `<span class="dot${tk.log[d] ? ' on' : ''}${d === iso ? ' today' : ''}" title="${U.fmtDate(d, { weekday: 'long', month: 'short', day: 'numeric' })}${tk.log[d] ? ' ✓' : ''}"></span>`).join('');
    const streak = weekStreak(tk.log, tk.perWeek, wk);
    return `<li class="tracker">
      <label class="inline-check">${chk(`${tk.base}.log.${iso}`, `${tk.title} today`)} <span>${esc(tk.title)}${tk.routine ? ` <small class="muted">${esc(tk.goal.title)}</small>` : ''}</span></label>
      <span class="dots" aria-hidden="true">${dots}</span>
      <span class="count ${n >= tk.perWeek ? 'ok' : ''}">${n}/${tk.perWeek}</span>
      ${streak > 1 ? `<small class="streak" title="Weeks in a row hitting the goal">🔥 ${streak} wk</small>` : ''}
    </li>`;
  }

  /* ---------- small HTML helpers ---------- */
  const ta = (path, ph, rows = 3) =>
    `<textarea data-bind="${esc(path)}" rows="${rows}" placeholder="${esc(ph || '')}">${esc(get(path))}</textarea>`;
  const inp = (path, ph, type = 'text', extra = '') =>
    `<input type="${type}" data-bind="${esc(path)}" value="${esc(get(path))}" placeholder="${esc(ph || '')}" ${extra}>`;
  const chk = (path, label = '') =>
    `<input type="checkbox" data-bind="${esc(path)}" data-rerender ${get(path) ? 'checked' : ''} ${label ? `aria-label="${esc(label)}"` : ''}>`;
  const opts = (list, cur) => list.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(cur) ? 'selected' : ''}>${esc(o.l)}</option>`).join('');
  const areaOpts = (cur) => opts(AREAS.map((a) => ({ v: a.id, l: a.name })), cur);
  const goalOpts = (goals, cur) => opts([{ v: '', l: '— link to goal —' }].concat(
    goals.map((g) => ({ v: g.id, l: `${g.tier === 'purpose' ? '★ ' : ''}${g.title}` }))), cur);
  const tierOpts = (cur) => opts([{ v: 'purpose', l: '★ Purpose' }, { v: 'pursuit', l: 'Pursuit' }], cur);

  function progressBar(p) {
    const v = Math.max(0, Math.min(100, Number(p) || 0));
    return `<span class="bar" role="img" aria-label="${v}% complete"><span style="width:${v}%"></span></span>`;
  }

  function page(title, sub, body, actions = '') {
    return `<header class="page-head"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
      <div class="head-actions">${actions}</div></header>${body}`;
  }

  /* Priority-action boxes, shared by Month and Week pages. */
  function areaBoxes(base, items, goals) {
    return `<div class="areas">${AREAS.map((a) => {
      const list = items.filter((i) => i.area === a.id);
      const uncovered = goals.filter((g) => g.area === a.id && !items.some((i) => i.goalId === g.id));
      return `<section class="box area">
        <h3>${a.name}</h3>
        <ul class="checks">${list.map((i) => actionRow(base, i, goals)).join('')}</ul>
        ${uncovered.length ? `<div class="nudge">No action yet for:
          ${uncovered.map((g) => `<button class="chip" data-act="quickAction" data-path="${base}" data-area="${a.id}" data-goal="${g.id}">+ ${esc(g.title)}</button>`).join('')}</div>` : ''}
        <form class="add" data-add="${base}" data-area="${a.id}">
          <input name="text" placeholder="Add priority action…" required aria-label="New ${a.name} action">
          <button aria-label="Add">+</button>
        </form>
      </section>`;
    }).join('')}</div>`;
  }
  function actionRow(base, i, goals) {
    const p = `${base}.@${i.id}`;
    return `<li class="${i.done ? 'done' : ''}">
      ${chk(p + '.done', 'Done')}
      <div class="grow">
        <input class="inline" data-bind="${p}.text" value="${esc(i.text)}" aria-label="Action">
        <select class="link" data-bind="${p}.goalId" data-rerender aria-label="Linked goal">${goalOpts(goals, i.goalId)}</select>
      </div>
      <button class="x" data-act="del" data-path="${base}" data-id="${i.id}" aria-label="Remove">×</button>
    </li>`;
  }

  function simpleList(base, items, ph, withCheck = true) {
    return `<ul class="checks">${items.map((i) => `<li class="${i.done ? 'done' : ''}">
        ${withCheck ? chk(`${base}.@${i.id}.done`, 'Done') : '<span class="dot">⊘</span>'}
        <input class="inline grow" data-bind="${base}.@${i.id}.text" value="${esc(i.text)}">
        <button class="x" data-act="del" data-path="${base}" data-id="${i.id}" aria-label="Remove">×</button></li>`).join('')}</ul>
      <form class="add" data-add="${base}"><input name="text" placeholder="${esc(ph)}" required><button aria-label="Add">+</button></form>`;
  }

  /* ---------- rituals: what's due now ---------- */
  function rituals() {
    const t = today(), iso = U.toISO(t), out = [];
    const f = state.foundation;
    const cyc = cycleAt(iso);
    const mk = U.monthKey(t), wk = U.weekKey(t, ws());
    if (!f.vision.trim() || !f.eulogy.trim())
      out.push({ t: 'Write your Foundation', d: 'Your 5–10 year vision and eulogy anchor every goal.', h: '#/foundation' });
    if (!state.roles.length)
      out.push({ t: 'Identify your roles', d: 'Parent, spouse, professional, friend… each gets a WHY.', h: '#/goals' });
    if (!cyc) {
      out.push({ t: 'Hold a planning session', d: 'No goal cycle covers today. Set your next 10–12 goals.', h: '#/goals' });
    } else {
      const n = cycleGoals(cyc.id, true).length;
      if (n < 10) out.push({ t: `Set goals for ${esc(cyc.name)}`, d: `${n} so far. Aim for 10–12 across your roles.`, h: '#/goals' });
      const left = U.daysBetween(t, U.parseISO(cyc.end));
      if (left <= 14) out.push({ t: 'Cycle review & next planning session', d: `${left} day${left === 1 ? '' : 's'} left in this cycle.`, h: '#/goals', hot: true });
      else {
        const s = U.parseISO(cyc.start);
        for (let q = 3; ; q += 3) {
          const qd = new Date(s.getFullYear(), s.getMonth() + q, s.getDate());
          if (U.toISO(qd) >= cyc.end) break;
          if (Math.abs(U.daysBetween(t, qd)) <= 7) { out.push({ t: 'Quarterly check-in', d: 'Revisit every goal: progress, adjust, recommit.', h: '#/goals', hot: true }); break; }
        }
      }
    }
    const lastWheel = state.wheel.map((x) => x.date).sort().pop();
    if (state.cycles.length && (!lastWheel || U.daysBetween(U.parseISO(lastWheel), t) >= 90))
      out.push({ t: 'Wheel of Life check-in', d: 'Score the seven areas of your life and see how balanced you are.', h: '#/wheel' });
    const m = state.months[mk];
    if (!m || !(m.actions || []).length)
      out.push({ t: `Plan ${U.MONTHS[t.getMonth()]}`, d: 'Choose priority actions for each area, linked to your goals.', h: `#/month/${mk}` });
    if (t.getDate() > U.daysInMonth(t.getFullYear(), t.getMonth()) - 4 && !(m && m.reflection && m.reflection.progress))
      out.push({ t: 'End-of-month reflection', d: 'Goals & progress, areas to improve, memories created.', h: `#/month/${mk}`, hot: true });
    const w = state.weeks[wk];
    if (!w || !(w.actions || []).length)
      out.push({ t: 'Plan this week', d: 'Pick priority actions that move your goals forward.', h: `#/week/${wk}` });
    if (U.daysBetween(U.parseISO(wk), t) >= 5 && !(w && w.rating))
      out.push({ t: 'Weekly review', d: 'Check goal pulse, habits, and rate your week.', h: `#/week/${wk}`, hot: true });
    return out;
  }

  /* ---------- notifications ---------- */
  function isInQuietHours() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const t = h + ':' + m;
    const start = state.settings.quietStart || '20:00';
    const end = state.settings.quietEnd || '08:00';
    if (start < end) return t >= start && t < end;
    return t >= start || t < end;
  }

  function sendNotification(title, options = {}) {
    if (!state.settings.notificationsEnabled || typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    if (isInQuietHours()) return;
    const key = title + (options.tag || '');
    const now = Date.now();
    const lastTime = state.lastNotifications[key] || 0;
    if (now - lastTime < 3600000) return;
    state.lastNotifications[key] = now;
    try { new Notification(title, Object.assign({ tag: key, icon: 'icons/icon-192.png' }, options)); }
    catch (e) { console.warn('Notification failed', e); }
  }

  function checkNotifications() {
    if (!state.settings.notificationsEnabled || typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') {
          toast('Notifications enabled! Check Settings to configure.');
          state.settings.notificationsEnabled = true;
          S.save(state);
        }
      });
      return;
    }
    if (Notification.permission !== 'granted') return;
    const due = rituals();
    if (due.length > 0) {
      const hot = due.find((r) => r.hot);
      if (hot) sendNotification('🔥 ' + hot.t, { body: hot.d });
      else sendNotification('📋 ' + due[0].t, { body: due[0].d });
    }
  }

  /* ---------- backend integration ---------- */
  async function syncGoogleCalendar() {
    const token = localStorage.getItem('google_access_token');
    if (!token) return [];
    try {
      const iso = U.toISO(today());
      const monthStart = U.toISO(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
      const monthEnd = U.toISO(U.addDays(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), 1));
      const res = await fetch(`${API_BASE}/api/calendar/events?accessToken=${token}&from=${monthStart}&to=${monthEnd}`);
      const { events } = await res.json();
      return events || [];
    } catch (e) { console.warn('Calendar sync error:', e); return []; }
  }

  /* Phone photos can exceed the host's request limit, so downscale to a JPEG first. */
  async function shrinkImage(file, maxDim = 1800) {
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
      return blob || file;
    } catch (e) { return file; }
  }

  async function uploadPhotoOCR(file) {
    const fd = new FormData();
    fd.append('image', await shrinkImage(file), 'photo.jpg');
    fd.append('type', 'auto');
    const res = await fetch(`${API_BASE}/api/ocr/analyze`, { method: 'POST', body: fd });
    if (!res.ok) {
      let msg = `Server error ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch (e) { /* non-JSON error body */ }
      throw new Error(msg);
    }
    return res.json();
  }

  async function startGoogleOAuth() {
    try {
      const res = await fetch(`${API_BASE}/api/auth/google/url`);
      const { url } = await res.json();
      window.location = url;
    } catch (e) { console.error('OAuth error:', e); toast('Failed to start login'); }
  }

  async function pushToGoogleCalendar(items) {
    const token = localStorage.getItem('google_access_token');
    if (!token) { toast('Connect Google Calendar in Settings first'); return; }
    let ok = 0;
    for (const e of items) {
      if (!e.date || !e.text) continue;
      const event = { text: e.text, date: e.date };
      if (e.time) {
        const start = new Date(`${e.date}T${e.time}`);
        if (!isNaN(start)) { event.start = start.toISOString(); event.end = new Date(start.getTime() + 3600000).toISOString(); }
      }
      try {
        const r = await fetch(`${API_BASE}/api/calendar/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: token, event }) });
        if (r.ok) ok++;
      } catch (err) { console.warn('Calendar create failed', err); }
    }
    toast(ok ? `Created ${ok} calendar event${ok === 1 ? '' : 's'}` : 'Could not create calendar events');
  }

  function addOCRDataToApp(route, data) {
    try {
      switch (route) {
        case 'schedule':
          data.entries.forEach(e => {
            if (e.date && e.text) state.schedule.push({ id: S.uid(), date: e.date, time: e.time || '', text: e.text });
          });
          break;
        case 'goals':
          data.goals.forEach(g => {
            const cyc = currentCycle() || state.cycles[state.cycles.length - 1];
            if (cyc && g.title) state.goals.push({
              id: S.uid(), cycleId: cyc.id, roleId: state.roles[0]?.id || '',
              title: g.title, why: g.why || '', area: g.area || 'work', tier: 'pursuit',
              progress: 0, status: 'active', target: g.target || '', doneBy: g.target || ''
            });
          });
          break;
        case 'workouts':
          data.workouts.forEach(w => {
            if (w.date && w.type) state.workouts.push({
              id: S.uid(), date: w.date, type: w.type, done: false, details: w.details || '',
              minutes: w.minutes || ''
            });
          });
          break;
        case 'weights':
          data.weights.forEach(w => {
            if (w.date && w.value) state.weights.push({ id: S.uid(), date: w.date, value: w.value });
          });
          break;
        case 'habits':
          const wk = U.weekKey(today(), ws());
          const week = getWeek(wk);
          data.habits.forEach(h => {
            if (h.name && !week.habits.find(x => x.name === h.name)) {
              week.habits.push({ id: S.uid(), name: h.name, target: h.target || 5, days: [false, false, false, false, false, false, false] });
            }
          });
          break;
        case 'shopping':
          data.items.forEach(i => { if (i.text) state.shopping.push({ id: S.uid(), text: i.text, done: false }); });
          break;
        case 'journal':
          if (data.text) state.journals.push({ id: S.uid(), date: todayISO(), text: data.text });
          break;
        case 'bucket':
          data.items.forEach(i => {
            if (i.text) state.bucket.push({ id: S.uid(), text: i.text, star: false, done: false, budget: i.budget || '', target: i.target || '', details: '' });
          });
          break;
        case 'reading':
          data.items.forEach(i => {
            if (i.title) state.reading.push({ id: S.uid(), title: i.title, by: i.by || '', genre: i.genre || '', nutshell: '', done: false });
          });
          break;
        case 'projects':
          data.projects.forEach(p => {
            if (p.name) state.projects.push({
              id: S.uid(), name: p.name, status: 'active', goalId: '', notes: '',
              steps: (p.steps || []).map(s => ({ id: S.uid(), text: s.text || s, done: false }))
            });
          });
          break;
        case 'events':
          data.events.forEach(e => {
            if (e.date && e.text) state.events.push({
              id: S.uid(), start: e.date, end: e.date, text: e.text, yearly: e.yearly || false
            });
          });
          break;
        case 'calendar':
          pushToGoogleCalendar(data.entries || data.events || []);
          return;
      }
      commit();
      toast(`Added to ${route}`);
    } catch (e) { console.error('Data add error:', e); toast('Failed to add data'); }
  }

  /* ---------- views ---------- */
  function viewToday() {
    const t = today(), iso = U.toISO(t), wk = U.weekKey(t, ws()), mk = U.monthKey(t);
    const wom = U.weekOfMonth(U.parseISO(wk));
    const wkEnd = U.toISO(U.addDays(U.parseISO(wk), 6));
    const cyc = cycleAt(iso);
    const goals = cyc ? cycleGoals(cyc.id) : [];
    const week = state.weeks[wk];
    const due = rituals();
    const vision = state.foundation.vision.trim();
    const tks = trackers();
    const pending = (key) => goals.flatMap((g) => (g[key] || []).filter((i) => !i.done && i.text)
      .map((i) => ({ text: i.text, due: i.due, goal: g.title, base: `goals.@${g.id}.${key}.@${i.id}` })))
      .sort((a, b) => ((a.due || '9') < (b.due || '9') ? -1 : 1));
    const openObjs = pending('objectives').slice(0, 6);
    const nextMs = pending('milestones').slice(0, 4);

    const upcoming = state.events
      .map((e) => ({ e, on: U.nextOccurrence(e, iso) }))
      .filter((x) => x.on && U.daysBetween(t, U.parseISO(x.on)) <= 45)
      .sort((a, b) => (a.on < b.on ? -1 : 1)).slice(0, 8);

    const weekActs = week ? week.actions : [];
    const openActs = weekActs.filter((a) => !a.done);
    const todayEvents = U.eventsOn(state.events, iso);
    const todaySched = scheduleOn(iso);
    const todayWos = state.workouts.filter((x) => x.date === iso);
    const wkWos = state.workouts.filter((x) => x.date >= wk && x.date <= wkEnd);
    const weights = state.weights.filter((w) => num(w.value) != null).sort((a, b) => (a.date < b.date ? -1 : 1));
    const lastW = weights[weights.length - 1];
    const unit = state.settings.weightUnit || 'lbs';
    const goalW = num(state.settings.weightGoal);
    const shopOpen = state.shopping.filter((x) => !x.done).length;

    const body = `
      ${vision ? `<blockquote class="vision"><span>Who I'm becoming</span>${esc(vision.split('\n')[0])}</blockquote>` : ''}
      ${!tks.length && cyc ? `<section class="box"><h2>Habits &amp; routines</h2><p class="muted">Nothing to check off yet. <a href="#/goals">Add a habit goal</a> (like "Read a book, 7 days a week") and it will appear here each day.</p></section>` : ''}
      ${tks.length ? `<section class="box">
        <h2>Habits &amp; routines <span class="muted">· ${tks.filter((k) => k.log[iso]).length}/${tks.length} done today</span><a class="more" href="#/track/habits">Progress →</a></h2>
        <ul class="trackers">${tks.map((k) => trackerRow(k, wk, iso)).join('')}</ul>
      </section>` : ''}
      ${openObjs.length || nextMs.length ? `<section class="box">
        <h2>Milestones &amp; objectives <a class="more" href="#/goals">Plan →</a></h2>
        <ul class="checks compact">${nextMs.map((x) => `<li>${chk(`${x.base}.done`, 'Done')}<span class="grow"><strong>Milestone:</strong> ${esc(x.text)} <small class="muted">${esc(x.goal)}${x.due ? ` · due ${U.fmtDate(x.due, { month: 'short', day: 'numeric' })}` : ''}</small></span></li>`).join('')}
          ${openObjs.map((x) => `<li>${chk(`${x.base}.done`, 'Done')}<span class="grow">${esc(x.text)} <small class="muted">${esc(x.goal)}${x.due ? ` · due ${U.fmtDate(x.due, { month: 'short', day: 'numeric' })}` : ''}</small></span></li>`).join('')}</ul>
      </section>` : ''}
      <div class="grid2">
        <section class="box">
          <h2>Today's plan <a class="more" href="#/week/${wk}">Schedule →</a></h2>
          ${todayEvents.length ? `<ul class="events">${todayEvents.map((e) => `<li><time>All day</time> ${esc(e.text)}</li>`).join('')}</ul>` : ''}
          ${todaySched.length ? `<ul class="events">${todaySched.map((s) => `<li><time>${esc(fmtTime(s.time)) || '—'}</time> ${esc(s.text)}</li>`).join('')}</ul>` : ''}
          ${todayWos.length ? `<ul class="checks compact">${todayWos.map((x) => `<li>${chk(`workouts.@${x.id}.done`, 'Workout done')}<span class="grow">${x.time ? `<time>${esc(fmtTime(x.time))}</time> ` : ''}Workout: ${esc(x.type)}${x.details ? ` <small class="muted">${esc(x.details)}</small>` : ''}</span></li>`).join('')}</ul>` : ''}
          ${!todayEvents.length && !todaySched.length && !todayWos.length ? '<p class="muted">Nothing scheduled. Add appointments and workouts on the Week page.</p>' : ''}
          <form class="add" data-add="schedule"><input type="hidden" name="date" value="${iso}"><input type="time" name="time" aria-label="Time"><input name="text" placeholder="Add to today…" required><button aria-label="Add">+</button></form>
        </section>
        <section class="box">
          <h2>Rituals due</h2>
          ${due.length ? `<ul class="rituals">${due.map((r) => `<li class="${r.hot ? 'hot' : ''}"><a href="${r.h}"><strong>${r.t}</strong><span>${r.d}</span></a></li>`).join('')}</ul>`
            : '<p class="muted">You\'re caught up. Go live it.</p>'}
        </section>
      </div>
      <div class="tiles">
        <a class="tile" href="#/week/${wk}"><span>Priority actions</span><strong>${weekActs.length - openActs.length}/${weekActs.length}</strong><small>this week</small></a>
        <a class="tile" href="#/track/workouts"><span>Workouts</span><strong>${wkWos.filter((x) => x.done).length}/${Number(state.settings.workoutTarget) || wkWos.length}</strong><small>this week</small></a>
        <a class="tile" href="#/track/weight"><span>Weight</span><strong>${lastW ? lastW.value : '—'}</strong><small>${lastW ? `${unit}${goalW != null ? ` · ${round1(Math.abs(lastW.value - goalW))} to go` : ''}` : 'log your first entry'}</small></a>
        <a class="tile" href="#/lists/shopping"><span>Shopping</span><strong>${shopOpen}</strong><small>item${shopOpen === 1 ? '' : 's'} to buy</small></a>
      </div>
      <div class="grid2">
        <section class="box">
          <h2>This week <a class="more" href="#/week/${wk}">Week ${wom.n} of ${U.MONTHS[wom.month]} →</a></h2>
          ${openActs.length ? `<ul class="checks compact">${openActs.slice(0, 8).map((a) => `<li>${chk(`weeks.${wk}.actions.@${a.id}.done`)}<span class="grow">${esc(a.text)} <small class="muted">${areaName(a.area)}</small></span></li>`).join('')}</ul>`
            : `<p class="muted">${weekActs.length ? 'All priority actions done. 🎉' : 'No priority actions yet.'}</p>`}
          ${week && week.habits.length ? `<h3>Habits</h3><ul class="habit-sum">${week.habits.map((h) => {
            const n = h.days.filter(Boolean).length;
            const di = U.daysBetween(U.parseISO(wk), t);
            return `<li><label class="inline-check">${chk(`weeks.${wk}.habits.@${h.id}.days.${di}`, `${h.name} today`)} ${esc(h.name)}</label><span class="${n >= (h.target || 7) ? 'ok' : ''}">${n}/${h.target || 7}</span></li>`;
          }).join('')}</ul><p class="muted small">Tick a habit to mark it done today.</p>` : ''}
        </section>
        <section class="box">
          <h2>Coming up <a class="more" href="#/year">Year →</a></h2>
          ${upcoming.length ? `<ul class="events">${upcoming.map((x) => `<li><time>${U.fmtDate(x.on, { weekday: 'short', month: 'short', day: 'numeric' })}</time> ${esc(x.e.text)}${x.e.yearly ? ' <span title="Yearly">↻</span>' : ''}</li>`).join('')}</ul>`
            : '<p class="muted">Nothing in the next 45 days. Add key dates on the Year page.</p>'}
        </section>
      </div>
      <section class="box">
        <h2>Goals ${cyc ? `<span class="muted">· ${esc(cyc.name)} · ${U.daysBetween(t, U.parseISO(cyc.end))} days left</span>` : ''}<a class="more" href="#/track/goals">Progress →</a></h2>
        ${goals.length ? `<table class="goals-table"><thead><tr><th>Goal</th><th>Role</th><th>Progress</th><th>Month</th><th>Week</th><th>Pulse</th></tr></thead><tbody>
          ${goals.map((g) => {
            const a = goalActivity(g.id, mk, wk);
            const pulse = week && week.pulse[g.id];
            const cold = a.month.total === 0 && a.week.total === 0;
            return `<tr class="${cold ? 'cold' : ''}">
              <td>${g.tier === 'purpose' ? '<span class="star" title="Purpose goal">★</span> ' : ''}${esc(g.title)}${cold ? '<small class="warn">no actions planned</small>' : ''}</td>
              <td data-label="Role">${esc(roleName(g.roleId))}</td>
              <td data-label="Progress">${progressBar(g.progress)} <small>${Number(g.progress) || 0}%</small></td>
              <td data-label="Month">${a.month.done}/${a.month.total}</td><td data-label="Week">${a.week.done}/${a.week.total}</td>
              <td data-label="Pulse">${pulse ? `<span class="pulse ${pulse}">${{ on: 'On track', slip: 'Slipping', off: 'Stalled' }[pulse]}</span>` : '<span class="muted">—</span>'}</td></tr>`;
          }).join('')}</tbody></table>` : `<p class="muted">No active goals. <a href="#/goals">Hold a planning session →</a></p>`}
      </section>
      <section class="box">
        <h2>Today's journal <a class="more" href="#/lists/journal">All entries →</a></h2>
        ${state.journals.find((j) => j.date === iso) ? `<form class="add" data-add="journals"><input type="hidden" name="date" value="${iso}"><textarea name="text" rows="3" placeholder="Add to today's thoughts…"></textarea><button aria-label="Save">+</button></form>` : `<form class="add" data-add="journals"><input type="hidden" name="date" value="${iso}"><textarea name="text" rows="3" placeholder="Today's thoughts and reflections…"></textarea><button aria-label="Save">+</button></form>`}
      </section>`;
    return page('Today', U.fmtDate(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), body);
  }

  function viewFoundation() {
    const f = 'foundation';
    const body = `
      <p class="lead">Start with the end in mind. Everything else in Life.OS (roles, goals, monthly and weekly actions) should trace back to this page.</p>
      <section class="box"><h2>The person I'm becoming <small class="muted">5–10 years</small></h2>
        <p class="prompt">Describe who you are in 5–10 years: character, relationships, health, faith, work. Write in the present tense.</p>
        ${ta(f + '.vision', 'I am…', 6)}</section>
      <section class="box"><h2>My eulogy</h2>
        <p class="prompt">What do you hope your family, friends, colleagues and community will say about you at your funeral?</p>
        ${ta(f + '.eulogy', 'He was…', 6)}</section>
      <div class="grid2">
        <section class="box"><h2>Personal mission</h2>
          <p class="prompt">One or two sentences: why you're here and how you'll spend your life.</p>
          ${ta(f + '.mission', '', 4)}</section>
        <section class="box"><h2>Core values</h2>
          <p class="prompt">The few principles you won't trade away. One per line.</p>
          ${ta(f + '.values', 'Faith\nFamily first\n…', 4)}</section>
      </div>
      <section class="box"><h2>Roles <a class="more" href="#/goals">Edit roles & goals →</a></h2>
        ${state.roles.length ? `<ul class="roles-sum">${state.roles.map((r) => `<li><strong>${esc(r.name)}</strong>${r.why ? `: ${esc(r.why)}` : ''}</li>`).join('')}</ul>`
          : '<p class="muted">No roles yet.</p>'}
      </section>`;
    return page('Foundation', 'Purpose first. Revisit at every planning session.', body);
  }

  function viewGoals(cid) {
    if (!state.cycles.length) {
      const t = today();
      const start = U.toISO(new Date(t.getFullYear(), t.getMonth(), 1));
      return page('Roles & Goals', 'Your planning session', `
        <section class="box hero">
          <h2>Start your first planning session</h2>
          <ol class="steps"><li>Set out the roles that define your life (personal, professional, communal).</li>
            <li>Establish your <em>WHY</em> for each role.</li>
            <li>Set clear goals for each role: 10–12 in total for the cycle.</li>
            <li>Commit to monthly, weekly & daily actions that move you toward them.</li></ol>
          <form class="row" data-act-form="newCycle">
            <label>Cycle starts <input type="date" name="start" value="${start}" required></label>
            <label>Length <select name="months">${opts([{ v: 6, l: '6 months (bi-annual)' }, { v: 3, l: '3 months (quarterly)' }], state.settings.cycleMonths)}</select></label>
            <button class="primary">Create cycle</button>
          </form>
        </section>`);
    }
    const cyc = state.cycles.find((c) => c.id === cid) || currentCycle();
    const cp = `cycles.@${cyc.id}`;
    const all = cycleGoals(cyc.id, true);
    const n = all.length;
    const meterCls = n >= 10 && n <= 12 ? 'ok' : n > 12 ? 'over' : '';
    const groups = state.roles.map((r) => ({ role: r, goals: all.filter((g) => g.roleId === r.id) }));
    const orphan = all.filter((g) => !state.roles.some((r) => r.id === g.roleId));

    const goalRow = (g) => {
      const p = `goals.@${g.id}`;
      return `<div class="goal ${g.status}">
        <div class="goal-main">
          <select data-bind="${p}.tier" data-rerender class="tier" aria-label="Tier">${tierOpts(g.tier)}</select>
          <select data-bind="${p}.kind" data-rerender class="tier" aria-label="Goal type">${opts([{ v: 'achievement', l: 'Achievement' }, { v: 'habit', l: 'Habit' }], g.kind || 'achievement')}</select>
          <input class="inline title" data-bind="${p}.title" value="${esc(g.title)}" aria-label="Goal">
          <button class="x" data-act="del" data-path="goals" data-id="${g.id}" aria-label="Delete goal">×</button>
        </div>
        <div class="goal-meta">
          <label>Area <select data-bind="${p}.area" aria-label="Area">${areaOpts(g.area)}</select></label>
          <label>Target <input type="date" data-bind="${p}.target" value="${esc(g.target)}"></label>
          <label>Done by <input type="date" data-bind="${p}.doneBy" value="${esc(g.doneBy)}"></label>
          <label>Status <select data-bind="${p}.status" data-rerender>${opts([{ v: 'active', l: 'Active' }, { v: 'done', l: 'Done ✓' }, { v: 'dropped', l: 'Dropped' }], g.status)}</select></label>
          <label class="prog">Progress <input type="range" min="0" max="100" step="5" data-bind="${p}.progress" data-type="number" value="${Number(g.progress) || 0}"><output>${Number(g.progress) || 0}%</output></label>
        </div>
        <input class="inline measure" data-bind="${p}.measure" value="${esc(g.measure)}" placeholder="${g.kind === 'habit' ? 'What counts? (e.g. 20+ minutes, no phone)' : 'What does done look like? (be specific)'}">
        ${goalPlan(g, p)}
      </div>`;
    };
    const habitPerWeek = (p, cur) => `<label>Days per week <select data-bind="${p}.perWeek" data-type="number" data-rerender>${opts([1, 2, 3, 4, 5, 6, 7].map((n) => ({ v: n, l: n === 7 ? '7 (every day)' : String(n) })), cur)}</select></label>`;
    const goalPlan = (g, p) => {
      const isHabit = g.kind === 'habit';
      const list = (key, ph, extra) => `<ul class="checks compact">${(g[key] || []).map((i) => `<li class="${i.done ? 'done' : ''}">${chk(`${p}.${key}.@${i.id}.done`, 'Done')}
          <input class="inline grow" data-bind="${p}.${key}.@${i.id}.text" value="${esc(i.text)}" aria-label="${ph}">
          <input type="date" data-bind="${p}.${key}.@${i.id}.due" value="${esc(i.due)}" aria-label="Due date">
          <button class="x" data-act="del" data-path="${p}.${key}" data-id="${i.id}" aria-label="Remove">×</button></li>`).join('')}</ul>
        <form class="add" data-add="${p}.${key}"><input name="text" placeholder="${ph}" required><input type="date" name="due" aria-label="Due date"><button aria-label="Add">+</button></form>`;
      const routines = `<ul class="checks compact">${(g.routines || []).map((r) => `<li>
          <input class="inline grow" data-bind="${p}.routines.@${r.id}.text" value="${esc(r.text)}" aria-label="Routine">
          <select data-bind="${p}.routines.@${r.id}.perWeek" data-type="number" data-rerender aria-label="Days per week">${opts([1, 2, 3, 4, 5, 6, 7].map((n) => ({ v: n, l: n === 7 ? 'Every day' : n === 1 ? 'Once a week' : `${n}× a week` })), r.perWeek)}</select>
          <button class="x" data-act="del" data-path="${p}.routines" data-id="${r.id}" aria-label="Remove">×</button></li>`).join('')}</ul>
        <form class="add" data-add="${p}.routines"><input name="text" placeholder="e.g. Practice 20 minutes" required>
          <select name="perWeek" aria-label="How often">${opts([1, 2, 3, 4, 5, 6, 7].map((n) => ({ v: n, l: n === 7 ? 'Every day' : n === 1 ? 'Once a week' : `${n}× a week` })), 1)}</select><button aria-label="Add">+</button></form>`;
      const why = `<label class="field">My WHY for this goal ${ta(`${p}.why`, 'Why does this matter to me?', 2)}</label>`;
      if (isHabit) return `<details class="plan" open><summary>Plan &amp; tracking</summary>${why}
        <div class="goal-meta">${habitPerWeek(p, g.perWeek || 5)}</div>
        <p class="muted small">Tick it off each day on <a href="#/today">Today</a>. Progress appears on <a href="#/track/habits">Track → Habits</a>.</p></details>`;
      return `<details class="plan" open><summary>Plan: why → milestones → objectives → routines</summary>${why}
        <h4>1. Key milestones</h4>${list('milestones', 'Add a milestone…')}
        <h4>2. Quarterly objectives <small class="muted">what must be true by the end of this cycle</small></h4>${list('objectives', 'Add an objective…')}
        <h4>3. Weekly &amp; daily routines <small class="muted">tracked on Today</small></h4>${routines}</details>`;
    };
    const addGoal = (roleId) => `<form class="add" data-add="goals">
        <input type="hidden" name="cycleId" value="${cyc.id}"><input type="hidden" name="roleId" value="${roleId}"><input type="hidden" name="kind" value="achievement">
        <input name="title" placeholder="New achievement goal (e.g. Run a half marathon)…" required>
        <select name="area" aria-label="Area">${areaOpts('work')}</select>
        <select name="tier" aria-label="Tier">${tierOpts('pursuit')}</select>
        <button aria-label="Add goal">+</button></form>
      <form class="add habit-add" data-add="goals">
        <input type="hidden" name="cycleId" value="${cyc.id}"><input type="hidden" name="roleId" value="${roleId}"><input type="hidden" name="kind" value="habit">
        <input type="hidden" name="area" value="health"><input type="hidden" name="tier" value="pursuit">
        <input name="title" placeholder="New habit goal (e.g. Read a book)…" required>
        <select name="perWeek" aria-label="Days per week">${opts([1, 2, 3, 4, 5, 6, 7].map((n) => ({ v: n, l: n === 7 ? 'Every day' : `${n}× a week` })), 5)}</select>
        <button aria-label="Add habit goal">+ Habit</button></form>`;

    const roleCard = ({ role, goals }) => {
      const rp = `roles.@${role.id}`;
      const ap = `${cp}.roleActions.${role.id}`;
      return `<section class="box role">
        <div class="role-head"><span class="label">Role</span>
          <input class="inline role-name" data-bind="${rp}.name" value="${esc(role.name)}" aria-label="Role name">
          <button class="x" data-act="delRole" data-id="${role.id}" aria-label="Delete role">×</button></div>
        <label class="field">Establish your WHY. The underlying reasons this role matters.
          ${ta(rp + '.why', '', 2)}</label>
        <h3>Goals <small class="muted">${goals.length}${goals.length > 5 ? ' · the planner has 5 lines per role' : ''}</small></h3>
        ${goals.map(goalRow).join('')}
        ${addGoal(role.id)}
        <h3>Actions that move you toward these goals</h3>
        <div class="grid3">
          <label class="field">Monthly ${ta(ap + '.monthly', 'e.g. Pick a skill or focus area for the month', 3)}</label>
          <label class="field">Weekly ${ta(ap + '.weekly', 'e.g. Write down the activity and assign it a day', 3)}</label>
          <label class="field">Daily ${ta(ap + '.daily', 'e.g. Do the activity', 3)}</label>
        </div>
      </section>`;
    };

    const body = `
      <section class="box cycle-bar">
        <label>Cycle <select data-nav aria-label="Choose cycle">${opts(state.cycles.slice().sort((a, b) => (a.start < b.start ? 1 : -1)).map((c) => ({ v: `#/goals/${c.id}`, l: c.name })), `#/goals/${cyc.id}`)}</select></label>
        <label>Name ${inp(cp + '.name')}</label>
        <label>Start ${inp(cp + '.start', '', 'date')}</label>
        <label>End ${inp(cp + '.end', '', 'date')}</label>
        <div class="meter ${meterCls}" title="Aim for 10–12 goals per cycle"><strong>${n}</strong> goals<br><small>aim 10–12</small></div>
      </section>
      ${state.foundation.vision ? `<blockquote class="vision small"><span>Who I'm becoming</span>${esc(state.foundation.vision.split('\n')[0])}</blockquote>` : `<p class="nudge">Tip: <a href="#/foundation">write your vision & eulogy</a> first. Goals should flow from them.</p>`}
      ${groups.map(roleCard).join('')}
      ${orphan.length ? `<section class="box role"><h3>Goals without a role</h3>${orphan.map(goalRow).join('')}</section>` : ''}
      <section class="box">
        <h2>Add a role</h2>
        <form class="add" data-add="roles"><input name="name" placeholder="e.g. Parent, Husband, Engineer, Friend, Healthy person" required><button aria-label="Add role">+</button></form>
        ${!state.roles.length ? addGoal('') : ''}
      </section>
      <section class="box">
        <h2>Review & adjust <small class="muted">quarterly check-ins and end of cycle</small></h2>
        <div class="grid3">
          <label class="field">Wins & progress ${ta(cp + '.review.wins', '', 4)}</label>
          <label class="field">Lessons learned ${ta(cp + '.review.lessons', '', 4)}</label>
          <label class="field">Adjustments / recommit ${ta(cp + '.review.adjust', '', 4)}</label>
        </div>
        <div class="row end">
          <button data-act="delCycle" data-id="${cyc.id}" class="ghost">Delete cycle</button>
          <button data-act="nextCycle" data-id="${cyc.id}" class="primary">Start next cycle →</button>
        </div>
      </section>`;
    return page('Roles & Goals', 'Roles → WHY → goals → actions', body);
  }

  function viewYear(y) {
    const sm = Number(state.settings.plannerStartMonth);
    const start = y ? { year: Number(y), month: sm } : U.plannerYearStart(today(), sm);
    const months = U.plannerMonths(start.year, start.month);
    const body = `
      <section class="box">
        <h2>Add a key date</h2>
        <p class="prompt">Birthdays, holidays, trips, conferences, reunions. Pencil it in so you're always prepared.</p>
        <form class="add wrap" data-add="events">
          <input name="text" placeholder="What" required>
          <label>From <input type="date" name="start" required></label>
          <label>To <input type="date" name="end"></label>
          <label class="inline-check"><input type="checkbox" name="yearly"> Every year</label>
          <button aria-label="Add key date">+</button>
        </form>
      </section>
      <div class="year-grid">${months.map((m) => {
        const days = U.daysInMonth(Number(m.key.slice(0, 4)), Number(m.key.slice(5)) - 1);
        const evs = state.events.filter((e) => {
          for (let d = 1; d <= days; d++) if (U.eventOn(e, `${m.key}-${U.pad(d)}`)) return true;
          return false;
        }).sort((a, b) => (a.start.slice(5) < b.start.slice(5) ? -1 : 1));
        const mo = state.months[m.key];
        return `<section class="box month-card">
          <h3><span class="mnum">M${m.index}</span> <a href="#/month/${m.key}">${m.name} ${m.year}</a></h3>
          <ul class="events">${evs.map((e) => `<li><time>${U.fmtDate(e.start)}${e.end && e.end !== e.start ? `–${U.fmtDate(e.end)}` : ''}</time> ${esc(e.text)}${e.yearly ? ' <span title="Yearly">↻</span>' : ''}
            <button class="x" data-act="del" data-path="events" data-id="${e.id}" aria-label="Remove">×</button></li>`).join('')}</ul>
          ${mo || true ? `<label class="field small">Planning notes<textarea data-bind="months.${m.key}.notes" rows="2">${esc(mo && mo.notes)}</textarea></label>` : ''}
        </section>`;
      }).join('')}</div>`;
    const nav = `<a class="btn ghost" href="#/year/${start.year - 1}">←</a><a class="btn ghost" href="#/year/${start.year + 1}">→</a>`;
    return page('Annual Overview', `${months[0].name} ${months[0].year} – ${months[11].name} ${months[11].year}`, body, nav);
  }

  function viewMonth(mk) {
    mk = mk || U.monthKey(today());
    const m = getMonth(mk);
    const md = U.parseMonthKey(mk);
    const mid = U.toISO(new Date(md.getFullYear(), md.getMonth(), 15));
    const cyc = cycleAt(mid) || currentCycle();
    const goals = cyc ? cycleGoals(cyc.id) : [];
    const grid = U.monthGrid(mk, ws());
    const tIso = todayISO();
    const dayNames = Array.from({ length: 7 }, (_, i) => U.DAYS[(i + ws()) % 7]);
    const base = `months.${mk}`;
    const roleMonthly = cyc ? state.roles.map((r) => ({ r, t: get(`cycles.@${cyc.id}.roleActions.${r.id}.monthly`) })).filter((x) => x.t) : [];

    const monthEvents = [];
    for (let i = 1; i <= U.daysInMonth(md.getFullYear(), md.getMonth()); i++) {
      const iso = `${mk}-${U.pad(i)}`;
      U.eventsOn(state.events, iso).forEach((e) => { if (!monthEvents.some((x) => x.e === e)) monthEvents.push({ e, on: iso }); });
    }
    const cal = `<div class="cal-wrap"><table class="cal">
      <thead><tr><th class="wk"></th>${dayNames.map((d) => `<th><span class="long">${d}</span><span class="short">${d.slice(0, 3)}</span></th>`).join('')}</tr></thead>
      <tbody>${grid.map((row) => {
        const wom = U.weekOfMonth(row[0]);
        const wkey = U.toISO(row[0]);
        return `<tr><th class="wk"><a href="#/week/${wkey}" title="Open week">${wom.monthKey === mk ? 'W' + wom.n : '→'}</a></th>${row.map((d) => {
          const iso = U.toISO(d);
          const evs = U.eventsOn(state.events, iso);
          const out = U.monthKey(d) !== mk;
          return `<td class="${out ? 'out' : ''} ${iso === tIso ? 'today' : ''}"><a class="dnum" href="#/week/${wkey}">${d.getDate()}</a>
            ${evs.map((e) => `<div class="ev" title="${esc(e.text)}"><span>${esc(e.text)}</span></div>`).join('')}</td>`;
        }).join('')}</tr>`;
      }).join('')}</tbody></table></div>`;

    const body = `
      <section class="box">${cal}
        ${monthEvents.length ? `<ul class="events month-events">${monthEvents.map((x) => `<li><time>${U.fmtDate(x.on, { weekday: 'short', month: 'short', day: 'numeric' })}</time> ${esc(x.e.text)}</li>`).join('')}</ul>` : ''}
        <p class="muted small">Add key dates on the <a href="#/year">Annual Overview</a>; they appear here automatically.</p></section>
      <h2 class="section">Goals & Priority Actions for the Month ${cyc ? `<small class="muted">· ${esc(cyc.name)}</small>` : ''}</h2>
      ${roleMonthly.length ? `<div class="nudge role-nudge"><strong>Your monthly role commitments:</strong> ${roleMonthly.map((x) => `<span><em>${esc(x.r.name)}:</em> ${esc(x.t)}</span>`).join(' · ')}</div>` : ''}
      ${areaBoxes(base + '.actions', m.actions, goals)}
      <div class="grid3">
        <section class="box"><h3>Ideas & Lessons</h3>${ta(base + '.ideas', '', 5)}</section>
        <section class="box"><h3>Reasons to Be Grateful</h3>${ta(base + '.grateful', '', 5)}</section>
        <section class="box"><h3>Strengths & Affirmations</h3>${ta(base + '.strengths', '', 5)}</section>
      </div>
      <h2 class="section">Reflections for the Month</h2>
      ${goals.length ? `<div class="box"><h3>Goal progress this month</h3><ul class="goal-prog">${goals.map((g) => {
        const a = goalActivity(g.id, mk, '');
        return `<li><span class="grow">${g.tier === 'purpose' ? '★ ' : ''}${esc(g.title)}</span><small class="muted">${a.month.done}/${a.month.total} actions</small>
          <input type="range" min="0" max="100" step="5" data-bind="goals.@${g.id}.progress" data-type="number" value="${Number(g.progress) || 0}" aria-label="Progress"><output>${Number(g.progress) || 0}%</output></li>`;
      }).join('')}</ul></div>` : ''}
      <div class="grid3">
        <section class="box"><h3>Goals & Progress</h3>${ta(base + '.reflection.progress', '', 5)}</section>
        <section class="box"><h3>Areas to Improve</h3>${ta(base + '.reflection.improve', '', 5)}</section>
        <section class="box"><h3>Memories Created</h3>${ta(base + '.reflection.memories', '', 5)}</section>
      </div>`;
    const prev = U.monthKey(U.addMonths(md, -1)), next = U.monthKey(U.addMonths(md, 1));
    const nav = `<a class="btn ghost" href="#/month/${prev}" aria-label="Previous month">←</a>
      <a class="btn ghost" href="#/month/${U.monthKey(today())}">This month</a>
      <a class="btn ghost" href="#/month/${next}" aria-label="Next month">→</a>
      <button class="btn" data-act="copyMonth" data-key="${mk}">Copy for planner</button>`;
    return page(`${U.MONTHS[md.getMonth()]} ${md.getFullYear()}`, 'Monthly calendar & goals', body, nav);
  }

  function viewWeek(wk) {
    wk = wk || U.weekKey(today(), ws());
    const startD = U.parseISO(wk);
    const w = getWeek(wk);
    const wom = U.weekOfMonth(startD);
    const cyc = cycleAt(U.toISO(U.addDays(startD, 3))) || currentCycle();
    const goals = cyc ? cycleGoals(cyc.id) : [];
    const base = `weeks.${wk}`;
    const days = Array.from({ length: 7 }, (_, i) => U.addDays(startD, i));
    const endIso = U.toISO(days[6]);
    const tIso = todayISO();
    const defDay = tIso >= wk && tIso <= endIso ? tIso : wk;
    const dayOpts = (cur) => opts(days.map((d) => ({ v: U.toISO(d), l: `${U.DAYS[d.getDay()].slice(0, 3)} ${U.fmtDate(U.toISO(d))}` })), cur);
    const roleWeekly = cyc ? state.roles.map((r) => ({ r, t: get(`cycles.@${cyc.id}.roleActions.${r.id}.weekly`) })).filter((x) => x.t) : [];
    const wos = state.workouts.filter((x) => x.date >= wk && x.date <= endIso).sort((a, b) => (a.date < b.date ? -1 : 1));
    const woDone = wos.filter((x) => x.done).length;
    const woTarget = Number(state.settings.workoutTarget) || 0;

    const strip = `<div class="strip">${days.map((d) => {
      const iso = U.toISO(d);
      return `<div class="${iso === tIso ? 'today' : ''}"><strong>${U.DAYS[d.getDay()].slice(0, 3)}</strong> <span>${U.fmtDate(iso)}</span>
        ${U.eventsOn(state.events, iso).map((e) => `<div class="ev">${esc(e.text)}</div>`).join('')}
        <ul class="sched">${scheduleOn(iso).map((s) => `<li>${s.time ? `<time>${esc(fmtTime(s.time))}</time>` : ''}<span class="grow">${esc(s.text)}</span><button class="x" data-act="del" data-path="schedule" data-id="${s.id}" aria-label="Remove">×</button></li>`).join('')}
          ${wos.filter((x) => x.date === iso).map((x) => `<li class="wo ${x.done ? 'done' : ''}"><span class="grow">${x.done ? '✓' : '◦'} ${esc(x.type)}</span></li>`).join('')}</ul>
      </div>`;
    }).join('')}</div>
      <form class="add" data-add="schedule">
        <select name="date" aria-label="Day">${dayOpts(defDay)}</select>
        <input type="time" name="time" aria-label="Time">
        <input name="text" placeholder="Add to schedule: appointment, meeting, time block…" required>
        <button aria-label="Add to schedule">+</button></form>`;

    const habits = `<table class="habits"><thead><tr><th>Habit</th><th>Goal</th>${days.map((d) => `<th>${U.DAYS[d.getDay()][0]}</th>`).join('')}<th></th><th></th></tr></thead><tbody>
      ${w.habits.map((h) => {
        const p = `${base}.habits.@${h.id}`;
        const n = h.days.filter(Boolean).length;
        return `<tr><td><input class="inline" data-bind="${p}.name" value="${esc(h.name)}" aria-label="Habit"></td>
          <td class="goal"><input class="inline num" type="number" min="1" max="7" data-type="number" data-bind="${p}.target" value="${esc(h.target)}" aria-label="Times per week"></td>
          ${h.days.map((v, i) => `<td class="day" data-d="${U.DAYS[days[i].getDay()][0]}">${chk(`${p}.days.${i}`, U.DAYS[days[i].getDay()])}</td>`).join('')}
          <td class="count ${n >= (h.target || 7) ? 'ok' : ''}">${n}/${h.target || 7}</td>
          <td class="del"><button class="x" data-act="del" data-path="${base}.habits" data-id="${h.id}" aria-label="Remove">×</button></td></tr>`;
      }).join('')}</tbody></table>
      <form class="add" data-add="${base}.habits"><input name="name" placeholder="New habit (e.g. Workout)" required>
        <input name="target" type="number" min="1" max="7" value="5" class="num" aria-label="Times per week"><button aria-label="Add habit">+</button></form>
      <p class="muted small">Habits carry forward to next week automatically. See trends on <a href="#/track/habits">Track</a>.</p>`;

    const workouts = `<ul class="checks">${wos.map((x) => {
        const p = `workouts.@${x.id}`;
        return `<li class="${x.done ? 'done' : ''}">${chk(p + '.done', 'Done')}
          <div class="grow"><small class="muted">${U.DAYS[U.parseISO(x.date).getDay()].slice(0, 3)}</small>
            <input class="inline title-sm" data-bind="${p}.type" value="${esc(x.type)}" aria-label="Workout type">
            <input class="inline" data-bind="${p}.details" value="${esc(x.details)}" placeholder="Plan / details" aria-label="Details"></div>
          <input class="inline num" type="number" min="0" data-type="number" data-bind="${p}.minutes" value="${esc(x.minutes)}" placeholder="min" aria-label="Minutes">
          <button class="x" data-act="del" data-path="workouts" data-id="${x.id}" aria-label="Remove">×</button></li>`;
      }).join('')}</ul>
      <form class="add" data-add="workouts">
        <select name="date" aria-label="Day">${dayOpts(defDay)}</select>
        <input name="type" list="wotypes" placeholder="Type" required aria-label="Type">
        <input name="details" placeholder="Plan (e.g. 5×5 squat, 20 mi ride)" aria-label="Plan">
        <input name="minutes" type="number" min="0" class="num" placeholder="min" aria-label="Minutes">
        <button aria-label="Add workout">+</button></form>
      <datalist id="wotypes">${['Strength', 'Ride', 'Run', 'Walk', 'Swim', 'Mobility', 'HIIT', 'Sport'].map((t) => `<option value="${t}">`).join('')}</datalist>`;

    const pulse = goals.length ? `<ul class="pulse-list">${goals.map((g) => {
      const cur = w.pulse[g.id];
      const a = goalActivity(g.id, '', wk);
      return `<li><span class="grow">${g.tier === 'purpose' ? '★ ' : ''}${esc(g.title)} <small class="muted">${a.week.done}/${a.week.total} this week</small></span>
        ${['on', 'slip', 'off'].map((v) => `<button class="pill ${v} ${cur === v ? 'sel' : ''}" data-act="pulse" data-key="${wk}" data-goal="${g.id}" data-v="${v}">${{ on: 'On track', slip: 'Slipping', off: 'Stalled' }[v]}</button>`).join('')}</li>`;
    }).join('')}</ul>` : '<p class="muted">No active goals for this week\'s cycle.</p>';

    const stars = `<div class="stars" role="radiogroup" aria-label="Rate your week">${[1, 2, 3, 4, 5].map((n) =>
      `<button class="${n <= w.rating ? 'on' : ''}" data-act="rate" data-key="${wk}" data-v="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}</div>`;

    const body = `
      <h2 class="section">Schedule</h2>
      ${strip}
      <h2 class="section">Priority Actions for the Week</h2>
      ${roleWeekly.length ? `<div class="nudge role-nudge"><strong>Your weekly role commitments:</strong> ${roleWeekly.map((x) => `<span><em>${esc(x.r.name)}:</em> ${esc(x.t)}</span>`).join(' · ')}</div>` : ''}
      <div class="row">
        <button class="btn ghost" data-act="carryWeek" data-key="${wk}">Bring forward unfinished from last week</button>
        <button class="btn ghost" data-act="pullMonth" data-key="${wk}">Pull open actions from ${U.MONTHS[wom.month]}</button>
      </div>
      ${areaBoxes(base + '.actions', w.actions, goals)}
      <div class="grid2">
        <section class="box"><h3>Habit Tracker</h3>${habits}</section>
        <section class="box"><h3>Workouts <small class="muted">${woDone}${woTarget ? `/${woTarget}` : ''} done · ${wos.reduce((s, x) => s + (x.done ? Number(x.minutes) || 0 : 0), 0)} min</small></h3>${workouts}</section>
      </div>
      <div class="grid2">
        <section class="box"><h3>Goal pulse</h3><p class="prompt">Honest check: is each goal moving?</p>${pulse}</section>
        <section class="box"><h3>Shopping list <a class="more" href="#/lists/shopping">All →</a></h3>${simpleList('shopping', state.shopping, 'Add item…')}
          ${state.shopping.some((x) => x.done) ? '<button class="btn ghost small" data-act="clearShopping">Clear purchased</button>' : ''}</section>
      </div>
      <div class="grid2">
        <section class="box"><h3>Not-to-do List</h3>${simpleList(base + '.notToDo', w.notToDo, 'Something to avoid…', false)}</section>
        <section class="box"><h3>Gratitude & Health</h3>${ta(base + '.gratitude', '', 5)}</section>
      </div>
      <section class="box"><h3>Notes · Ideas · Reminders · Acts of Kindness · Memories</h3>${ta(base + '.notes', '', 5)}</section>
      <section class="box review"><h3>Are you chasing your dreams this week?</h3>${ta(base + '.dreams', '', 3)}
        <h3>Rate your week</h3>${stars}</section>`;
    const prev = U.toISO(U.addDays(startD, -7)), next = U.toISO(U.addDays(startD, 7));
    const nav = `<a class="btn ghost" href="#/week/${prev}" aria-label="Previous week">←</a>
      <a class="btn ghost" href="#/week/${U.weekKey(today(), ws())}">This week</a>
      <a class="btn ghost" href="#/week/${next}" aria-label="Next week">→</a>
      <button class="btn" data-act="copyWeek" data-key="${wk}">Copy for planner</button>`;
    return page(`Week ${wom.n} of ${U.MONTHS[wom.month]}`,
      `${U.fmtDate(wk, { weekday: 'short', month: 'short', day: 'numeric' })} – ${U.fmtDate(endIso, { weekday: 'short', month: 'short', day: 'numeric' })} · <a href="#/month/${wom.monthKey}">Month view</a>`,
      body, nav);
  }

  /* ---------- tracking helpers & charts ---------- */
  const scheduleOn = (iso) => state.schedule.filter((s) => s.date === iso)
    .sort((a, b) => ((a.time || '99') < (b.time || '99') ? -1 : 1));
  function fmtTime(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    return `${((h + 11) % 12) + 1}:${U.pad(m)}${h < 12 ? 'a' : 'p'}`;
  }
  const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
  const round1 = (v) => Math.round(v * 10) / 10;

  /* Single-series line chart (weight). Thin 2px line, 8px markers, dashed target, hover tips. */
  function lineChart(pts, target, unit, label = 'Weight trend') {
    if (pts.length < 2) return '<p class="muted">Log at least two entries to see your trend.</p>';
    const W = 640, H = 230, L = 46, R = 18, T = 14, B = 28;
    const xs = pts.map((p) => U.parseISO(p.date).getTime());
    const ys = pts.map((p) => p.value).concat(target != null ? [target] : []);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    const raw = Math.max(1, (hi - lo) / 4);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const y0 = Math.floor(lo / step) * step, y1 = Math.max(Math.ceil(hi / step) * step, y0 + step);
    const x0 = xs[0], x1 = xs[xs.length - 1];
    const sx = (t) => L + (x1 === x0 ? 0.5 : (t - x0) / (x1 - x0)) * (W - L - R);
    const sy = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
    const ticks = [];
    for (let v = y0; v <= y1 + step / 2; v += step) ticks.push(round1(v));
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(p.value).toFixed(1)}`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}, ${pts.length} entries">
      ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text class="axis" x="${L - 6}" y="${sy(v) + 4}" text-anchor="end">${v}</text>`).join('')}
      ${target != null ? `<line class="target" x1="${L}" x2="${W - R}" y1="${sy(target)}" y2="${sy(target)}"/><text class="axis" x="${W - R}" y="${sy(target) - 5}" text-anchor="end">Target ${target} ${esc(unit)}</text>` : ''}
      <path class="line" d="${d}"/>
      ${pts.map((p, i) => `<circle class="mark" cx="${sx(xs[i])}" cy="${sy(p.value)}" r="4"/>`).join('')}
      ${pts.map((p, i) => `<circle class="hit" cx="${sx(xs[i])}" cy="${sy(p.value)}" r="13" data-tip="${esc(U.fmtDate(p.date, { month: 'short', day: 'numeric', year: 'numeric' }))}: ${p.value} ${esc(unit)}"/>`).join('')}
      <text class="axis" x="${L}" y="${H - 6}">${U.fmtDate(pts[0].date)}</text>
      <text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">${U.fmtDate(pts[pts.length - 1].date)}</text>
    </svg>`;
  }

  /* Single-series column chart (workouts per week) with optional dashed target. */
  function barChart(bars, target, label) {
    const W = 640, H = 200, L = 30, R = 10, T = 12, B = 26;
    const max = Math.max(1, target || 0, ...bars.map((b) => b.v));
    const bw = (W - L - R) / bars.length;
    const sy = (v) => T + (1 - v / max) * (H - T - B);
    const base = sy(0);
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
      ${[0, Math.ceil(max / 2), max].map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text class="axis" x="${L - 6}" y="${sy(v) + 4}" text-anchor="end">${v}</text>`).join('')}
      ${bars.map((b, i) => {
        const x = L + i * bw + 3, w = Math.max(4, bw - 6), y = sy(b.v), h = base - y;
        const r = Math.min(4, w / 2, h);
        const path = h > 0 ? `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z` : '';
        return `${path ? `<path class="barfill" d="${path}"/>` : ''}
          <rect class="hit" x="${L + i * bw}" y="${T}" width="${bw}" height="${base - T}" data-tip="${esc(b.tip)}"/>
          ${i % 2 === bars.length % 2 ? '' : `<text class="axis" x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${esc(b.label)}</text>`}`;
      }).join('')}
      ${target ? `<line class="target" x1="${L}" x2="${W - R}" y1="${sy(target)}" y2="${sy(target)}"/><text class="axis" x="${W - R}" y="${sy(target) - 5}" text-anchor="end">Target ${target}/wk</text>` : ''}
    </svg>`;
  }

  function sparkline(hist) {
    if (!hist || hist.length < 2) return '<span class="muted small">—</span>';
    const W = 110, H = 26;
    const xs = hist.map((h) => U.parseISO(h.date).getTime());
    const x0 = xs[0], x1 = xs[xs.length - 1] || x0 + 1;
    const d = hist.map((h, i) => `${i ? 'L' : 'M'}${(2 + ((xs[i] - x0) / (x1 - x0 || 1)) * (W - 4)).toFixed(1)},${(H - 2 - (h.v / 100) * (H - 4)).toFixed(1)}`).join('');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Progress history"><path d="${d}"/></svg>`;
  }

  function recentWeekKeys(n) {
    const cur = U.parseISO(U.weekKey(today(), ws()));
    return Array.from({ length: n }, (_, i) => U.toISO(U.addDays(cur, -7 * (n - 1 - i))));
  }

  function viewTrack(tab) {
    tab = tab || 'weight';
    const tabs = [['weight', 'Weight'], ['workouts', 'Workouts'], ['plan', 'Plan workouts'], ['habits', 'Habits'], ['goals', 'Goal progress']];
    let body = `<nav class="tabs">${tabs.map(([k, l]) => `<a href="#/track/${k}" class="${k === tab ? 'sel' : ''}">${l}</a>`).join('')}</nav>`;
    const s = state.settings;

    if (tab === 'weight') {
      const unit = s.weightUnit || 'lbs';
      const pts = state.weights.filter((w) => num(w.value) != null && w.date).map((w) => ({ ...w, value: Number(w.value) }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      const goal = num(s.weightGoal);
      const first = pts[0], last = pts[pts.length - 1];
      const tile = (k, v, sub = '') => `<div class="tile"><span>${k}</span><strong>${v}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
      let pct = '';
      if (first && last && goal != null && first.value !== goal) pct = `${Math.max(0, Math.min(100, Math.round(((first.value - last.value) / (first.value - goal)) * 100)))}% of the way`;
      body += `
        <div class="tiles">
          ${tile('Start', first ? `${first.value}` : '—', first ? U.fmtDate(first.date) : '')}
          ${tile('Current', last ? `${last.value}` : '—', last ? U.fmtDate(last.date) : '')}
          ${tile('Change', first && last ? `${last.value - first.value > 0 ? '+' : ''}${round1(last.value - first.value)}` : '—', unit)}
          ${tile('To target', last && goal != null ? `${round1(Math.abs(last.value - goal))}` : '—', pct || (goal == null ? 'set a target below' : unit))}
        </div>
        <section class="box"><h2>Weight trend</h2>${lineChart(pts, goal, unit)}</section>
        <div class="grid2">
          <section class="box"><h2>Log weight</h2>
            <form class="add" data-add="weights">
              <input type="date" name="date" value="${todayISO()}" required aria-label="Date">
              <input type="number" name="value" step="0.1" min="0" placeholder="${unit}" required aria-label="Weight">
              <button aria-label="Log weight">+</button></form>
            <div class="row">
              <label>Target ${inp('settings.weightGoal', 'e.g. 185', 'number', 'data-type="number" step="0.1" data-rerender')}</label>
              <label>Unit <select data-bind="settings.weightUnit" data-rerender>${opts([{ v: 'lbs', l: 'lbs' }, { v: 'kg', l: 'kg' }], unit)}</select></label>
            </div></section>
          <section class="box"><h2>Log</h2>
            ${pts.length ? `<table class="index"><thead><tr><th>Date</th><th>${esc(unit)}</th><th>Δ</th><th></th></tr></thead><tbody>
              ${pts.slice().reverse().map((p, i, arr) => {
                const prev = arr[i + 1];
                return `<tr><td>${U.fmtDate(p.date, { month: 'short', day: 'numeric', year: 'numeric' })}</td><td>${p.value}</td>
                  <td class="muted">${prev ? `${p.value - prev.value > 0 ? '+' : ''}${round1(p.value - prev.value)}` : ''}</td>
                  <td><button class="x" data-act="del" data-path="weights" data-id="${p.id}" aria-label="Remove">×</button></td></tr>`;
              }).join('')}</tbody></table>` : '<p class="muted">No entries yet.</p>'}
          </section>
        </div>`;
    } else if (tab === 'workouts') {
      const keys = recentWeekKeys(12);
      const target = Number(s.workoutTarget) || 0;
      const bars = keys.map((k) => {
        const end = U.toISO(U.addDays(U.parseISO(k), 6));
        const l = state.workouts.filter((x) => x.done && x.date >= k && x.date <= end);
        const min = l.reduce((a, x) => a + (Number(x.minutes) || 0), 0);
        return { v: l.length, label: U.fmtDate(k), tip: `Week of ${U.fmtDate(k)}: ${l.length} workout${l.length === 1 ? '' : 's'}, ${min} min` };
      });
      const done = state.workouts.filter((x) => x.done).sort((a, b) => (a.date < b.date ? 1 : -1));
      const byType = {};
      done.forEach((x) => { byType[x.type] = (byType[x.type] || 0) + 1; });
      body += `
        <section class="box"><h2>Workouts per week <small class="muted">last 12 weeks</small></h2>${barChart(bars, target, 'Completed workouts per week, last 12 weeks')}
          <div class="row"><label>Weekly target ${inp('settings.workoutTarget', '5', 'number', 'data-type="number" min="0" max="14" data-rerender')}</label>
          <a class="btn ghost" href="#/week">Plan this week →</a><a class="btn ghost" href="#/track/plan">Plan ahead &amp; import →</a></div></section>
        <div class="grid2">
          <section class="box"><h2>By type</h2>${Object.keys(byType).length ? `<ul class="habit-sum">${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<li><span>${esc(t)}</span><span>${n}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing logged yet.</p>'}</section>
          <section class="box"><h2>Recent</h2>${done.length ? `<table class="index"><tbody>${done.slice(0, 15).map((x) => `<tr><td>${U.fmtDate(x.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td><td>${esc(x.type)}</td><td class="muted">${esc(x.details)}</td><td>${x.minutes ? `${x.minutes} min` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Check off workouts on the Week page and they appear here.</p>'}</section>
        </div>`;
    } else if (tab === 'plan') {
      const iso = todayISO();
      const byTime = (a, b) => (a.date + (a.time || '99')) < (b.date + (b.time || '99')) ? -1 : 1;
      const upcoming = state.workouts.filter((x) => x.date >= iso).sort(byTime);
      const batches = {};
      state.workouts.filter((x) => x.batch).forEach((x) => { (batches[x.batch] = batches[x.batch] || { id: x.batch, name: x.batchName || 'Plan', items: [] }).items.push(x); });
      const order = [1, 2, 3, 4, 5, 6, 0];
      const types = ['Run', 'Ride', 'Strength', 'Yoga', 'Swim', 'Walk', 'HIIT', 'Horse riding', 'Mobility'];
      const wk0 = U.weekKey(today(), ws());
      const row = (x) => {
        const p = `workouts.@${x.id}`;
        return `<li class="${x.done ? 'done' : ''}">${chk(p + '.done', 'Done')}
          <div class="grow"><small class="muted">${U.fmtDate(x.date, { weekday: 'short', month: 'short', day: 'numeric' })}</small>
            <input class="inline title-sm" data-bind="${p}.type" value="${esc(x.type)}" aria-label="Workout type">
            <input class="inline" data-bind="${p}.details" value="${esc(x.details)}" placeholder="Plan / details" aria-label="Details"></div>
          <input class="inline" type="time" data-bind="${p}.time" value="${esc(x.time || '')}" aria-label="Time">
          <input class="inline num" type="number" min="0" data-type="number" data-bind="${p}.minutes" value="${esc(x.minutes)}" placeholder="min" aria-label="Minutes">
          <button class="x" data-act="del" data-path="workouts" data-id="${x.id}" aria-label="Remove">×</button></li>`;
      };
      const weeks = {};
      upcoming.forEach((x) => { (weeks[U.weekKey(U.parseISO(x.date), ws())] = weeks[U.weekKey(U.parseISO(x.date), ws())] || []).push(x); });
      body += `
        <div class="grid2">
          <section class="box"><h2>Build a plan</h2>
            <p class="prompt">Pick the days you train and for how many weeks. Life.OS schedules every session in advance; each appears on Today and the Week page.</p>
            <form data-act-form="workoutPlan" class="wo-plan">
              <div class="row"><label>Plan name <input name="name" placeholder="e.g. Half-marathon base"></label>
                <label>Start <input type="date" name="start" value="${iso}" required></label>
                <label>Weeks <select name="weeks">${opts([1, 2, 3, 4, 6, 8, 10, 12].map((n) => ({ v: n, l: `${n} week${n > 1 ? 's' : ''}` })), 4)}</select></label></div>
              <datalist id="wotypes">${types.map((t) => `<option value="${t}">`).join('')}</datalist>
              ${order.map((d) => `<div class="wo-day"><label class="inline-check"><input type="checkbox" name="on_${d}"> <strong>${U.DAYS[d].slice(0, 3)}</strong></label>
                <input name="type_${d}" list="wotypes" placeholder="Type" aria-label="${U.DAYS[d]} type">
                <input name="time_${d}" type="time" aria-label="${U.DAYS[d]} time">
                <input name="min_${d}" type="number" min="0" class="num" placeholder="min" aria-label="${U.DAYS[d]} minutes">
                <input name="details_${d}" placeholder="Details (e.g. 5×5 squat)" aria-label="${U.DAYS[d]} details"></div>`).join('')}
              <div class="row end"><button class="primary">Schedule workouts</button></div>
            </form></section>
          <section class="box"><h2>Import workouts</h2>
            <p class="prompt">Paste a plan or choose a file (CSV, text or a calendar .ics export). One workout per line: <code>date, type, minutes, details</code>. Dates can be 2026-11-12, 11/12 or Nov 12.</p>
            <form data-act-form="workoutImport">
              <textarea name="text" rows="9" placeholder="2026-11-12, Run, 40, easy pace&#10;11/14, Strength, 45, legs&#10;Nov 16, Ride, 60"></textarea>
              <div class="row"><label class="btn ghost file">Choose file… <input type="file" data-wofile accept=".csv,.txt,.ics,text/*" hidden></label>
                <button class="primary">Import &amp; schedule</button></div>
            </form>
            <p class="muted small">Have a photo of a printed plan? Use <a href="#/settings">Settings → Upload photo</a> and choose "Log workouts".</p>
          </section>
        </div>
        <section class="box"><h2>Upcoming workouts <span class="muted">· ${upcoming.length}</span>
          ${upcoming.length ? '<button class="btn ghost" data-act="pushWorkouts">Add to Google Calendar</button>' : ''}</h2>
          ${upcoming.length ? Object.keys(weeks).sort().map((k) => `<h3>${k === wk0 ? 'This week' : `Week of ${U.fmtDate(k, { month: 'short', day: 'numeric' })}`}</h3><ul class="checks">${weeks[k].map(row).join('')}</ul>`).join('')
            : '<p class="muted">Nothing scheduled yet. Build a plan or import a list above.</p>'}
        </section>
        ${Object.keys(batches).length ? `<section class="box"><h2>Plans &amp; imports</h2><ul class="habit-sum batches">
          ${Object.values(batches).map((b) => {
            const ds = b.items.map((x) => x.date).sort();
            return `<li><span><strong>${esc(b.name)}</strong> <small class="muted">${b.items.length} sessions · ${U.fmtDate(ds[0])} – ${U.fmtDate(ds[ds.length - 1])} · ${b.items.filter((x) => x.done).length} done</small></span>
              <button class="x" data-act="delBatch" data-id="${b.id}" aria-label="Remove all sessions in ${esc(b.name)}">×</button></li>`;
          }).join('')}</ul></section>` : ''}`;
    } else if (tab === 'habits') {
      const keys = recentWeekKeys(8);
      const names = [];
      keys.slice().reverse().forEach((k) => ((state.weeks[k] && state.weeks[k].habits) || []).forEach((h) => {
        if (h.name && !names.includes(h.name)) names.push(h.name);
      }));
      const cell = (k, name) => {
        const h = ((state.weeks[k] && state.weeks[k].habits) || []).find((x) => x.name === name);
        if (!h) return { html: '<td class="muted">—</td>', hit: null };
        const n = h.days.filter(Boolean).length, t = h.target || 7;
        const r = Math.min(1, n / t);
        return { html: `<td class="heat ${n >= t ? 'ok' : ''}" style="--heat:${Math.round(8 + r * 52)}%" title="${n} of ${t}">${n}/${t}</td>`, hit: n >= t };
      };
      const tks = trackers();
      const hkeys = recentWeekKeys(12);
      const curWk = U.weekKey(today(), ws());
      body += tks.length ? `<section class="box"><h2>Goal habits <small class="muted">last 12 weeks · cells show days done / weekly goal</small></h2>
        <div class="cal-wrap"><table class="heatmap"><thead><tr><th>Habit</th>${hkeys.map((k) => `<th><a href="#/week/${k}">${U.fmtDate(k)}</a></th>`).join('')}<th>Streak</th><th>Hit rate</th></tr></thead><tbody>
        ${tks.map((tk) => {
          const cells = hkeys.map((k) => {
            const n = weekCount(tk.log, k);
            return `<td class="heat ${n >= tk.perWeek ? 'ok' : ''}" style="--heat:${Math.round(6 + Math.min(1, n / tk.perWeek) * 54)}%" title="${U.fmtDate(k)}: ${n} of ${tk.perWeek}">${n}</td>`;
          }).join('');
          const finished = hkeys.filter((k) => k < curWk);
          const hits = finished.filter((k) => weekCount(tk.log, k) >= tk.perWeek).length;
          const rate = finished.length ? Math.round((hits / finished.length) * 100) : 0;
          return `<tr><th>${esc(tk.title)}<small class="muted"> ${tk.perWeek}×/wk</small></th>${cells}<td>${weekStreak(tk.log, tk.perWeek, curWk)} wk</td><td>${rate}%</td></tr>`;
        }).join('')}</tbody></table></div></section>
        <section class="box"><h2>Last 28 days</h2>
          ${tks.map((tk) => {
            const days = Array.from({ length: 28 }, (_, i) => U.toISO(U.addDays(today(), i - 27)));
            return `<div class="strip"><span class="strip-name">${esc(tk.title)}</span><span class="dots wide">${days.map((d) => `<span class="dot${tk.log[d] ? ' on' : ''}" title="${U.fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' })}${tk.log[d] ? ' ✓' : ''}"></span>`).join('')}</span><span class="muted small">${days.filter((d) => tk.log[d]).length}/28</span></div>`;
          }).join('')}
        </section>` : '<section class="box"><h2>Goal habits</h2><p class="muted">Create a <strong>Habit goal</strong> (or add a routine to an achievement goal) in <a href="#/goals">Roles &amp; Goals</a>, then tick it off on Today to see your progress here.</p></section>';
      if (names.length) body += `<section class="box"><h2>Weekly-tracker habits <small class="muted">last 8 weeks · cells show days done / weekly goal</small></h2>
        ${names.length ? `<div class="cal-wrap"><table class="heatmap"><thead><tr><th>Habit</th>${keys.map((k) => `<th><a href="#/week/${k}">${U.fmtDate(k)}</a></th>`).join('')}<th>Streak</th><th>Hit rate</th></tr></thead><tbody>
          ${names.map((nm) => {
            const cells = keys.map((k) => cell(k, nm));
            // Consecutive weeks meeting the goal; the current, in-progress week never breaks a streak.
            let streak = 0;
            for (let i = cells.length - 1; i >= 0; i--) {
              if (cells[i].hit) streak++;
              else if (i === cells.length - 1) continue;
              else break;
            }
            const tracked = cells.filter((c) => c.hit != null);
            const rate = tracked.length ? Math.round((tracked.filter((c) => c.hit).length / tracked.length) * 100) : 0;
            return `<tr><th>${esc(nm)}</th>${cells.map((c) => c.html).join('')}<td>${streak} wk</td><td>${rate}%</td></tr>`;
          }).join('')}</tbody></table></div>` : '<p class="muted">Add habits on the <a href="#/week">Week</a> page to start tracking.</p>'}
      </section>`;
    } else {
      const cyc = currentCycle();
      const goals = cyc ? cycleGoals(cyc.id, true) : [];
      const allActs = (gid) => {
        let done = 0, total = 0;
        const count = (a) => { if (a.goalId === gid) { total++; if (a.done) done++; } };
        Object.values(state.months).forEach((m) => (m.actions || []).forEach(count));
        Object.values(state.weeks).forEach((w) => (w.actions || []).forEach(count));
        return { done, total };
      };
      body += `<section class="box"><h2>Goal progress ${cyc ? `<small class="muted">${esc(cyc.name)}</small>` : ''}</h2>
        <p class="prompt">Move a slider whenever progress changes; each day's value is kept so you can see momentum over the cycle.</p>
        ${goals.length ? `<table class="goals-table"><thead><tr><th>Goal</th><th>Role</th><th>Progress</th><th>Trend</th><th>Actions done</th></tr></thead><tbody>
          ${goals.map((g) => {
            const a = allActs(g.id);
            return `<tr class="${g.status}"><td>${g.tier === 'purpose' ? '<span class="star">★</span> ' : ''}${esc(g.title)}${g.status !== 'active' ? ` <small class="muted">(${g.status})</small>` : ''}</td>
              <td data-label="Role">${esc(roleName(g.roleId))}</td>
              <td class="prog" data-label="Progress"><input type="range" min="0" max="100" step="5" data-bind="goals.@${g.id}.progress" data-type="number" value="${Number(g.progress) || 0}" aria-label="Progress"><output>${Number(g.progress) || 0}%</output></td>
              <td data-label="Trend">${sparkline(g.history)}</td>
              <td data-label="Actions">${a.done}/${a.total}</td></tr>`;
          }).join('')}</tbody></table>` : '<p class="muted">No goals yet. <a href="#/goals">Hold a planning session →</a></p>'}
      </section>`;
    }
    return page('Track', 'Weight, workouts, habits and goal momentum', body);
  }


  /* ---------- Wheel of Life (Zig Ziglar) ---------- */
  const WHEEL = [
    { id: 'physical', name: 'Physical', hint: 'Health, energy, fitness, sleep, nutrition' },
    { id: 'mental', name: 'Mental', hint: 'Learning, growth, focus, attitude' },
    { id: 'spiritual', name: 'Spiritual', hint: 'Faith, purpose, inner peace, values' },
    { id: 'family', name: 'Family', hint: 'Spouse, children, parents, home life' },
    { id: 'career', name: 'Career', hint: 'Work, calling, contribution, progress' },
    { id: 'financial', name: 'Financial', hint: 'Income, savings, debt, security' },
    { id: 'social', name: 'Social', hint: 'Friendships, community, service' },
  ];

  function radar(cur, prev) {
    const SZ = 380, c = SZ / 2, R = 128, n = WHEEL.length;
    const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const pt = (i, v) => [c + Math.cos(ang(i)) * R * (v / 10), c + Math.sin(ang(i)) * R * (v / 10)];
    const poly = (sc) => WHEEL.map((a, i) => pt(i, Number(sc[a.id]) || 0).map((x) => x.toFixed(1)).join(',')).join(' ');
    return `<svg class="radar" viewBox="0 0 ${SZ} ${SZ}" role="img" aria-label="Wheel of Life radar chart">
      ${[2, 4, 6, 8, 10].map((v) => `<polygon class="radar-ring" points="${WHEEL.map((a, i) => pt(i, v).map((x) => x.toFixed(1)).join(',')).join(' ')}"/>`).join('')}
      ${WHEEL.map((a, i) => { const [x, y] = pt(i, 10); return `<line class="radar-axis" x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('')}
      ${prev ? `<polygon class="radar-prev" points="${poly(prev)}"/>` : ''}
      <polygon class="radar-now" points="${poly(cur)}"/>
      ${WHEEL.map((a, i) => { const [x, y] = pt(i, Number(cur[a.id]) || 0); return `<circle class="radar-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"/><circle class="hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" data-tip="${a.name}: ${cur[a.id]}/10"/>`; }).join('')}
      ${WHEEL.map((a, i) => {
        const cs = Math.cos(ang(i)), [x, y] = [c + cs * (R + 16), c + Math.sin(ang(i)) * (R + 16) + 4];
        return `<text class="radar-label" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${Math.abs(cs) < 0.2 ? 'middle' : cs > 0 ? 'start' : 'end'}">${a.name}</text>`;
      }).join('')}
    </svg>`;
  }

  function viewWheel() {
    const list = state.wheel.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = list[list.length - 1], prev = list[list.length - 2];
    const avg = (sc) => round1(WHEEL.reduce((s, a) => s + (Number(sc[a.id]) || 0), 0) / WHEEL.length);
    const start = last ? last.scores : {};
    const sorted = last ? WHEEL.slice().sort((a, b) => last.scores[a.id] - last.scores[b.id]) : [];
    const delta = (id) => (last && prev ? last.scores[id] - prev.scores[id] : null);
    const fmtD = (d) => (d == null ? '' : d > 0 ? `+${d}` : d < 0 ? `${d}` : '=');
    const tile = (l, v, sub) => `<div class="tile"><span>${l}</span><strong>${v}</strong><small>${sub}</small></div>`;

    const form = `<form data-act-form="wheel" class="wheel-form">
      <label class="field">Date <input type="date" name="date" value="${todayISO()}" required></label>
      ${WHEEL.map((a) => `<div class="wheel-row"><div><strong>${a.name}</strong><small class="muted">${a.hint}</small></div>
        <input type="range" min="1" max="10" step="1" name="s_${a.id}" value="${start[a.id] || 5}" data-wheel aria-label="${a.name} score"><output>${start[a.id] || 5}</output></div>`).join('')}
      <label class="field">Notes <textarea name="note" rows="2" placeholder="What's driving these scores? What do you want to change?"></textarea></label>
      <div class="row end"><button class="primary">Save assessment</button></div>
    </form>`;

    const body = `
      <p class="lead">Zig Ziglar's Wheel of Life: seven areas that make up a balanced life. Score each from 1 (needs a lot of attention) to 10 (thriving). Repeat every quarter to watch your balance change.</p>
      <div class="grid2">
        <section class="box"><h2>Score yourself</h2>${form}</section>
        <section class="box"><h2>${last ? `Your wheel <small class="muted">${U.fmtDate(last.date, { month: 'short', day: 'numeric', year: 'numeric' })}</small>` : 'Your wheel'}</h2>
          ${last ? `${radar(last.scores, prev && prev.scores)}${prev ? `<p class="legend"><span class="sw now"></span> ${U.fmtDate(last.date)} <span class="sw prev"></span> ${U.fmtDate(prev.date)}</p>` : ''}`
            : '<p class="muted">Save your first assessment and your wheel appears here.</p>'}
        </section>
      </div>
      ${last ? `
      <div class="tiles">
        ${tile('Balance score', avg(last.scores), prev ? `${avg(last.scores) - avg(prev.scores) >= 0 ? '+' : ''}${round1(avg(last.scores) - avg(prev.scores))} since ${U.fmtDate(prev.date)}` : 'average of 7 areas')}
        ${tile('Strongest', esc(sorted[sorted.length - 1].name), `${last.scores[sorted[sorted.length - 1].id]}/10`)}
        ${tile('Needs attention', esc(sorted[0].name), `${last.scores[sorted[0].id]}/10`)}
        ${tile('Assessments', list.length, 'saved so far')}
      </div>
      <section class="box"><h2>By area</h2>
        <table class="index wheel-table"><thead><tr><th>Area</th><th>Now</th><th>Change</th><th></th><th>Trend</th></tr></thead><tbody>
        ${WHEEL.map((a) => `<tr><td><strong>${a.name}</strong></td><td>${last.scores[a.id]}/10</td><td class="muted">${fmtD(delta(a.id))}</td>
          <td>${progressBar(last.scores[a.id] * 10)}</td>
          <td>${sparkline(list.map((x) => ({ date: x.date, v: x.scores[a.id] * 10 })))}</td></tr>`).join('')}</tbody></table>
        <p class="muted small">Lowest scores are your best places to start. <a href="#/goals">Turn ${esc(sorted[0].name)} into a goal →</a></p>
      </section>
      ${list.length > 1 ? `<section class="box"><h2>Balance over time</h2>${lineChart(list.map((x) => ({ date: x.date, value: avg(x.scores) })), null, '/10', 'Wheel of Life balance score')}</section>` : ''}
      <section class="box"><h2>History</h2>
        <div class="cal-wrap"><table class="index"><thead><tr><th>Date</th>${WHEEL.map((a) => `<th>${a.name.slice(0, 4)}</th>`).join('')}<th>Avg</th><th></th></tr></thead><tbody>
        ${list.slice().reverse().map((x) => `<tr><td>${U.fmtDate(x.date, { month: 'short', day: 'numeric', year: 'numeric' })}${x.note ? `<br><small class="muted">${esc(x.note)}</small>` : ''}</td>
          ${WHEEL.map((a) => `<td>${x.scores[a.id]}</td>`).join('')}<td><strong>${avg(x.scores)}</strong></td>
          <td><button class="x" data-act="del" data-path="wheel" data-id="${x.id}" aria-label="Delete assessment">×</button></td></tr>`).join('')}</tbody></table></div>
      </section>` : ''}`;
    return page('Wheel of Life', 'Seven areas, scored over time', body);
  }

  function viewLists(tab) {
    tab = tab || 'bucket';
    const tabs = [['bucket', 'Bucket List'], ['hobbies', 'Hobbies & Projects'], ['shopping', 'Shopping'], ['reading', 'Reading & Entertainment'], ['journal', 'Journal'], ['index', 'Notes Index']];
    let body = `<nav class="tabs">${tabs.map(([k, l]) => `<a href="#/lists/${k}" class="${k === tab ? 'sel' : ''}">${l}</a>`).join('')}</nav>`;
    if (tab === 'bucket') {
      body += `<p class="prompt">Start simple and let it evolve. Target different areas of life, and balance ambition with some easier wins. Have fun.</p>
        <div class="cards">${state.bucket.map((b) => {
          const p = `bucket.@${b.id}`;
          return `<section class="box card ${b.done ? 'done' : ''}">
            <div class="row">${chk(p + '.done', 'Done')}<span class="label">I'm going to…</span>
              <button class="star-btn ${b.star ? 'on' : ''}" data-act="toggle" data-path="${p}.star" aria-label="Star">★</button>
              <button class="x" data-act="del" data-path="bucket" data-id="${b.id}" aria-label="Remove">×</button></div>
            <input class="inline title" data-bind="${p}.text" value="${esc(b.text)}">
            <label>Budget $ ${inp(p + '.budget')}</label>
            <label>Target dates ${inp(p + '.target')}</label>
            <label class="field">Details and ideas ${ta(p + '.details', '', 2)}</label>
          </section>`;
        }).join('')}</div>
        <form class="add" data-add="bucket"><input name="text" placeholder="I'm going to…" required><button aria-label="Add">+</button></form>`;
    } else if (tab === 'hobbies') {
      const cyc = currentCycle();
      const goals = cyc ? cycleGoals(cyc.id) : [];
      body += `<p class="prompt">Plan hobbies and personal projects as next steps. Link each to a goal so the work counts.</p>
        <div class="cards">${state.projects.map((pr) => {
          const p = `projects.@${pr.id}`;
          const steps = pr.steps || [];
          const d = steps.filter((x) => x.done).length;
          return `<section class="box card status-${pr.status}">
            <div class="row"><input class="inline title grow" data-bind="${p}.name" value="${esc(pr.name)}" aria-label="Project name">
              <button class="x" data-act="del" data-path="projects" data-id="${pr.id}" aria-label="Remove">×</button></div>
            <div class="row">
              <select data-bind="${p}.status" data-rerender aria-label="Status">${opts([{ v: 'idea', l: 'Idea' }, { v: 'active', l: 'Active' }, { v: 'paused', l: 'Paused' }, { v: 'done', l: 'Done ✓' }], pr.status)}</select>
              <select class="link" data-bind="${p}.goalId" aria-label="Linked goal">${goalOpts(goals, pr.goalId)}</select>
              <small class="muted">${d}/${steps.length} steps</small></div>
            <h3>Next steps</h3>
            ${simpleList(p + '.steps', steps, 'Add a step…')}
            <label class="field">Notes ${ta(p + '.notes', 'Gear, budget, ideas…', 2)}</label>
          </section>`;
        }).join('')}</div>
        <form class="add" data-add="projects"><input name="name" placeholder="New hobby or project (e.g. SHOT novice division prep)" required><button aria-label="Add project">+</button></form>`;
    } else if (tab === 'shopping') {
      body += `<section class="box"><h2>Shopping list</h2>
        <p class="prompt">One running list. It also shows on each Week page.</p>
        ${simpleList('shopping', state.shopping, 'Add item…')}
        ${state.shopping.some((x) => x.done) ? '<button class="btn ghost small" data-act="clearShopping">Clear purchased</button>' : ''}</section>`;
    } else if (tab === 'reading') {
      body += `<p class="prompt">Mix personal growth, skill-building, biographies, passions, and some just for fun.</p>
        <div class="cards">${state.reading.map((r) => {
          const p = `reading.@${r.id}`;
          return `<section class="box card ${r.done ? 'done' : ''}">
            <div class="row">${chk(p + '.done', 'Finished')}<input class="inline title grow" data-bind="${p}.title" value="${esc(r.title)}" aria-label="Title">
              <button class="x" data-act="del" data-path="reading" data-id="${r.id}" aria-label="Remove">×</button></div>
            <label>By/On ${inp(p + '.by')}</label>
            <label>Genre ${inp(p + '.genre')}</label>
            <label class="field">In a nutshell ${ta(p + '.nutshell', '', 2)}</label>
          </section>`;
        }).join('')}</div>
        <form class="add" data-add="reading"><input name="title" placeholder="Title" required><button aria-label="Add">+</button></form>`;
    } else if (tab === 'journal') {
      const today_iso = U.toISO(today());
      const sorted = state.journals.slice().sort((a, b) => (b.date < a.date ? -1 : 1));
      body += `<p class="prompt">Daily thoughts and reflections. Searchable by date or tag.</p>
        <form class="add" data-add="journals"><input type="date" name="date" value="${today_iso}" required><input name="text" placeholder="Today's thoughts…" required><button aria-label="Add">+</button></form>
        <div class="cards">${sorted.map((j) => {
          const p = `journals.@${j.id}`;
          return `<section class="box card ${j.date === today_iso ? 'hot' : ''}">
            <div class="row"><time>${U.fmtDate(j.date, { weekday: 'short', month: 'short', day: 'numeric' })}</time>
              <button class="x" data-act="del" data-path="journals" data-id="${j.id}" aria-label="Remove">×</button></div>
            <textarea class="inline" data-bind="${p}.text" rows="3">${esc(j.text)}</textarea>
          </section>`;
        }).join('')}</div>`;
    } else {
      body += `<p class="prompt">Give each note in your physical planner a topic and page number so it's easy to find.</p>
        <section class="box"><table class="index"><thead><tr><th>Note topic</th><th>Page</th><th></th></tr></thead><tbody>
        ${state.notesIndex.slice().sort((a, b) => (Number(a.page) || 0) - (Number(b.page) || 0)).map((n) => `<tr>
          <td><input class="inline" data-bind="notesIndex.@${n.id}.topic" value="${esc(n.topic)}"></td>
          <td><input class="inline num" data-bind="notesIndex.@${n.id}.page" value="${esc(n.page)}"></td>
          <td><button class="x" data-act="del" data-path="notesIndex" data-id="${n.id}" aria-label="Remove">×</button></td></tr>`).join('')}
        </tbody></table>
        <form class="add" data-add="notesIndex"><input name="topic" placeholder="Topic" required><input name="page" class="num" placeholder="Pg"><button aria-label="Add">+</button></form></section>`;
    }
    return page('Lists', '', body);
  }

  function viewSettings() {
    const s = state.settings;
    const canNotify = typeof Notification !== 'undefined';
    const notifPerm = canNotify ? Notification.permission : null;
    const hasCalendar = !!localStorage.getItem('google_access_token');
    const currentApiBase = localStorage.getItem('api_base') || API_BASE;
    const body = `
      <section class="box"><h2>Integrations</h2>
        <div class="row wrap">
          ${hasCalendar ? `<div style="flex:1"><p class="muted small">✓ Google Calendar connected</p><button class="btn small ghost danger" data-act="disconnectCalendar">Disconnect</button></div>` : `<button class="btn" data-act="connectCalendar">Connect Google Calendar</button>`}
          <button class="btn" data-act="uploadPhoto">Upload photo (OCR)</button>
        </div>
        <label>Backend URL <input type="text" id="apiBaseInput" value="${esc(currentApiBase)}" placeholder="https://..." style="flex:1;"></label>
        <p class="muted small">Connected to backend for Calendar sync and photo OCR. Ask your admin for the URL.</p>
      </section>
      <section class="box"><h2>Planner</h2>
        <div class="row wrap">
          <label>Planner year starts in <select data-bind="settings.plannerStartMonth" data-type="number" data-rerender>${opts(U.MONTHS.map((m, i) => ({ v: i, l: m })), s.plannerStartMonth)}</select></label>
          <label>Week starts on <select data-bind="settings.weekStart" data-type="number" data-rerender>${opts([{ v: 0, l: 'Sunday' }, { v: 1, l: 'Monday' }], s.weekStart)}</select></label>
          <label>Default goal cycle <select data-bind="settings.cycleMonths" data-type="number">${opts([{ v: 6, l: '6 months' }, { v: 3, l: '3 months' }], s.cycleMonths)}</select></label>
        </div>
        <p class="muted small">Changing the week start after you've planned weeks will hide those weeks (they're stored by start date).</p>
      </section>
      ${canNotify ? `<section class="box"><h2>Reminders</h2>
        <label class="row"><input type="checkbox" data-bind="settings.notificationsEnabled" data-rerender> Browser notifications for rituals and goals</label>
        ${notifPerm === 'granted' ? `<div class="row wrap">
          <label>Notify me at <input type="time" data-bind="settings.notificationTime" data-rerender value="${esc(s.notificationTime)}"></label>
          <label>Quiet hours <input type="time" data-bind="settings.quietStart" value="${esc(s.quietStart)}"> to <input type="time" data-bind="settings.quietEnd" value="${esc(s.quietEnd)}"></label>
        </div>` : notifPerm === 'denied' ? '<p class="muted small">⚠️ Notifications are blocked. Check your browser settings.</p>' : s.notificationsEnabled ? '<p class="muted small">Enable notifications for rituals due, habit milestones, and goal check-ins.</p>' : ''}
      </section>` : ''}
      <section class="box"><h2>Your data</h2>
        <p>Everything is stored only in this browser. Export a backup regularly, and use it to move between devices.</p>
        <div class="row wrap">
          <button class="btn" data-act="export">Export backup (.json)</button>
          <button class="btn ghost" data-act="loadSamples">Load sample goals</button>
          ${state.goals.some((g) => g.seed) ? '<button class="btn ghost" data-act="removeSamples">Remove sample goals</button>' : ''}
          <label class="btn ghost file">Import backup<input type="file" accept="application/json,.json" data-import hidden></label>
          <button class="btn ghost danger" data-act="reset">Erase all data</button>
        </div>
      </section>`;
    return page('Settings', '', body);
  }

  /* ---------- copy-for-planner text ---------- */
  function actionsText(list) {
    return AREAS.map((a) => {
      const l = list.filter((i) => i.area === a.id);
      return l.length ? `${a.name}\n${l.map((i) => `  ${i.done ? '✓' : '○'} ${i.text}`).join('\n')}` : '';
    }).filter(Boolean).join('\n\n');
  }
  function monthText(mk) {
    const m = getMonth(mk), d = U.parseMonthKey(mk);
    const days = U.daysInMonth(d.getFullYear(), d.getMonth());
    const evs = [];
    for (let i = 1; i <= days; i++) {
      const iso = `${mk}-${U.pad(i)}`;
      U.eventsOn(state.events, iso).forEach((e) => {
        if (e.yearly || e.start === iso || i === 1) evs.push(`  ${i}: ${e.text}`);
      });
    }
    return `${U.MONTHS[d.getMonth()].toUpperCase()} ${d.getFullYear()}\n\nKEY DATES\n${evs.join('\n') || '  —'}\n\nGOALS & PRIORITY ACTIONS FOR THE MONTH\n${actionsText(m.actions) || '  —'}`;
  }
  function weekText(wk) {
    const w = getWeek(wk), wom = U.weekOfMonth(U.parseISO(wk));
    const end = U.toISO(U.addDays(U.parseISO(wk), 6));
    const sched = state.schedule.filter((s) => s.date >= wk && s.date <= end)
      .sort((a, b) => ((a.date + (a.time || '99')) < (b.date + (b.time || '99')) ? -1 : 1))
      .map((s) => `  ${U.DAYS[U.parseISO(s.date).getDay()].slice(0, 3)} ${s.time ? fmtTime(s.time) + ' ' : ''}${s.text}`);
    const wos = state.workouts.filter((x) => x.date >= wk && x.date <= end).sort((a, b) => (a.date < b.date ? -1 : 1));
    const shop = state.shopping.filter((x) => !x.done);
    return `WEEK ${wom.n} OF ${U.MONTHS[wom.month].toUpperCase()}\n\nPRIORITY ACTIONS FOR THE WEEK\n${actionsText(w.actions) || '  —'}\n\nHABIT TRACKER\n${w.habits.map((h) => `  ${h.name} x${h.target}`).join('\n') || '  —'}${w.notToDo.length ? `\n\nNOT-TO-DO\n${w.notToDo.map((n) => `  ⊘ ${n.text}`).join('\n')}` : ''}${sched.length ? `\n\nSCHEDULE\n${sched.join('\n')}` : ''}${wos.length ? `\n\nWORKOUTS\n${wos.map((x) => `  ${U.DAYS[U.parseISO(x.date).getDay()].slice(0, 3)}: ${x.type}${x.details ? ` (${x.details})` : ''}`).join('\n')}` : ''}${shop.length ? `\n\nTO BUY\n${shop.map((n) => `  ○ ${n.text}`).join('\n')}` : ''}`;
  }
  function showText(title, text) {
    const dlg = document.getElementById('dlg');
    dlg.querySelector('h2').textContent = title;
    dlg.querySelector('textarea').value = text;
    dlg.showModal();
  }

  /* ---------- actions ---------- */
  const DEFAULTS = {
    goals: () => ({ area: 'work', tier: 'pursuit', progress: 0, status: 'active', target: '', doneBy: '', measure: '', kind: 'achievement', why: '', perWeek: 5, log: {}, milestones: [], objectives: [], routines: [] }),
    milestones: () => ({ done: false, due: '' }),
    objectives: () => ({ done: false, due: '' }),
    routines: () => ({ perWeek: 1, log: {} }),
    actions: () => ({ done: false, goalId: '' }),
    habits: () => ({ target: 5, days: [false, false, false, false, false, false, false] }),
    shopping: () => ({ done: false }),
    steps: () => ({ done: false }),
    schedule: () => ({ time: '' }),
    workouts: () => ({ done: false, details: '', minutes: '', time: '' }),
    projects: () => ({ status: 'active', goalId: '', notes: '', steps: [] }),
    bucket: () => ({ star: false, done: false, budget: '', target: '', details: '' }),
    reading: () => ({ done: false, by: '', genre: '', nutshell: '' }),
    events: () => ({ end: '', yearly: false }),
    roles: () => ({ why: '' }),
    journals: () => ({ text: '' }),
  };

  function nextCycle(id) {
    const cyc = state.cycles.find((c) => c.id === id);
    const months = Number(state.settings.cycleMonths) || 6;
    const start = U.toISO(U.addDays(U.parseISO(cyc.end), 1));
    const dates = U.makeCycleDates(start, months);
    const nc = { id: S.uid(), name: U.cycleName(dates.start, dates.end), ...dates, review: {}, roleActions: JSON.parse(JSON.stringify(cyc.roleActions || {})) };
    state.cycles.push(nc);
    const open = state.goals.filter((g) => g.cycleId === id && g.status === 'active');
    if (open.length && confirm(`Carry ${open.length} unfinished goal${open.length > 1 ? 's' : ''} into ${nc.name}?`)) {
      open.forEach((g) => state.goals.push({ ...JSON.parse(JSON.stringify(g)), id: S.uid(), cycleId: nc.id, carriedFrom: g.id }));
    }
    commit();
    location.hash = `#/goals/${nc.id}`;
  }

  const ACTS = {
    del(el) {
      const list = get(el.dataset.path);
      if (!Array.isArray(list)) return;
      const i = list.findIndex((x) => x.id === el.dataset.id);
      if (i >= 0) list.splice(i, 1);
      commit();
    },
    toggle(el) { S.setPath(state, el.dataset.path, !get(el.dataset.path)); commit(); },
    quickAction(el) {
      const g = state.goals.find((x) => x.id === el.dataset.goal);
      get(el.dataset.path).push({ id: S.uid(), area: el.dataset.area, text: g ? g.title : '', goalId: el.dataset.goal, done: false });
      commit();
    },
    delRole(el) {
      const r = state.roles.find((x) => x.id === el.dataset.id);
      if (!confirm(`Delete role "${r.name}"? Its goals will be kept under "Goals without a role".`)) return;
      state.roles = state.roles.filter((x) => x.id !== r.id);
      commit();
    },
    delCycle(el) {
      const c = state.cycles.find((x) => x.id === el.dataset.id);
      if (!confirm(`Delete cycle "${c.name}" and its goals?`)) return;
      state.cycles = state.cycles.filter((x) => x.id !== c.id);
      state.goals = state.goals.filter((g) => g.cycleId !== c.id);
      commit(); location.hash = '#/goals';
    },
    nextCycle(el) { nextCycle(el.dataset.id); },
    pulse(el) {
      const w = getWeek(el.dataset.key);
      w.pulse[el.dataset.goal] = w.pulse[el.dataset.goal] === el.dataset.v ? undefined : el.dataset.v;
      commit();
    },
    rate(el) { const w = getWeek(el.dataset.key); const v = Number(el.dataset.v); w.rating = w.rating === v ? 0 : v; commit(); },
    carryWeek(el) {
      const prevKey = U.toISO(U.addDays(U.parseISO(el.dataset.key), -7));
      const prev = state.weeks[prevKey];
      const w = getWeek(el.dataset.key);
      const open = prev ? prev.actions.filter((a) => !a.done && !w.actions.some((b) => b.text === a.text)) : [];
      open.forEach((a) => w.actions.push({ ...a, id: S.uid() }));
      toast(open.length ? `Brought forward ${open.length}` : 'Nothing unfinished last week');
      commit();
    },
    pullMonth(el) {
      const wom = U.weekOfMonth(U.parseISO(el.dataset.key));
      const m = state.months[wom.monthKey];
      const w = getWeek(el.dataset.key);
      const open = m ? m.actions.filter((a) => !a.done && !w.actions.some((b) => b.text === a.text)) : [];
      open.forEach((a) => w.actions.push({ ...a, id: S.uid() }));
      toast(open.length ? `Pulled ${open.length} from the month` : 'No open monthly actions');
      commit();
    },
    copyMonth(el) { showText('Copy to your monthly spread', monthText(el.dataset.key)); },
    copyWeek(el) { showText('Copy to your weekly spread', weekText(el.dataset.key)); },
    export() {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `lifeos-backup-${todayISO()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    reset() {
      if (!confirm('Erase ALL Life.OS data in this browser? Export a backup first if unsure.')) return;
      state = S.defaultState(); commit();
    },
    clearShopping() { state.shopping = state.shopping.filter((x) => !x.done); commit(); },
    copyDlg() {
      const t = document.querySelector('#dlg textarea');
      t.select();
      (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject())
        .then(() => toast('Copied'), () => { document.execCommand('copy'); toast('Copied'); });
    },
    connectCalendar() { startGoogleOAuth(); },
    disconnectCalendar() {
      if (!confirm('Disconnect Google Calendar?')) return;
      localStorage.removeItem('google_access_token');
      localStorage.removeItem('google_refresh_token');
      commit();
    },
    uploadPhoto() { document.getElementById('uploadDlg').showModal(); },
    loadSamples() {
      if (state.goals.some((g) => g.seed) && !confirm('Sample goals are already loaded. Add them again?')) return;
      seedStarter(); commit(); toast('Sample goals added. See Roles & Goals.');
    },
    removeSamples() {
      if (!confirm('Remove the sample roles and goals? Your own goals are kept.')) return;
      removeSamples(); commit();
    },
    delBatch(el) {
      const n = state.workouts.filter((x) => x.batch === el.dataset.id).length;
      if (!confirm(`Remove all ${n} sessions from this plan?`)) return;
      state.workouts = state.workouts.filter((x) => x.batch !== el.dataset.id);
      commit();
    },
    pushWorkouts() {
      const iso = todayISO();
      pushToGoogleCalendar(state.workouts.filter((x) => x.date >= iso && !x.done && x.type)
        .map((x) => ({ date: x.date, time: x.time, text: `${x.type}${x.details ? ` – ${x.details}` : ''}` })));
    },
  };

  /* Keep one progress value per goal per day so trends can be charted. */
  function recordGoalHistory(path) {
    const m = /^goals\.@([^.]+)\.progress$/.exec(path);
    if (!m) return;
    const g = state.goals.find((x) => x.id === m[1]);
    if (!g) return;
    const iso = todayISO();
    g.history = (g.history || []).filter((h) => h.date !== iso);
    g.history.push({ date: iso, v: Number(g.progress) || 0 });
    g.history.sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  /* Hover tooltips for chart marks ([data-tip]). */
  const tip = document.getElementById('tip');
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el) { tip.hidden = true; return; }
    tip.textContent = el.getAttribute('data-tip');
    tip.hidden = false;
    placeTip(e.clientX, e.clientY);
  });
  function placeTip(cx, cy) {
    const x = Math.max(8, Math.min(cx - tip.offsetWidth / 2, window.innerWidth - tip.offsetWidth - 8));
    const y = cy - tip.offsetHeight - 14 < 8 ? cy + 18 : cy - tip.offsetHeight - 14;
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }
  window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
  document.addEventListener('mousemove', (e) => {
    if (!tip.hidden) placeTip(e.clientX, e.clientY);
  });

  /* ---------- events ---------- */
  function readValue(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.dataset.type === 'number') return el.value === '' ? '' : Number(el.value);
    return el.value;
  }
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset || !el.dataset.bind || el.type === 'checkbox' || el.tagName === 'SELECT') return;
    S.setPath(state, el.dataset.bind, readValue(el));
    recordGoalHistory(el.dataset.bind);
    if (el.type === 'range' && el.nextElementSibling && el.nextElementSibling.tagName === 'OUTPUT') el.nextElementSibling.textContent = `${el.value}%`;
    persist();
  });
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset && 'wheel' in el.dataset && el.nextElementSibling) el.nextElementSibling.textContent = el.value;
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('[data-nav]')) { location.hash = el.value; return; }
    if (el.matches('[data-import]')) { importFile(el.files[0]); return; }
    if (el.matches('[data-wofile]')) {
      const f = el.files[0]; if (!f) return;
      f.text().then((t) => { const ta2 = el.closest('form').querySelector('textarea'); ta2.value = t; toast(`Loaded ${f.name}. Review, then Import.`); });
      return;
    }
    if (!el.dataset || !el.dataset.bind) return;
    if (el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'date' || 'rerender' in el.dataset) {
      S.setPath(state, el.dataset.bind, readValue(el));
      if ('rerender' in el.dataset) commit(); else persist();
    }
  });
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (form.dataset.actForm === 'newCycle') {
      e.preventDefault();
      const fd = new FormData(form);
      const months = Number(fd.get('months')) || 6;
      const dates = U.makeCycleDates(fd.get('start'), months);
      const c = { id: S.uid(), name: U.cycleName(dates.start, dates.end), ...dates, review: {}, roleActions: {} };
      state.cycles.push(c); state.settings.cycleMonths = months;
      commit(); location.hash = `#/goals/${c.id}`;
      return;
    }
    if (form.dataset.actForm === 'workoutPlan' || form.dataset.actForm === 'workoutImport') {
      e.preventDefault();
      const fd = new FormData(form);
      let rows, name;
      if (form.dataset.actForm === 'workoutPlan') {
        const dows = [0, 1, 2, 3, 4, 5, 6].filter((d) => fd.get(`on_${d}`) && String(fd.get(`type_${d}`) || '').trim());
        if (!dows.length) { toast('Tick at least one day and give it a type'); return; }
        name = String(fd.get('name') || '').trim() || 'Workout plan';
        rows = U.planDates(fd.get('start'), Number(fd.get('weeks')) || 4, dows).map(({ dow, date }) => ({
          date, type: String(fd.get(`type_${dow}`)).trim(), time: fd.get(`time_${dow}`) || '',
          minutes: fd.get(`min_${dow}`) === '' ? '' : Number(fd.get(`min_${dow}`)), details: String(fd.get(`details_${dow}`) || '').trim(),
        }));
      } else {
        const r = U.parseWorkoutText(fd.get('text'), today().getFullYear());
        name = `Import ${todayISO()}`;
        rows = r.workouts;
        if (!rows.length) { toast(r.bad.length ? `Couldn't read ${r.bad.length} line${r.bad.length > 1 ? 's' : ''}. Use: date, type, minutes, details` : 'Paste or choose something to import'); return; }
        if (r.bad.length) toast(`Skipped ${r.bad.length} unreadable line${r.bad.length > 1 ? 's' : ''}`);
      }
      const batch = S.uid();
      let added = 0;
      rows.forEach((w) => {
        if (state.workouts.some((x) => x.date === w.date && x.type.toLowerCase() === w.type.toLowerCase())) return;
        state.workouts.push({ id: S.uid(), done: false, batch, batchName: name, ...w }); added++;
      });
      commit(); toast(added ? `Scheduled ${added} workout${added > 1 ? 's' : ''}` : 'Those workouts were already scheduled');
      return;
    }
    if (form.dataset.actForm === 'wheel') {
      e.preventDefault();
      const fd = new FormData(form);
      const date = fd.get('date') || todayISO();
      const scores = {};
      WHEEL.forEach((a) => { scores[a.id] = Number(fd.get(`s_${a.id}`)) || 5; });
      state.wheel = state.wheel.filter((x) => x.date !== date);
      state.wheel.push({ id: S.uid(), date, scores, note: String(fd.get('note') || '').trim() });
      commit(); toast('Assessment saved');
      return;
    }
    if (!form.dataset.add) return;
    e.preventDefault();
    const path = form.dataset.add;
    let list = get(path);
    if (!Array.isArray(list)) { S.setPath(state, path, []); list = get(path); }
    const kind = path.split('.').pop();
    const item = Object.assign({ id: S.uid() }, (DEFAULTS[kind] || (() => ({})))());
    if (form.dataset.area) item.area = form.dataset.area;
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') item[el.name] = el.checked;
      else if (el.type === 'number') item[el.name] = el.value === '' ? (item[el.name] != null ? item[el.name] : '') : Number(el.value);
      else item[el.name] = el.value.trim();
    }
    list.push(item);
    commit();
    if (item.kind === 'habit' && path === 'goals') toast('Habit added. Tick it off each day on Today.');
    const again = document.querySelector(`form[data-add="${CSS.escape(path)}"]${form.dataset.area ? `[data-area="${form.dataset.area}"]` : ''} input:not([type=hidden])`);
    if (again) again.focus();
  });
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !ACTS[el.dataset.act]) return;
    e.preventDefault();
    ACTS[el.dataset.act](el);
  });

  function importFile(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!data || typeof data !== 'object' || !('foundation' in data || 'goals' in data)) throw new Error('Not a Life.OS backup');
        if (!confirm('Replace all current data with this backup?')) return;
        state = S.migrate(data); commit(); toast('Imported');
      } catch (err) { alert(`Import failed: ${err.message}`); }
    };
    r.readAsText(file);
  }


  /* ---------- starter goals (first run, or Settings -> Load sample goals) ---------- */
  function seedStarter() {
    const t = today();
    let cyc = currentCycle();
    if (!cyc) {
      const dates = U.makeCycleDates(U.toISO(new Date(t.getFullYear(), t.getMonth(), 1)), Number(state.settings.cycleMonths) || 6);
      cyc = { id: S.uid(), name: U.cycleName(dates.start, dates.end), ...dates, review: {}, roleActions: {} };
      state.cycles.push(cyc);
    }
    const inDays = (n) => U.toISO(U.addDays(t, n));
    const role = (name, why) => { const r = { id: S.uid(), name, why, seed: true }; state.roles.push(r); return r.id; };
    const parent = role('Parent', 'Be present and intentional with my kids while they are young.');
    const healthy = role('Healthy person', 'Energy and health let me show up well for everything else.');
    const pro = role('Professional', 'Grow in skill and contribute work I am proud of.');
    const goal = (roleId, o) => state.goals.push({
      id: S.uid(), cycleId: cyc.id, roleId, area: 'health', tier: 'pursuit', progress: 0, status: 'active', target: cyc.end, doneBy: cyc.end,
      measure: '', kind: 'achievement', why: '', perWeek: 5, log: {}, milestones: [], objectives: [], routines: [], seed: true, ...o });
    const item = (text, due) => ({ id: S.uid(), text, due: due || '', done: false });
    const routine = (text, perWeek) => ({ id: S.uid(), text, perWeek, log: {} });

    // Habit goals: tracked daily on Today
    goal(parent, { kind: 'habit', title: 'Read to the kids before bed', perWeek: 7, area: 'home', tier: 'purpose', why: 'Bedtime stories build connection and a love of reading.', measure: 'At least one book or chapter together' });
    goal(parent, { kind: 'habit', title: 'Spend time outside with the kids', perWeek: 7, area: 'fun', why: 'Fresh air and shared adventures make the best memories.', measure: '20+ minutes outdoors together' });
    goal(healthy, { kind: 'habit', title: 'Workout', perWeek: 5, area: 'health', tier: 'purpose', why: 'Strength and stamina for the life I want to live.', measure: '30+ minutes of intentional exercise' });
    goal(healthy, { kind: 'habit', title: 'Ride horses', perWeek: 5, area: 'fun', why: 'It is my time to recharge and do something I love.' });
    goal(pro, { kind: 'habit', title: 'Read a book', perWeek: 7, area: 'projects', why: 'Reading keeps me learning and curious.', measure: '20+ pages' });

    // Achievement goals: why, milestones, quarterly objectives, routines
    goal(healthy, { title: 'Run a 10K', area: 'health', why: 'Proving to myself that I can build a hard thing step by step.', measure: 'Finish a 10K race without walking',
      milestones: [item('Run 5K without stopping', inDays(30)), item('Run 8K', inDays(75)), item('Register for a 10K race', inDays(45)), item('Finish the 10K', inDays(120))],
      objectives: [item('Build to 12 miles per week', inDays(75)), item('Complete a 4-week base plan', inDays(28))],
      routines: [routine('Run', 3)] });
    goal(parent, { title: 'Take a family trip together', area: 'fun', tier: 'purpose', why: 'Shared experiences become the stories we tell for years.', measure: 'Trip taken and photos printed',
      milestones: [item('Pick the destination and dates', inDays(21)), item('Book travel and lodging', inDays(45)), item('Plan activities with the kids', inDays(80))],
      objectives: [item('Set aside the trip budget', inDays(30))],
      routines: [] });
    goal(pro, { title: 'Complete one skill-building course', area: 'work', why: 'Investing in skills opens the next opportunity.', measure: 'Certificate or finished project',
      milestones: [item('Choose the course', inDays(14)), item('Finish half the lessons', inDays(60)), item('Finish the final project', inDays(110))],
      objectives: [item('Block recurring study time on the calendar', inDays(7))],
      routines: [routine('Study session', 3)] });
  }
  function removeSamples() {
    state.goals = state.goals.filter((g) => !g.seed);
    state.roles = state.roles.filter((r) => !r.seed);
  }

  /* ---------- router ---------- */
  const ROUTES = {
    today: viewToday, foundation: viewFoundation, goals: viewGoals, year: viewYear,
    month: viewMonth, week: viewWeek, track: viewTrack, wheel: viewWheel, lists: viewLists, settings: viewSettings,
  };
  function render() {
    const [, name = 'today', arg] = (location.hash || '#/today').split('/');
    const view = ROUTES[name] || viewToday;
    const y = window.scrollY;
    const focused = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.bind;
    app.innerHTML = view(arg);
    const active = ROUTES[name] ? name : 'today';
    document.querySelectorAll('[data-route]').forEach((a) => {
      a.classList.toggle('sel', a.dataset.route === active);
      if (a.dataset.route === active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    moreBtn.classList.toggle('sel', moreBtn.dataset.moreRoutes.split(' ').includes(active));
    setMore(false);
    if (render.last === location.hash) window.scrollTo(0, y); else window.scrollTo(0, 0);
    render.last = location.hash;
    if (focused) { const f = app.querySelector(`[data-bind="${CSS.escape(focused)}"]`); if (f) f.focus(); }
  }
  const moreBtn = document.getElementById('moreBtn');
  const moreSheet = document.getElementById('moreSheet');
  function setMore(open) { moreSheet.hidden = !open; moreBtn.setAttribute('aria-expanded', String(open)); }
  moreBtn.addEventListener('click', (e) => { e.stopPropagation(); setMore(moreSheet.hidden); });
  document.addEventListener('click', (e) => {
    if (!moreSheet.hidden && (!moreSheet.contains(e.target) || e.target.closest('a'))) setMore(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMore(false); });
  (async function finishGoogleLogin() {
    const code = new URLSearchParams(location.search).get('code');
    if (!code) return;
    history.replaceState(null, '', location.pathname + (location.hash || '#/settings'));
    try {
      const res = await fetch(`${API_BASE}/api/auth/google/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code })
      });
      if (!res.ok) throw new Error(await res.text());
      const t = await res.json();
      localStorage.setItem('google_access_token', t.access_token);
      if (t.refresh_token) localStorage.setItem('google_refresh_token', t.refresh_token);
      toast('Google Calendar connected');
      render();
    } catch (e) { console.error('Google login failed:', e); toast('Google login failed'); }
  })();
  (function promptLogin() {
    const dlg = document.getElementById('loginDlg');
    if (!dlg || location.protocol === 'file:') return;
    let seen = false, hasToken = false;
    try { seen = !!localStorage.getItem('login_prompt_seen'); hasToken = !!localStorage.getItem('google_access_token'); } catch (e) {}
    if (seen || hasToken || new URLSearchParams(location.search).get('code')) return;
    document.getElementById('loginGoogleBtn').addEventListener('click', () => {
      try { localStorage.setItem('login_prompt_seen', '1'); } catch (e) {}
      startGoogleOAuth();
    });
    document.getElementById('loginSkipBtn').addEventListener('click', () => {
      try { localStorage.setItem('login_prompt_seen', '1'); } catch (e) {}
    });
    dlg.addEventListener('cancel', () => { try { localStorage.setItem('login_prompt_seen', '1'); } catch (e) {} });
    dlg.showModal();
  })();
  window.addEventListener('hashchange', render);
  window.addEventListener('storage', (e) => { if (e.key === S.KEY) { state = S.load(); render(); } });
  document.getElementById('copyBtn').addEventListener('click', () => ACTS.copyDlg());

  const uploadInput = document.getElementById('uploadInput');
  const uploadDlg = document.getElementById('uploadDlg');
  const ocrResultDlg = document.getElementById('ocrResultDlg');

  const apiBaseInput = document.getElementById('apiBaseInput');
  if (apiBaseInput) {
    apiBaseInput.addEventListener('blur', (e) => {
      const url = e.target.value.trim();
      if (url && url.startsWith('http')) {
        localStorage.setItem('api_base', url);
        toast('Backend URL updated');
      }
    });
  }

  let ocrSuggestions = [];
  uploadInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    toast('Reading photo…');
    try {
      const { type, data, suggestions = [] } = await uploadPhotoOCR(file);
      ocrSuggestions = suggestions;
      document.getElementById('ocrType').textContent = `Detected: ${type}`;
      document.getElementById('ocrPreview').innerHTML = `<pre>${esc(JSON.stringify(data, null, 2).slice(0, 800))}</pre>`;
      document.getElementById('routeButtons').innerHTML = suggestions.map((s, i) => `<button type="button" class="btn" data-ocr-route="${i}">→ ${esc(s.label)}</button>`).join('');
      uploadDlg.close();
      ocrResultDlg.showModal();
    } catch (err) {
      toast(`OCR failed: ${err.message}`.slice(0, 120));
      console.error(err);
    } finally { uploadInput.value = ''; }
  });
  document.getElementById('routeButtons').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ocr-route]');
    const s = btn && ocrSuggestions[Number(btn.dataset.ocrRoute)];
    if (!s) return;
    ocrResultDlg.close();
    addOCRDataToApp(s.route, s.data);
  });

  if (firstRun) { seedStarter(); S.save(state); }
  render();
  checkNotifications();
})();
