/* Life.OS — application: router, views and interactions. */
(function () {
  'use strict';
  const U = window.LifeUtil;
  const S = window.LifeStore;
  const P = window.LifePlan;

  let firstRun = false;
  try { firstRun = localStorage.getItem(S.KEY) === null; } catch (e) { /* storage unavailable */ }
  let state = S.load();
  const F = {};            // features.js plugs tasks, search, templates, summaries and print layouts in here
  const rawSave = S.save;
  /* Undo history: a snapshot of the plan before each change (rapid typing counts as one change). */
  const hist = { undo: [], redo: [], last: '', at: 0, bytes: 0, ids: null };
  hist.last = JSON.stringify(state);
  /* Deletions leave tombstones so a sync never brings deleted items back from another device. */
  const trackIds = () => { const cur = P.idsOf(state); if (!state.tomb) state.tomb = {}; if (hist.ids) P.recordDeletions(state.tomb, hist.ids, cur, U.toISO(new Date())); hist.ids = cur; };
  const rebaseIds = () => { hist.ids = P.idsOf(state); };     // after replacing the whole plan (import, restore, sign-out): not deletions
  rebaseIds();
  S.save = (st) => {
    if (st === state) {
      trackIds();
      const now = JSON.stringify(st);
      if (now !== hist.last) {
        if (Date.now() - hist.at > 1500 || !hist.undo.length) {
          hist.undo.push(hist.last); hist.bytes += hist.last.length;
          while (hist.undo.length > 60 || hist.bytes > 24e6) hist.bytes -= hist.undo.shift().length;
        }
        hist.at = Date.now(); hist.redo = []; hist.last = now;
      }
    }
    const ok = rawSave(st); if (st === state) scheduleSync(); return ok;
  };
  function applySnapshot(snap) {
    const keep = { lastNotifications: state.lastNotifications, gcalCalendars: state.gcalCalendars, syncMeta: state.syncMeta };
    state = S.migrate(JSON.parse(snap)); Object.assign(state, keep); trackIds(); hist.last = JSON.stringify(state); hist.at = 0;
    rawSave(state); scheduleSync(); render();
  }
  function undo() {
    if (!hist.undo.length) { toast('Nothing to undo'); return false; }
    const snap = hist.undo.pop(); hist.bytes -= snap.length; hist.redo.push(hist.last); applySnapshot(snap); toast('Undone', { label: 'Redo', fn: redo }); return true;
  }
  function redo() {
    if (!hist.redo.length) { toast('Nothing to redo'); return false; }
    hist.undo.push(hist.last); applySnapshot(hist.redo.pop()); toast('Redone'); return true;
  }
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

  let toastTimer, toastAct = null;
  function toast(msg, action) {
    const t = document.getElementById('toast');
    t.textContent = msg; toastAct = action || null;
    if (action) { const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-act'; b.textContent = action.label; b.addEventListener('click', () => { const f = toastAct; toastAct = null; t.classList.remove('show'); if (f) f.fn(); }); t.append(' ', b); }
    t.classList.toggle('actionable', !!action); t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6000 : 1200);
  }

  const areaName = (id) => (P.LIFE.find((a) => a.id === id) || { name: 'Other' }).name;
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

  /* ---------- quarterly focus & daily Big 3 ---------- */
  const quarterKey = (iso) => { const d = U.parseISO(iso); return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`; };
  const quarterLabel = (iso) => quarterKey(iso).replace(/^(\d{4})-(Q\d)$/, '$2 $1');
  function focusGoals(iso) {
    return ((state.focus || {})[quarterKey(iso)] || []).map((id) => state.goals.find((g) => g.id === id)).filter((g) => g && g.status === 'active');
  }
  function nextStep(g, exclude) {
    const items = [];
    ['objectives', 'milestones'].forEach((k) => (g[k] || []).forEach((i) => items.push({ ...i, ref: `goals.@${g.id}.${k}.@${i.id}` })));
    return items.filter((i) => !i.done && i.text && !(exclude && exclude.has(i.ref)))
      .sort((a, b) => ((a.due || '9') < (b.due || '9') ? -1 : 1))[0];
  }
  /* Pre-populate today's Big 3: carry unfinished items forward, then take each focus goal's next step. */
  function autoFillBig3(iso) {
    if (state.bigAuto[iso]) return;
    state.big3.filter((b) => b.done && b.stepRef).forEach((b) => { const it = get(b.stepRef); if (it && !it.done) it.done = true; });
    const have = state.big3.filter((b) => b.date === iso);
    if (have.length >= 3) { state.bigAuto[iso] = true; return; }
    const used = new Set(state.big3.filter((b) => b.stepRef && (b.done || b.date === iso)).map((b) => b.stepRef));
    let added = 0;
    const room = () => 3 - have.length - added;
    state.big3.filter((b) => b.date < iso && !b.done && !b.migrated).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, room()).forEach((b) => {
      b.migrated = true; state.big3.push({ id: S.uid(), date: iso, text: b.text, goalId: b.goalId, stepRef: b.stepRef, done: false }); added++;
      if (b.stepRef) used.add(b.stepRef);
    });
    focusGoals(iso).forEach((g) => {
      if (room() <= 0 || state.big3.some((b) => b.date === iso && b.goalId === g.id)) return;
      const ns = nextStep(g, used);
      state.big3.push({ id: S.uid(), date: iso, text: ns ? ns.text : `Make progress on: ${g.title}`, goalId: g.id, stepRef: ns ? ns.ref : '', done: false });
      if (ns) used.add(ns.ref);
      added++;
    });
    if (added) { state.bigAuto[iso] = true; S.save(state); }
  }

  /* ---------- ideal week (set per quarter) ---------- */
  const qParts = (qk) => { const [y, q] = qk.split('-Q'); return [Number(y), Number(q)]; };
  const qStart = (qk) => { const [y, q] = qParts(qk); return U.toISO(new Date(y, (q - 1) * 3, 1)); };
  const qEnd = (qk) => { const [y, q] = qParts(qk); return U.toISO(new Date(y, q * 3, 0)); };
  const shiftQ = (qk, n) => { const [y, q] = qParts(qk); const i = y * 4 + (q - 1) + n; return `${Math.floor(i / 4)}-Q${(i % 4) + 1}`; };
  const qLabel = (qk) => qk.replace(/^(\d{4})-(Q\d)$/, '$2 $1');
  const idealFor = (qk) => state.idealWeek.filter((i) => i.quarter === qk);
  /* A new quarter starts from the most recent earlier one, flagged for review. */
  function carryIdeal(qk) {
    if (idealFor(qk).length) return;
    const prev = [...new Set(state.idealWeek.map((i) => i.quarter))].filter((k) => k && k < qk).sort().pop();
    if (!prev) return;
    idealFor(prev).forEach((i) => state.idealWeek.push({ ...i, id: S.uid(), quarter: qk }));
    state.idealCarried[qk] = prev;
    S.save(state);
  }
  const idealOn = (iso) => {
    const dow = U.parseISO(iso).getDay(), log = state.idealLog[iso] || {}, qk = quarterKey(iso);
    return state.idealWeek.filter((i) => i.quarter === qk && Number(i.dow) === dow && log[i.id] !== 'skip')
      .sort((a, b) => ((a.time || '99') < (b.time || '99') ? -1 : 1));
  };
  const idealDone = (it, iso) => (state.idealLog[iso] || {})[it.id] === true;
  function idealRow(it, iso, canSkip) {
    const done = idealDone(it, iso), g = it.goalId && state.goals.find((x) => x.id === it.goalId);
    return `<li class="ideal${done ? ' done' : ''}"><input type="checkbox" data-act="idealDone" data-id="${it.id}" data-date="${iso}" ${done ? 'checked' : ''} aria-label="Done: ${esc(it.text)}">
      <span class="grow">${it.time ? `<time>${esc(fmtTime(it.time))}</time> ` : ''}${esc(it.text)}${it.workout ? ' <small class="muted">workout</small>' : ''}${g ? ` <small class="muted">${esc(g.title)}</small>` : ''}</span>
      ${canSkip ? `<button class="x" data-act="idealSkip" data-id="${it.id}" data-date="${iso}" aria-label="Skip today">×</button>` : ''}</li>`;
  }
  const reviewDone = (iso) => { const r = state.reviews[iso]; return !!(r && r.purpose && r.goals && r.ideal); };

  const schedBtn = (text, mins) => `<button type="button" class="x sched-btn" data-act="scheduleItem" data-text="${esc(text)}"${mins ? ` data-mins="${mins}"` : ''} title="Put on the calendar" aria-label="Put on the calendar">📅</button>`;
  const dragAttr = (text, mins) => `draggable="true" data-drag="${esc(JSON.stringify({ text, mins: mins || 30 }))}"`;
  const EV_KINDS = { event: '', vacation: '✈ ', relax: '☀ ', birthday: '🎂 ' };
  const evIcon = (e) => EV_KINDS[e.kind] || '';

  /* ---------- small HTML helpers ---------- */
  const ta = (path, ph, rows = 3) =>
    `<textarea data-bind="${esc(path)}" rows="${rows}" placeholder="${esc(ph || '')}">${esc(get(path))}</textarea>`;
  const inp = (path, ph, type = 'text', extra = '') =>
    `<input type="${type}" data-bind="${esc(path)}" value="${esc(get(path))}" placeholder="${esc(ph || '')}" ${extra}>`;
  const chk = (path, label = '') =>
    `<input type="checkbox" data-bind="${esc(path)}" data-rerender ${get(path) ? 'checked' : ''} ${label ? `aria-label="${esc(label)}"` : ''}>`;
  const opts = (list, cur) => list.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(cur) ? 'selected' : ''}>${esc(o.l)}</option>`).join('');
  const lifeOpts = (cur) => opts(P.LIFE.map((a) => ({ v: a.id, l: a.name })), cur);
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
  /* Priority actions for a week or month: one list grouped by life area (the same ten areas as goals and the Wheel). */
  function areaBoxes(base, items, goals) {
    const areaOf = (i) => P.lifeArea(i.area || '', '', i.text);
    const groups = P.LIFE.map((a) => ({ a, list: items.filter((i) => areaOf(i) === a.id) })).filter((g) => g.list.length);
    const uncovered = goals.filter((g) => g.status === 'active' && g.kind !== 'habit' && !items.some((i) => i.goalId === g.id)).slice(0, 6);
    return `<section class="box areas">
      ${groups.length ? groups.map((g) => `<h3 class="area-h">${esc(g.a.name)}</h3><ul class="checks">${g.list.map((i) => actionRow(base, i, goals)).join('')}</ul>`).join('') : '<p class="muted">No priorities yet. Add the few things that matter most.</p>'}
      ${uncovered.length ? `<div class="nudge">No action yet for: ${uncovered.map((g) => `<button class="chip" data-act="quickAction" data-path="${base}" data-area="${esc(g.area)}" data-goal="${g.id}">+ ${esc(g.title)}</button>`).join('')}</div>` : ''}
      <form class="add" data-add="${base}"><input name="text" placeholder="Add a priority action…" required aria-label="New priority action">
        <select name="area" aria-label="Area"><option value="">Area…</option>${P.LIFE.map((a) => `<option value="${a.id}">${esc(a.short)}</option>`).join('')}</select>
        <select name="goalId" class="link" aria-label="Linked goal">${goalOpts(goals, '')}</select><button aria-label="Add">+</button></form>
    </section>`;
  }
  function actionRow(base, i, goals) {
    const p = `${base}.@${i.id}`;
    return `<li class="${i.done ? 'done' : ''}">
      ${chk(p + '.done', 'Done')}
      <div class="grow">
        <input class="inline" data-bind="${p}.text" value="${esc(i.text)}" aria-label="Action">
        <select class="link" data-bind="${p}.goalId" data-rerender aria-label="Linked goal">${goalOpts(goals, i.goalId)}</select>
      </div>
      ${schedBtn(i.text)}<button class="x" data-act="del" data-path="${base}" data-id="${i.id}" aria-label="Remove">×</button>
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
    if (!focusGoals(todayISO()).length && state.goals.some((g) => g.status === 'active' && g.kind !== 'habit'))
      out.push({ t: 'Choose your quarterly focus', d: 'Pick the 3–4 goals that get your best energy this quarter.', h: '#/goals', hot: true });
    const qNow = quarterKey(todayISO());
    if (state.idealCarried[qNow]) out.push({ t: `Review your ideal week for ${qLabel(qNow)}`, d: `Copied from ${qLabel(state.idealCarried[qNow])}. Adjust it for the new quarter.`, h: '#/ideal', hot: true });
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
  /* ---------- Google Calendar events (read-only overlay, any number of calendars) ---------- */
  const GCAL_COLOR = '#6f8296';
  const gcal = { events: [], ranges: {}, busy: false, status: '', ok: true, listTried: false, listError: '' };
  const gcalConnected = () => !!localStorage.getItem('google_access_token') && (!gScope() || /auth\/calendar/.test(gScope())) && !localStorage.getItem('google_cal_off');
  const gcalSelectedIds = () => { const sel = (state.settings.gcalSelected || []).filter(Boolean); return (sel.length ? sel : ['primary']).slice(0, 10); };
  const gcalFriendly = (m) => (/insufficient authentication scopes|insufficientPermissions/i.test(m || '')
    ? 'Google did not give Life.OS permission to read your calendars. Reconnect and keep every permission box ticked on Google\'s screen.' : m);
  const gcalNeedsReconnect = (m) => /permission to read your calendars/.test(m || '');
  const gcalCanWrite = () => /auth\/calendar(\.events)?(\s|$)/.test(gScope());     // we only ask for write access when someone uses a feature that needs it
  const gcalWritable = (c) => ['owner', 'writer'].includes(c.accessRole);
  const gcalMasterId = () => state.settings.gcalMaster || 'primary';
  const gcalMasterMeta = () => { const m = gcalMeta(gcalMasterId()); return { id: gcalMasterId() === 'primary' && gcalPrimary() ? gcalPrimary().id : gcalMasterId(), name: m.name === 'primary' ? 'Primary calendar' : m.name }; };
  function gcalEnsureSelected(id) {
    const prim = gcalPrimary(), want = id === 'primary' && prim ? prim.id : id;
    const cur = gcalSelectedIds().map((x) => (x === 'primary' && prim ? prim.id : x));
    if (!cur.includes(want)) { state.settings.gcalSelected = [...cur, want].slice(0, 10); gcalReset(); }
  }
  const gcalPrimary = () => state.gcalCalendars.find((c) => c.primary);
  const gcalMeta = (id) => state.gcalCalendars.find((c) => c.id === id) || (id === 'primary' ? gcalPrimary() : null) || { id, name: id === 'primary' ? 'Primary' : id, color: GCAL_COLOR };
  const gcalIsSelected = (c) => { const ids = gcalSelectedIds(); return ids.includes(c.id) || (c.primary && ids.includes('primary')); };
  const gcalMulti = () => gcalSelectedIds().length > 1;
  const gcalTag = (g) => (gcalMulti() && g.cal ? ` <small class="muted">${esc(g.cal)}</small>` : '');
  const gcalVar = (color) => `--c:${esc(color || GCAL_COLOR)}`;

  function gcalNormalize(items, meta) {
    const out = [], cal = meta.name, color = meta.color, pre = `${meta.id}|`;
    (items || []).forEach((ev) => {
      if (ev.status === 'cancelled' || !ev.start) return;
      const text = ev.summary || '(busy)';
      if (ev.start.dateTime) {
        const s0 = new Date(ev.start.dateTime), e0 = new Date((ev.end && ev.end.dateTime) || ev.start.dateTime);
        out.push({ id: pre + ev.id, text, cal, color, date: U.toISO(s0), time: `${U.pad(s0.getHours())}:${U.pad(s0.getMinutes())}`, mins: Math.max(15, Math.round((e0 - s0) / 60000)), allDay: false });
      } else if (ev.start.date) {
        const end = U.parseISO((ev.end && ev.end.date) || ev.start.date);
        let d = U.parseISO(ev.start.date);
        for (let i = 0; i < 31 && (i === 0 || d < end); i++, d = U.addDays(d, 1)) out.push({ id: `${pre}${ev.id}:${i}`, text, cal, color, date: U.toISO(d), time: '', mins: 0, allDay: true });
      }
    });
    return out;
  }
  const gcalOn = (iso) => gcal.events.filter((g) => g.date === iso).sort((a, b) => ((a.time || '') < (b.time || '') ? -1 : 1));

  async function gcalApi(path, params, retried) {
    const qs = new URLSearchParams(params || {});
    const res = await fetch(`${API_BASE}${path}${qs.toString() ? `?${qs}` : ''}`, { headers: { Authorization: `Bearer ${localStorage.getItem('google_access_token') || ''}` } });
    if (res.status === 401 && !retried) {
      const rt = localStorage.getItem('google_refresh_token');
      if (rt) {
        const r = await fetch(`${API_BASE}/api/auth/google/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }) });
        if (r.ok) { localStorage.setItem('google_access_token', (await r.json()).access_token); return gcalApi(path, params, true); }
      }
      localStorage.removeItem('google_access_token');
      throw new Error('Google sign-in expired. Reconnect in Settings.');
    }
    if (!res.ok) {
      let m = '';
      try { m = (await res.json()).error || ''; } catch (e) { /* non-JSON error */ }
      throw new Error(m ? `Google Calendar: ${m}`.slice(0, 160) : `Calendar error ${res.status}`);
    }
    return res.json();
  }

  async function loadGcal(fromIso, toIso, force) {
    if (!gcalConnected() || gcal.busy) return;
    const ids = gcalSelectedIds(), key = `${fromIso}_${toIso}_${ids.join(',')}`, seen = gcal.ranges[key];
    if (seen && !force && (seen.ok || Date.now() - seen.t < 60000)) return;
    gcal.busy = true; gcal.status = 'Syncing…'; gcal.ok = true;
    const timeMin = new Date(`${fromIso}T00:00:00`).toISOString(), timeMax = new Date(`${toIso}T00:00:00`).toISOString();
    try {
      const results = await Promise.allSettled(ids.map((id) => gcalApi('/api/calendar/events', { from: timeMin, to: timeMax, calendarId: id }).then((r) => gcalNormalize(r.events, gcalMeta(id)))));
      const evs = [], failed = [];
      results.forEach((r, i) => (r.status === 'fulfilled' ? evs.push(...r.value) : failed.push({ name: gcalMeta(ids[i]).name, msg: r.reason && r.reason.message })));
      if (failed.length === ids.length) throw new Error(gcalFriendly(failed[0].msg) || 'Could not sync');
      gcal.events = gcal.events.filter((g) => g.date < fromIso || g.date >= toIso).concat(evs);
      gcal.ranges[key] = { ok: true, t: Date.now() };
      gcal.status = `Synced ${evs.length} event${evs.length === 1 ? '' : 's'}${ids.length > 1 ? ` from ${ids.length - failed.length} calendar${ids.length - failed.length === 1 ? '' : 's'}` : ''}`;
      gcal.ok = failed.length === 0;
      if (failed.length) gcal.status += ` · could not read ${failed.map((f) => f.name).join(', ')}`;
    } catch (e) {
      gcal.ranges[key] = { ok: false, t: Date.now() };
      gcal.status = gcalFriendly(e.message) || 'Could not sync'; gcal.ok = false; console.error('Calendar sync failed:', e);
    } finally { gcal.busy = false; render(); }
  }
  async function loadCalendarList() {
    if (!gcalConnected()) return;
    gcal.listTried = true; gcal.listError = '';
    try {
      state.gcalCalendars = (await gcalApi('/api/calendar/list', {})).calendars || [];
      S.save(state);
    } catch (e) { gcal.listError = gcalFriendly(e.message); console.error('Calendar list failed:', e); }
    render();
  }
  function gcalReset() { gcal.events = []; gcal.ranges = {}; gcal.status = ''; }

  function gcalKick(name, arg) {
    if (!gcalConnected()) return;
    if (!state.gcalCalendars.length && !gcal.listTried) loadCalendarList();
    let from, to;
    if (name === 'week' || name === 'today') { from = name === 'week' && arg ? arg : U.weekKey(today(), ws()); to = U.toISO(U.addDays(U.parseISO(from), 7)); }
    else if (name === 'calendar') ({ from, to } = calParse(arg));
    else if (name === 'month') { const g = U.monthGrid(/^\d{4}-\d{2}$/.test(arg || '') ? arg : U.monthKey(today()), ws()); from = U.toISO(g[0][0]); to = U.toISO(U.addDays(g[g.length - 1][6], 1)); }
    else return;
    loadGcal(from, to);
  }
  const gcalStatusLine = (from, to) => gcalConnected()
    ? `<p class="gcal-status ${gcal.ok ? 'muted small' : 'nudge'}">📅 Google Calendar · ${esc(gcal.status || 'loading…')} <button class="btn ghost small" data-act="gcalRefresh" data-from="${from}" data-to="${to}">↻ Refresh</button> ${gcalNeedsReconnect(gcal.status) ? '<button class="btn small" data-act="reconnectCalendar">Reconnect Google</button>' : '<a href="#/settings">Choose calendars</a>'}</p>`
    : '<p class="muted small gcal-status">📅 <a href="#/settings">Connect Google Calendar</a> to see your events here.</p>';
  const gcalChips = () => (state.gcalCalendars.length > 1 && gcalConnected()
    ? `<div class="chips gcal-chips">${state.gcalCalendars.map((c) => `<button type="button" class="chip cal-chip${gcalIsSelected(c) ? ' on' : ''}" style="${gcalVar(c.color)}" data-act="gcalToggle" data-id="${esc(c.id)}" aria-pressed="${gcalIsSelected(c)}"><span class="swatch"></span>${esc(c.name)}</button>`).join('')}</div>` : '');

  /* Phone photos can exceed the host's request limit, so downscale to a JPEG first. */
  async function shrinkImage(file, maxDim = 1800, quality = 0.85) {
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
      return blob || file;
    } catch (e) { return file; }
  }

  async function uploadPhotoOCR(file, type = 'auto') {
    const fd = new FormData();
    fd.append('image', await shrinkImage(file, type === 'calendar' ? 2400 : 1800, type === 'calendar' ? 0.9 : 0.85), 'photo.jpg');
    fd.append('type', type);
    fd.append('today', todayISO());
    const send = () => fetch(`${API_BASE}/api/ocr/analyze`, { method: 'POST', body: fd, headers: { Authorization: `Bearer ${localStorage.getItem('google_access_token') || ''}` } });
    let res = await send();
    if (res.status === 401 && await googleRefresh()) res = await send();
    if (!res.ok) {
      let msg = `Server error ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch (e) { /* non-JSON error body */ }
      throw new Error(msg);
    }
    return res.json();
  }

  async function startGoogleOAuth(kind = 'calendar') {
    try {
      localStorage.setItem('google_intent', kind);
      const res = await fetch(`${API_BASE}/api/auth/google/url?scopes=${kind}`);
      const { url } = await res.json();
      window.location = url;
    } catch (e) { console.error('OAuth error:', e); toast('Failed to start login'); }
  }

  async function pushToGoogleCalendar(items, calendarId) {
    const token = localStorage.getItem('google_access_token');
    if (!token) { toast('Connect Google Calendar in Settings first'); return items.map(() => false); }
    if (!gcalCanWrite()) {
      if (confirm('Adding events to Google Calendar needs one more permission. Life.OS only asks when you use a feature that needs it, and only for creating events. Allow it now? (You will return here afterwards; then try again.)')) startGoogleOAuth('calendarwrite');
      return items.map(() => false);
    }
    const target = calendarId || gcalMasterMeta().id, targetName = (state.gcalCalendars.find((c) => c.id === target) || gcalMasterMeta()).name;
    const results = [];
    for (const e of items) {
      if (!e.raw && (!e.date || !e.text)) { results.push(false); continue; }
      const event = e.raw || { text: e.text, date: e.date };
      if (!e.raw && e.time) {
        const start = new Date(`${e.date}T${e.time}`);
        if (!isNaN(start)) { event.start = start.toISOString(); event.end = new Date(start.getTime() + (Number(e.mins) || 60) * 60000).toISOString(); }
      }
      try {
        const r = await fetch(`${API_BASE}/api/calendar/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ calendarId: target, event }) });
        results.push(r.ok);
      } catch (err) { console.warn('Calendar create failed', err); results.push(false); }
    }
    const ok = results.filter(Boolean).length;
    toast(ok ? `Added ${ok} event${ok === 1 ? '' : 's'} to ${targetName}` : `Could not create events on ${targetName}`);
    if (ok) { gcalEnsureSelected(target); gcalReset(); render(); }
    return results;
  }

  const OCR_DEST = { schedule: '#/week', goals: '#/goals', workouts: '#/track/workouts', weights: '#/track/weight', habits: '#/today', shopping: '#/lists/shopping',
    journal: '#/lists/journal', bucket: '#/lists/bucket', reading: '#/lists/reading', projects: '#/lists/hobbies', events: '#/year' };
  const countAll = () => ['goals', 'roles', 'schedule', 'workouts', 'weights', 'shopping', 'journals', 'bucket', 'reading', 'projects', 'events']
    .reduce((n, k) => n + state[k].length, 0) + Object.values(state.weeks).reduce((n, w) => n + (w.habits || []).length, 0);

  function addOCRDataToApp(route, data) {
    const before = countAll();
    try {
      switch (route) {
        case 'schedule':
          data.entries.forEach(e => {
            if (e.date && e.text) state.schedule.push({ id: S.uid(), date: e.date, time: e.time || '', text: e.text });
          });
          break;
        case 'goals': {
          let cyc = currentCycle() || state.cycles[state.cycles.length - 1];
          if (!cyc) {
            const t = today(), dates = U.makeCycleDates(U.toISO(new Date(t.getFullYear(), t.getMonth(), 1)), Number(state.settings.cycleMonths) || 6);
            cyc = { id: S.uid(), name: U.cycleName(dates.start, dates.end), ...dates, review: {}, roleActions: {} };
            state.cycles.push(cyc);
          }
          const roleId = (name) => {
            const n = String(name || '').trim();
            if (!n) return state.roles[0] ? state.roles[0].id : '';
            let r = state.roles.find((x) => x.name.toLowerCase() === n.toLowerCase());
            if (!r) { r = { id: S.uid(), name: n, why: '' }; state.roles.push(r); }
            return r.id;
          };
          (data.roles || []).forEach((r) => {
            if (!r.name) return;
            const id = roleId(r.name), role = state.roles.find((x) => x.id === id);
            if (r.why && !role.why) role.why = r.why;
            const ra = (cyc.roleActions[id] = Object.assign({ monthly: '', weekly: '', daily: '' }, cyc.roleActions[id]));
            ['monthly', 'weekly', 'daily'].forEach((k) => { if (r[k] && !ra[k].includes(r[k])) ra[k] = ra[k] ? `${ra[k]}\n${r[k]}` : r[k]; });
          });
          (data.goals || []).forEach((g) => {
            if (!g.title) return;
            state.goals.push({
              id: S.uid(), cycleId: cyc.id, roleId: roleId(g.role), title: g.title, why: g.why || '', area: P.lifeArea(g.area, g.role, g.title, true), tier: 'pursuit',
              progress: 0, status: 'active', target: g.target || '', doneBy: g.target || '', measure: '',
              kind: g.cadence === 'daily' || g.cadence === 'weekly' ? 'habit' : 'achievement', perWeek: g.cadence === 'daily' ? 7 : g.cadence === 'weekly' ? 1 : 5,
              log: {}, milestones: [], objectives: [], routines: []
            });
          });
          break;
        }
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
          data.habits.forEach((h) => { if (h.name) addSuggestedGoal({ title: h.name, perWeek: Math.min(7, Math.max(1, Number(h.target) || 5)), area: 'health' }, 'habit'); });
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
            if (!e.date || !e.text) return;
            const yearly = !!e.yearly || /^\d{2}-\d{2}$/.test(e.date);
            state.events.push({ id: S.uid(), start: /^\d{2}-\d{2}$/.test(e.date) ? `${today().getFullYear()}-${e.date}` : e.date, end: '', text: e.text, yearly, kind: 'event' });
          });
          break;
        case 'calendar':
          pushToGoogleCalendar(data.entries || data.events || []);
          return;
      }
      const added = countAll() - before;
      commit();
      if (!added) { toast('Nothing could be added from that photo. Try a closer, clearer shot.'); return; }
      toast(`Added ${added} item${added === 1 ? '' : 's'}`);
      if (OCR_DEST[route]) location.hash = OCR_DEST[route];
    } catch (e) { console.error('Data add error:', e); toast('Failed to add data'); }
  }

  /* ---------- views ---------- */
  function viewToday(arg) {
    const realToday = todayISO(), isToday = !/^\d{4}-\d{2}-\d{2}$/.test(arg || '') || arg === realToday;
    const t = isToday ? today() : U.parseISO(arg), iso = U.toISO(t), wk = U.weekKey(t, ws()), mk = U.monthKey(t);
    const wom = U.weekOfMonth(U.parseISO(wk));
    const wkEnd = U.toISO(U.addDays(U.parseISO(wk), 6));
    const cyc = cycleAt(iso);
    const goals = cyc ? cycleGoals(cyc.id) : [];
    const week = state.weeks[wk];
    carryIdeal(quarterKey(iso));
    const due = rituals();
    const vision = state.foundation.vision.trim();
    const tks = trackers();
    const pending = (key) => (focusGoals(iso).length ? focusGoals(iso) : goals).flatMap((g) => (g[key] || []).filter((i) => !i.done && i.text)
      .map((i) => ({ text: i.text, due: i.due, goal: g.title, base: `goals.@${g.id}.${key}.@${i.id}` })))
      .sort((a, b) => ((a.due || '9') < (b.due || '9') ? -1 : 1));
    if (iso >= realToday && iso <= U.toISO(U.addDays(U.parseISO(realToday), 7))) autoFillBig3(iso);
    const fgoals = focusGoals(iso);
    const idealToday = idealOn(iso);
    const st = setupStatus(), stDone = st.filter((x) => x.done).length, stNext = st.find((x) => !x.done);
    const syncNudge = !syncEnabled() && dataWeight() >= 8 && (state.settings.syncNudgeUntil || '') <= iso
      ? `<section class="box sync-nudge"><div class="grow"><strong>Your plan only lives in this browser.</strong> <span class="muted">Turn on sync so a cleared browser or a lost phone can't erase the time you've invested.</span></div>
        <button class="btn primary" data-act="syncEnable">Turn on sync</button><button class="btn ghost" data-act="export">Download backup</button><button class="x" data-act="syncSnooze" aria-label="Remind me in a week" title="Remind me in a week">×</button></section>` : '';
    const blankPlan = !state.settings.setupDone && !state.settings.setupDismissed && !state.goals.length && !state.tasks.length && !state.big3.length;
    const firstDay = blankPlan ? firstDayCard() : '';
    const setupBanner = !blankPlan && !state.settings.setupDone && !state.settings.setupDismissed && stNext ? `<section class="box setup-banner"><div class="grow"><strong>Finish setting up Life.OS</strong> <span class="muted">· ${stDone} of ${st.length} · next: ${esc(stNext.label)}</span><br>${progressBar((stDone / st.length) * 100)}</div><a class="btn primary" href="#/setup/${stNext.step}">Continue</a><button class="x" data-act="dismissSetup" aria-label="Hide setup">×</button></section>` : '';
    const rv = state.reviews[iso] || {};
    const rvCount = ['purpose', 'goals', 'ideal'].filter((k) => rv[k]).length;
    let rvStreak = 0;
    for (let i = rvCount === 3 ? 0 : 1; i < 400 && reviewDone(U.toISO(U.addDays(t, -i))); i++) rvStreak++;
    const purposeText = (state.foundation.mission || '').trim() || (state.foundation.vision || '').trim();
    const bigToday = state.big3.filter((b) => b.date === iso);
    const carry = state.big3.filter((b) => b.date < iso && !b.done && !b.migrated).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-6);
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

    const sc = sessionCtx();
    const dueSessions = ['yearly', 'quarterly', 'monthly', 'weekly'].map((cad) => sessionStatus(cad, sc)).filter((x) => x.due && !x.complete);
    const dueStrip = dueSessions.length ? `<section class="box due-strip"><strong>Planning due</strong> ${dueSessions.map((x) => `<a class="chip" href="#/session/${x.cad}">${esc(x.def.title)} · ${x.doneN}/${x.steps.length} →</a>`).join(' ')}</section>` : '';
    const capture = `<form class="add capture" data-act-form="capture"><input name="text" placeholder="Capture a to-do (try: call dentist friday !high), goal idea, memory or quote…" required aria-label="Quick capture">
      <select name="kind" aria-label="Type"><option value="todo">To-do</option><option value="goal">Goal idea</option><option value="memory">Memory</option><option value="quote">Quote</option></select><button aria-label="Capture">+</button></form>`;
    const dayHref = (d) => (d === realToday ? '#/today' : `#/today/${d}`);
    const weekDays = Array.from({ length: 7 }, (_, i) => U.addDays(U.parseISO(wk), i));
    const weekNav = `<div class="chips day-tabs week-nav" role="tablist" aria-label="Days of this week">${weekDays.map((d) => { const di = U.toISO(d), open = F.dayTasksCount ? F.dayTasksCount(di) : 0;
      return `<a class="chip${di === iso ? ' on' : ''}${di === realToday ? ' is-today' : ''}" role="tab" aria-selected="${di === iso}" href="${dayHref(di)}">${U.DAYS[d.getDay()].slice(0, 3)} ${d.getDate()}${open ? ` <b>${open}</b>` : ''}</a>`; }).join('')}</div>`;
    const viewing = isToday ? '' : `<p class="muted small day-banner">Viewing ${esc(U.fmtDate(iso, { weekday: 'long', month: 'long', day: 'numeric' }))}${iso < realToday ? ' (a past day)' : ''}. <a href="#/today">Back to today</a></p>`;
    const body = `
      ${firstDay}
      ${setupBanner}
      ${syncNudge}
      ${dueStrip}
      ${weekNav}${viewing}
      ${capture}
      <div class="today-cols"><div class="today-left">
      <section class="box">
        <h2>${isToday ? "Today's" : `${U.DAYS[t.getDay()]}'s`} schedule <a class="more" href="#/calendar/day:${iso}">Full calendar →</a></h2>
        ${gcalStatusLine(wk, U.toISO(U.addDays(U.parseISO(wk), 7)))}
        ${dayTimeline(iso, { height: 560 })}
      </section>
      </div><div class="today-right">
      <section class="box review${rvCount === 3 ? ' done' : ''}">
        <details data-keep="review"><summary><strong>Daily review</strong> <span class="muted">· ${rvCount}/3${rvCount === 3 ? ' ✓' : ''}${rvStreak > 1 ? ` · 🔥 ${rvStreak} days` : ''}</span></summary>
          <div class="review-step"><label class="inline-check">${chk(`reviews.${iso}.purpose`, 'Reviewed my purpose')} <strong>My purpose</strong></label>
            ${purposeText ? `<blockquote class="vision small">${esc(purposeText.split('\n').slice(0, 3).join(' '))}</blockquote>` : '<p class="muted small">Write your purpose statement on <a href="#/foundation">Foundation</a> so you can read it here each day.</p>'}</div>
          <div class="review-step"><label class="inline-check">${chk(`reviews.${iso}.goals`, 'Reviewed my goals')} <strong>My goals</strong></label>
            ${fgoals.length ? `<ul class="plain">${fgoals.map((g) => `<li>${g.tier === 'purpose' ? '<span class="star">★</span> ' : ''}${esc(g.title)} <small class="muted">${Number(g.progress) || 0}%</small></li>`).join('')}</ul>` : '<p class="muted small"><a href="#/goals">Choose your quarterly focus</a>.</p>'}
            ${tks.length ? `<p class="muted small">Plus ${tks.length} daily habit${tks.length > 1 ? 's' : ''} below.</p>` : ''}</div>
          <div class="review-step"><label class="inline-check">${chk(`reviews.${iso}.ideal`, 'Reviewed my ideal week')} <strong>My ideal week</strong> <small class="muted">${U.DAYS[t.getDay()]}</small></label>
            ${idealToday.length ? `<ul class="plain">${idealToday.map((i) => `<li>${i.time ? `<time>${esc(fmtTime(i.time))}</time> ` : ''}${esc(i.text)}</li>`).join('')}</ul>` : '<p class="muted small">Nothing in your ideal week for today. <a href="#/ideal">Set up your ideal week →</a></p>'}</div>
        </details>
      </section>
      <section class="box">
        <h2>${isToday ? "Today's" : `${U.DAYS[t.getDay()]}'s`} Big 3 <span class="muted">· ${bigToday.filter((b) => b.done).length}/${bigToday.length} done</span></h2>
        ${bigToday.length ? `<ul class="checks">${bigToday.map((b) => `<li class="${b.done ? 'done' : ''}" ${dragAttr(b.text)}>${chk(`big3.@${b.id}.done`, 'Done')}
          <div class="grow"><input class="inline" data-bind="big3.@${b.id}.text" value="${esc(b.text)}" aria-label="Big 3 task">
          ${b.goalId && state.goals.some((g) => g.id === b.goalId) ? `<small class="muted">${esc(state.goals.find((g) => g.id === b.goalId).title)}</small>` : ''}</div>
          ${schedBtn(b.text)}<button class="x" data-act="del" data-path="big3" data-id="${b.id}" aria-label="Remove">×</button></li>`).join('')}</ul>` : '<p class="muted">What are the three most important things to finish today? Do these first.</p>'}
        ${bigToday.length < 3 ? `<form class="add" data-add="big3"><input type="hidden" name="date" value="${iso}"><input name="text" placeholder="Most important task…" required aria-label="Big 3 task">
          <select name="goalId" aria-label="Linked goal">${goalOpts(fgoals.length ? fgoals : goals, '')}</select><button aria-label="Add">+</button></form>` : '<p class="muted small">Big 3 set. Finish these before anything else.</p>'}
        ${carry.length ? `<h3>Unfinished from earlier <small class="muted">move forward or let go</small></h3><ul class="checks compact">${carry.map((b) => `<li><span class="grow">${esc(b.text)} <small class="muted">${U.fmtDate(b.date, { month: 'short', day: 'numeric' })}</small></span>
          <button class="btn ghost" data-act="migrateBig3" data-id="${b.id}" ${bigToday.length >= 3 ? 'disabled title="Today already has 3"' : ''}>› Today</button>
          <button class="x" data-act="dropBig3" data-id="${b.id}" aria-label="Let go">×</button></li>`).join('')}</ul>` : ''}
      </section>
      ${otherTasksHtml(iso)}
      ${!tks.length && cyc ? `<section class="box"><h2>Habits &amp; routines</h2><p class="muted">Nothing to check off yet. <a href="#/setup/5">Add your habits</a> (like "Read a book, 7 days a week") and they will appear here each day.</p></section>` : ''}
      ${tks.length ? `<section class="box">
        <h2>Habits &amp; routines <span class="muted">· ${tks.filter((k) => k.log[iso]).length}/${tks.length} done today</span><a class="more" href="#/track/habits">Progress →</a></h2>
        <ul class="trackers">${tks.map((k) => trackerRow(k, wk, iso)).join('')}</ul>
      </section>` : ''}
      <section class="box focus">
        <h2>Quarterly focus <span class="muted">· ${quarterLabel(iso)}</span><a class="more" href="#/goals">Choose →</a></h2>
        ${fgoals.length ? `<ul class="focus-list">${fgoals.map((g) => { const ns = nextStep(g); return `<li ${dragAttr(ns ? ns.text : `Work on: ${g.title}`, 60)}>
          <div class="grow"><strong>${g.tier === 'purpose' ? '<span class="star">★</span> ' : ''}${esc(g.title)}</strong> ${progressBar(g.progress)} <small>${Number(g.progress) || 0}%</small>
            <br><small class="muted">Next: ${ns ? esc(ns.text) : 'add a milestone or objective'}</small></div>
          <button class="btn ghost" data-act="focusToBig3" data-goal="${g.id}">+ Big 3</button>${schedBtn(ns ? ns.text : `Work on: ${g.title}`, 60)}</li>`; }).join('')}</ul>`
          : '<p class="muted">Of your annual goals, pick the 3–4 that deserve your best energy this quarter. <a href="#/goals">Choose your focus →</a></p>'}
      </section>
      </div></div>
      <details class="box more-today" data-keep="more"><summary><strong>More for today</strong> <span class="muted">rituals, milestones, this week, goals, journal</span></summary>
        <section class="box">
          <h2>Rituals due</h2>
          ${due.length ? `<ul class="rituals">${due.map((r) => `<li class="${r.hot ? 'hot' : ''}"><a href="${r.h}"><strong>${r.t}</strong><span>${r.d}</span></a></li>`).join('')}</ul>`
            : '<p class="muted">You\'re caught up. Go live it.</p>'}
        </section>
      ${openObjs.length || nextMs.length ? `<section class="box">
        <h2>Milestones &amp; objectives <a class="more" href="#/goals">Plan →</a></h2>
        <ul class="checks compact">${nextMs.map((x) => `<li>${chk(`${x.base}.done`, 'Done')}<span class="grow"><strong>Milestone:</strong> ${esc(x.text)} <small class="muted">${esc(x.goal)}${x.due ? ` · due ${U.fmtDate(x.due, { month: 'short', day: 'numeric' })}` : ''}</small></span></li>`).join('')}
          ${openObjs.map((x) => `<li>${chk(`${x.base}.done`, 'Done')}<span class="grow">${esc(x.text)} <small class="muted">${esc(x.goal)}${x.due ? ` · due ${U.fmtDate(x.due, { month: 'short', day: 'numeric' })}` : ''}</small></span></li>`).join('')}</ul>
      </section>` : ''}
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
          ${upcoming.length ? `<ul class="events">${upcoming.map((x) => `<li><time>${U.fmtDate(x.on, { weekday: 'short', month: 'short', day: 'numeric' })}</time> ${evIcon(x.e)}${esc(x.e.text)}${x.e.yearly ? ' <span title="Yearly">↻</span>' : ''}</li>`).join('')}</ul>`
            : '<p class="muted">Nothing in the next 45 days. Add key dates on the Year page.</p>'}
        </section>
      </div>
      <section class="box">
        <h2>${fgoals.length ? 'Focus goals' : 'Goals'} ${cyc ? `<span class="muted">· ${esc(cyc.name)} · ${U.daysBetween(t, U.parseISO(cyc.end))} days left</span>` : ''}<a class="more" href="#/track/goals">Progress →</a></h2>
        ${(fgoals.length ? fgoals : goals).filter((g) => g.kind !== 'habit').length ? `<table class="goals-table"><thead><tr><th>Goal</th><th>Role</th><th>Progress</th><th>Month</th><th>Week</th><th>Pulse</th></tr></thead><tbody>
          ${(fgoals.length ? fgoals : goals).filter((g) => g.kind !== 'habit').map((g) => {
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
      </section>
      </details>`;
    return page(isToday ? 'Today' : U.DAYS[t.getDay()], U.fmtDate(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), body,
      `<a class="btn ghost" href="${dayHref(U.toISO(U.addDays(t, -1)))}" aria-label="Previous day" title="Previous day">←</a>${isToday ? '' : '<a class="btn ghost" href="#/today">Today</a>'}<a class="btn ghost" href="${dayHref(U.toISO(U.addDays(t, 1)))}" aria-label="Next day" title="Next day">→</a><a class="btn ghost" href="#/print/day/${iso}">Print</a>`);
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
      <section class="box"><h2>My legacy</h2>
        <p class="prompt">What will outlast you? Who do you want to have helped, and what do you want them to carry forward: a value, a skill, a family tradition, a cause, a body of work?</p>
        <div class="chips">${['The people I helped…', 'What I want my children to carry forward…', 'The cause or community I invested in…', 'The work I want to leave behind…'].map((t, i) => `<button type="button" class="chip" data-act="legacySeed" data-idx="${i}">${esc(t)}</button>`).join('')}</div>
        ${ta(f + '.legacy', 'My legacy is…', 5)}</section>
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
    const n = all.filter((g) => g.kind !== 'habit').length;
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
          ${g.kind === 'habit' ? '' : `<button type="button" class="chip${focusGoals(todayISO()).some((f) => f.id === g.id) ? ' on' : ''}" data-act="toggleFocus" data-goal="${g.id}" title="Quarterly focus">⚑ Focus</button>`}
          ${schedBtn(`Work on: ${g.title}`, 60)}<button class="x" data-act="del" data-path="goals" data-id="${g.id}" aria-label="Delete goal">×</button>
        </div>
        <div class="goal-meta">
          <label>Area <select data-bind="${p}.area" data-rerender aria-label="Area">${lifeOpts(g.area)}</select></label>
          <label>Target <input type="date" data-bind="${p}.target" value="${esc(g.target)}"></label>
          <label>Done by <input type="date" data-bind="${p}.doneBy" value="${esc(g.doneBy)}"></label>
          <label>Status <select data-bind="${p}.status" data-rerender>${opts([{ v: 'active', l: 'Active' }, { v: 'done', l: 'Done ✓' }, { v: 'dropped', l: 'Dropped' }], g.status)}</select></label>
          <label class="prog">Progress <input type="range" min="0" max="100" step="5" data-bind="${p}.progress" data-type="number" value="${Number(g.progress) || 0}"><output>${Number(g.progress) || 0}%</output></label>
        </div>
        <input class="inline measure" data-bind="${p}.measure" value="${esc(g.measure)}" placeholder="${g.kind === 'habit' ? 'What counts? (e.g. 20+ minutes, no phone)' : 'What does done look like? (be specific)'}">
        ${goalPlan(g, p)}
        ${F.goalTasks ? F.goalTasks(g) : ''}
      </div>`;
    };
    const habitPerWeek = (p, cur) => `<label>Days per week <select data-bind="${p}.perWeek" data-type="number" data-rerender>${opts([1, 2, 3, 4, 5, 6, 7].map((n) => ({ v: n, l: n === 7 ? '7 (every day)' : String(n) })), cur)}</select></label>`;
    const goalPlan = (g, p) => {
      const isHabit = g.kind === 'habit';
      const list = (key, ph, extra) => `<ul class="checks compact">${(g[key] || []).map((i) => `<li class="${i.done ? 'done' : ''}">${chk(`${p}.${key}.@${i.id}.done`, 'Done')}
          <input class="inline grow" data-bind="${p}.${key}.@${i.id}.text" value="${esc(i.text)}" aria-label="${ph}">
          <input type="date" data-bind="${p}.${key}.@${i.id}.due" value="${esc(i.due)}" aria-label="Due date">
          ${schedBtn(i.text)}<button class="x" data-act="del" data-path="${p}.${key}" data-id="${i.id}" aria-label="Remove">×</button></li>`).join('')}</ul>
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
        <select name="area" aria-label="Area">${lifeOpts('career')}</select>
        <select name="tier" aria-label="Tier">${tierOpts('pursuit')}</select>
        <button aria-label="Add goal">+</button></form>
      <form class="add habit-add" data-add="goals">
        <input type="hidden" name="cycleId" value="${cyc.id}"><input type="hidden" name="roleId" value="${roleId}"><input type="hidden" name="kind" value="habit">
        <input type="hidden" name="area" value="fitness"><input type="hidden" name="tier" value="pursuit">
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
        <div class="meter ${meterCls}" title="Aim for 10–12 goals per cycle (habit goals are tracked separately)"><strong>${n}</strong> goals<br><small>aim 10–12</small></div>
      </section>
      ${state.foundation.vision ? `<blockquote class="vision small"><span>Who I'm becoming</span>${esc(state.foundation.vision.split('\n')[0])}</blockquote>` : `<p class="nudge">Tip: <a href="#/foundation">write your vision & eulogy</a> first. Goals should flow from them.</p>`}
      <section class="box"><h2>Your balance</h2>${balanceStrip(all.filter((g) => g.status === 'active').map(goalDomain), 'Active goals and habits by area. Aim for something in each.')}</section>
      <section class="box focus-pick">
        <h2>This quarter's focus <small class="muted">${quarterLabel(todayISO())} · choose 3–4 · ${focusGoals(todayISO()).length}/4 selected</small></h2>
        <p class="prompt">You can't give ten goals your best energy at once. Choose the few that matter most right now. They appear on Today with your Big 3 and habits.</p>
        <div class="chips">${all.filter((g) => g.kind !== 'habit' && g.status === 'active').map((g) => { const on = focusGoals(todayISO()).some((f) => f.id === g.id);
          return `<button type="button" class="chip${on ? ' on' : ''}" data-act="toggleFocus" data-goal="${g.id}" aria-pressed="${on}">${on ? '⚑ ' : ''}${esc(g.title)}</button>`; }).join('') || '<span class="muted">Add some goals below first.</span>'}</div>
      </section>
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
          <select name="kind" aria-label="Type"><option value="event">Event</option><option value="vacation">Family vacation</option><option value="relax">Relaxation day</option><option value="birthday">Birthday</option></select>
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
          <ul class="events">${evs.map((e) => `<li><time>${U.fmtDate(e.start)}${e.end && e.end !== e.start ? `–${U.fmtDate(e.end)}` : ''}</time> ${evIcon(e)}${esc(e.text)}${e.yearly ? ' <span title="Yearly">↻</span>' : ''}
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
            ${gcalOn(iso).slice(0, 3).map((g) => `<div class="ev gcal" style="${gcalVar(g.color)}" title="${esc(g.text)}"><span>${g.time ? `${esc(fmtTime(g.time))} ` : ''}📅 ${esc(g.text)}</span></div>`).join('')}
            ${evs.map((e) => `<div class="ev" title="${esc(e.text)}"><span>${evIcon(e)}${esc(e.text)}</span></div>`).join('')}${F.monthTasks ? F.monthTasks(iso) : ''}</td>`;
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
      <button class="btn" data-act="copyMonth" data-key="${mk}">Copy for planner</button>
      <a class="btn" href="#/print/month/${mk}">Print</a>`;
    return page(`${U.MONTHS[md.getMonth()]} ${md.getFullYear()}`, 'Monthly calendar & goals', body, nav);
  }

  /* Half-hour time-block grid for any list of days: Google Calendar, ideal-week blocks, schedule entries, workouts. */
  function timeGridDays(days, dayOptsHtml) {
    const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const START = 6 * 60, END = 22 * 60, slots = [];
    for (let m = START; m < END; m += 30) slots.push(m);
    const itemsOn = (iso) => [
      ...gcalOn(iso).filter((g) => g.time).map((g) => ({ time: g.time, text: g.text, mins: g.mins, cls: 'gcal', c: g.color })),
      ...idealOn(iso).filter((i) => i.time).map((i) => ({ time: i.time, text: i.text, mins: 60, cls: 'ideal' })),
      ...scheduleOn(iso).filter((x) => x.time).map((x) => ({ time: x.time, text: x.text, mins: Number(x.mins) || 30, cls: 'sched' })),
      ...state.workouts.filter((x) => x.date === iso && x.time && !x.ideal).map((x) => ({ time: x.time, text: x.type, mins: Number(x.minutes) || 45, cls: 'wo' })),
    ];
    const allDayOn = (iso) => [...gcalOn(iso).filter((g) => g.allDay).map((g) => `<div class="ad gcal" style="${gcalVar(g.color)}">📅 ${esc(g.text)}</div>`),
      ...U.eventsOn(state.events, iso).map((e) => `<div class="ad">${evIcon(e)}${esc(e.text)}</div>`)].join('');
    const byDay = days.map(itemsOn);
    const slotOf = (t) => Math.min(END - 30, Math.max(START, Math.floor(toMin(t) / 30) * 30));
    const hhmm = (m) => `${U.pad(Math.floor(m / 60))}:${U.pad(m % 60)}`;
    return `<div class="cal-wrap"><table class="tgrid${days.length === 1 ? ' one' : ''}"><thead><tr><th></th>${days.map((d) => `<th><a href="#/calendar/day:${d}">${U.DAYS[U.parseISO(d).getDay()].slice(0, 3)} <small>${U.fmtDate(d, { day: 'numeric' })}</small></a></th>`).join('')}</tr></thead><tbody>
      <tr class="allday"><th>all day</th>${days.map((d) => `<td>${allDayOn(d)}</td>`).join('')}</tr>
      ${slots.map((m) => `<tr class="${m % 60 === 0 ? 'hr' : ''}"><th>${m % 60 === 0 ? esc(fmtTime(hhmm(m))) : ''}</th>${byDay.map((list) => {
        const here = list.filter((x) => slotOf(x.time) === m);
        return `<td>${here.map((x) => `<div class="blk ${x.cls}" style="--span:${Math.max(1, Math.ceil(x.mins / 30))}${x.c ? `;${gcalVar(x.c)}` : ''}" title="${esc(fmtTime(x.time))} ${esc(x.text)}"><b>${esc(fmtTime(x.time))}</b> ${esc(x.text)}</div>`).join('')}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>
      ${dayOptsHtml ? `<form class="add wrap" data-add="schedule"><select name="date" aria-label="Day">${dayOptsHtml}</select>
        <input type="time" name="time" step="1800" required aria-label="Start time">
        <select name="mins" aria-label="Length">${opts([30, 60, 90, 120, 180].map((n) => ({ v: n, l: n >= 60 ? `${n / 60} hr` : '30 min' })), 60)}</select>
        <input name="text" placeholder="Call, meeting, appointment, family time…" required><button aria-label="Add block">+</button></form>` : ''}`;
  }

  /* ---------- calendar zoom ---------- */
  const ZOOMS = [[0.75, 'Compact'], [1, 'Normal'], [1.5, 'Large'], [2, 'Extra large']];
  const zoomLevel = () => { const z = Number(state.settings.calZoom); return ZOOMS.some((x) => x[0] === z) ? z : 1; };
  function zoomControl() {
    const i = ZOOMS.findIndex((x) => x[0] === zoomLevel());
    return `<div class="tl-zoom"><span class="muted small">Zoom</span>
      <button type="button" class="chip small" data-act="calZoom" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Zoom out">−</button>
      <strong class="small">${ZOOMS[i][1]}</strong>
      <button type="button" class="chip small" data-act="calZoom" data-dir="1" ${i === ZOOMS.length - 1 ? 'disabled' : ''} aria-label="Zoom in">+</button></div>`;
  }

  /* ---------- Outlook-style day timeline (24h, 15-minute granularity) ---------- */
  function layoutDay(items) {
    const sorted = items.slice().sort((a, b) => a.start - b.start || b.end - a.end), out = [];
    let cluster = [], clusterEnd = -1;
    const flush = () => {
      if (!cluster.length) return;
      const cols = [];
      cluster.forEach((it) => { let c = cols.findIndex((end) => end <= it.start); if (c < 0) { c = cols.length; cols.push(0); } cols[c] = it.end; it.col = c; });
      cluster.forEach((it) => { it.cols = cols.length; out.push(it); });
      cluster = [];
    };
    sorted.forEach((it) => { if (it.start >= clusterEnd) { flush(); clusterEnd = it.end; } else clusterEnd = Math.max(clusterEnd, it.end); cluster.push(it); });
    flush();
    return out;
  }
  const hhmm24 = (m) => `${U.pad(Math.floor(m / 60))}:${U.pad(m % 60)}`;
  let tlScroll = null;
  function dayTimeline(iso, opt) {
    const height = (opt && opt.height) || 560, Z = zoomLevel();
    const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const items = [], anytime = [];
    const push = (o) => { o.start = Math.max(0, Math.min(1439, o.start)); o.end = Math.min(1440, Math.max(o.start + 15, o.start + o.mins)); items.push(o); };
    gcalOn(iso).forEach((g) => (g.time ? push({ cls: 'gcal', c: g.color, start: toMin(g.time), mins: g.mins, time: g.time, html: `📅 ${esc(g.text)}${gcalTag(g)}`, tip: g.text }) : anytime.push(`<span class="ad gcal" style="${gcalVar(g.color)}">📅 ${esc(g.text)}${gcalTag(g)}</span>`)));
    U.eventsOn(state.events, iso).forEach((e) => anytime.push(`<span class="ad">${evIcon(e)}${esc(e.text)}</span>`));
    idealOn(iso).forEach((i) => {
      const done = idealDone(i, iso), cb = `<input type="checkbox" data-act="idealDone" data-id="${i.id}" data-date="${iso}" ${done ? 'checked' : ''} aria-label="Done: ${esc(i.text)}">`;
      if (i.time) push({ cls: `ideal${done ? ' done' : ''}`, start: toMin(i.time), mins: 60, time: i.time, html: `${cb} ${esc(i.text)}${i.workout ? ' 🏃' : ''}`, tip: i.text });
      else anytime.push(`<label class="ad ideal">${cb} ${esc(i.text)}</label>`);
    });
    scheduleOn(iso).forEach((x) => {
      const html = `${esc(x.text)}${x.cal ? ` <small>${esc(x.cal)}</small>` : ''}<button class="x" data-act="del" data-path="schedule" data-id="${x.id}" aria-label="Remove">×</button>`;
      if (x.time) push({ cls: 'sched', start: toMin(x.time), mins: Number(x.mins) || 30, time: x.time, html, tip: x.text });
      else anytime.push(`<span class="ad sched">${html}</span>`);
    });
    if (F.timelineTasks) { const tt = F.timelineTasks(iso); tt.timed.forEach((o) => push({ ...o, start: toMin(o.time) })); tt.anytime.forEach((h) => anytime.push(h)); }
    state.workouts.filter((x) => x.date === iso && !x.ideal).forEach((x) => {
      const cb = chk(`workouts.@${x.id}.done`, 'Workout done');
      if (x.time) push({ cls: `wo${x.done ? ' done' : ''}`, start: toMin(x.time), mins: Number(x.minutes) || 45, time: x.time, html: `${cb} ${esc(x.type)}`, tip: x.type });
      else anytime.push(`<label class="ad wo">${cb} ${esc(x.type)}</label>`);
    });
    const placed = layoutDay(items);
    const hours = Array.from({ length: 24 }, (_, h) => `<div class="tl-hr" style="top:${h * 60 * Z}px">${h === 0 ? '' : esc(fmtTime(`${U.pad(h)}:00`))}</div>`).join('');
    const slots = Array.from({ length: 96 }, (_, i) => `<div class="tl-slot${i % 4 === 0 ? ' hr' : ''}" style="top:${i * 15 * Z}px;height:${15 * Z}px" data-time="${hhmm24(i * 15)}" title="${esc(fmtTime(hhmm24(i * 15)))}"></div>`).join('');
    const blocks = placed.map((o) => `<div class="tl-blk ${o.cls}${(o.end - o.start) * Z <= 22 ? ' tiny' : ''}" style="top:${o.start * Z}px;height:${(o.end - o.start) * Z - 1}px;left:calc(${(o.col / o.cols) * 100}% + 1px);width:calc(${100 / o.cols}% - 3px)${o.c ? `;${gcalVar(o.c)}` : ''}" title="${esc(fmtTime(o.time))} ${esc(o.tip)}"><b>${esc(fmtTime(o.time))}</b> ${o.html}</div>`).join('');
    const nowD = new Date(), nowMin = nowD.getHours() * 60 + nowD.getMinutes();
    const now = iso === todayISO() ? `<div class="tl-now" style="top:${nowMin * Z}px"><i></i></div>` : '';
    const start = iso === todayISO() ? Math.max(0, nowMin - 90) : 7 * 60;
    return `<div class="tl-box" data-date="${iso}">
      <form class="add wrap tl-form" data-add="schedule"><input type="hidden" name="date" value="${iso}"><input type="time" name="time" step="900" required aria-label="Start time">
        <select name="mins" aria-label="Length">${opts([15, 30, 45, 60, 90, 120, 180].map((n) => ({ v: n, l: n >= 60 ? `${n / 60 === Math.floor(n / 60) ? n / 60 : (n / 60).toFixed(1)} hr` : `${n} min` })), 30)}</select>
        <input name="text" placeholder="Click a time slot below, or type an event here…" required><button aria-label="Add event">+</button></form>
      ${zoomControl()}
      ${anytime.length ? `<div class="tl-anytime"><small class="muted">All day / anytime</small> ${anytime.join(' ')}</div>` : ''}
      <div class="tl-wrap" data-start="${start}" data-zoom="${Z}" style="height:${height}px"><div class="tl" style="height:${1440 * Z}px"><div class="tl-hours">${hours}</div><div class="tl-canvas">${slots}${blocks}${now}</div></div></div>
    </div>`;
  }

  /* ---------- tasks assigned to a day (weekly planning) ---------- */
  function assignedTasks() {
    const out = [];
    Object.entries(state.weeks).forEach(([wk, w]) => {
      (w.actions || []).forEach((a) => a.day && out.push({ day: a.day, kind: 'Priority', id: a.id, text: a.text, done: a.done, base: `weeks.${wk}.actions.@${a.id}`, goalId: a.goalId }));
      (w.top3 || []).forEach((a) => a.day && out.push({ day: a.day, kind: 'Top 3', id: a.id, text: a.text, done: a.done, base: `weeks.${wk}.top3.@${a.id}`, goalId: a.goalId }));
    });
    Object.entries(state.months).forEach(([mk, m]) => (m.actions || []).forEach((a) => a.day && out.push({ day: a.day, kind: 'Month', id: a.id, text: a.text, done: a.done, base: `months.${mk}.actions.@${a.id}`, goalId: a.goalId })));
    return out;
  }
  const tasksOn = (iso) => assignedTasks().filter((t) => t.day === iso);
  /* Open items that have no day yet, relevant to the week/month of `iso`, plus focus-goal next steps. */
  function taskPool(iso) {
    const wk = U.weekKey(U.parseISO(iso), ws()), mk = U.monthKey(U.parseISO(iso)), out = [], w = state.weeks[wk] || {}, m = state.months[mk] || {};
    (w.top3 || []).filter((a) => !a.done && !a.day).forEach((a) => out.push({ kind: 'Top 3', text: a.text, base: `weeks.${wk}.top3.@${a.id}` }));
    (w.actions || []).filter((a) => !a.done && !a.day).forEach((a) => out.push({ kind: 'Priority', text: a.text, base: `weeks.${wk}.actions.@${a.id}` }));
    (m.actions || []).filter((a) => !a.done && !a.day).forEach((a) => out.push({ kind: 'Month', text: a.text, base: `months.${mk}.actions.@${a.id}` }));
    if (F.poolTasks) F.poolTasks(iso).forEach((t) => out.push({ kind: 'Task', text: t.title, taskId: t.id }));
    focusGoals(iso).forEach((g) => { const ns = nextStep(g); out.push({ kind: 'Goal step', text: ns ? ns.text : `Work on: ${g.title}`, goal: g.id }); });
    return out;
  }
  const taskRow = (t, iso, opts2) => `<div class="tray-item${t.done ? ' done' : ''}" ${dragAttr(t.text)}>${chk(`${t.base}.done`, 'Done')}
    <input class="inline grow" data-bind="${t.base}.text" value="${esc(t.text)}" aria-label="Task">${schedBtn(t.text)}
    <button class="x" data-act="unassignTask" data-path="${t.base}" title="${opts2 && opts2.late ? 'Drop it' : 'Take off this day'}" aria-label="Remove from this day">×</button></div>`;
  const poolRow = (t, iso) => `<div class="tray-item"><span class="grow">${esc(t.text)} <small class="muted">${esc(t.kind)}</small></span>
    ${t.taskId ? `<button class="btn ghost small" data-act="taskAssign" data-id="${t.taskId}" data-day="${iso}">+ Assign</button>` : t.base ? `<button class="btn ghost small" data-act="assignTask" data-path="${t.base}" data-day="${iso}">+ Assign</button>` : `<button class="btn ghost small" data-act="assignStep" data-goal="${t.goal}" data-day="${iso}">+ Assign</button>`}</div>`;

  function otherTasksHtml(iso) {
    const mine = tasksOn(iso), late = assignedTasks().filter((t) => t.day < iso && !t.done).sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 5), pool = taskPool(iso).slice(0, 6);
    return `<section class="box other-tasks">
      <h2>Tasks <span class="muted">· ${F.dayTasksDone ? F.dayTasksDone(iso, mine) : `${mine.filter((t) => t.done).length}/${mine.length} done`}</span><a class="more" href="#/tasks">All tasks →</a></h2>
      ${late.length ? `<h4 class="tl-h">Carried over</h4>${late.map((t) => `<div class="tray-item late">${chk(`${t.base}.done`, 'Done')}<span class="grow">${esc(t.text)} <small class="muted">from ${U.fmtDate(t.day, { weekday: 'short', month: 'short', day: 'numeric' })}</small></span>
        <button class="btn ghost small" data-act="assignTask" data-path="${t.base}" data-day="${iso}">› Today</button></div>`).join('')}` : ''}
      ${F.dayTasks ? F.dayTasks(iso) : ''}
      ${mine.length ? mine.map((t) => taskRow(t, iso)).join('') : (F.dayTasks && F.dayTasksCount(iso) ? '' : '<p class="muted small">Nothing assigned to today yet. Add a task, or assign from your lists below.</p>')}
      ${F.quickAdd ? F.quickAdd(iso, `Add a task for ${iso === todayISO() ? 'today' : U.DAYS[U.parseISO(iso).getDay()]}… (try "Pay rent monthly on the 1st !high")`) : ''}
      ${F.rolloverBar ? F.rolloverBar(iso) : ''}
      ${pool.length ? `<details data-keep="pool"><summary class="muted small">Assign from your lists (${pool.length})</summary>${pool.map((t) => poolRow(t, iso)).join('')}</details>` : ''}
    </section>`;
  }
  const weekSel = {};

  /* ---------- scheduling items from goals, tasks and priorities ---------- */
  function addScheduleItem(o) {
    if (state.schedule.some((x) => x.date === o.date && (x.time || '') === (o.time || '') && x.text === o.text)) return false;
    const item = { id: S.uid(), date: o.date, time: o.time || '', mins: o.mins || 30, text: o.text, src: o.src || 'plan' };
    state.schedule.push(item);
    return item;
  }
  function busyOn(iso) {
    const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; }, iv = [];
    gcalOn(iso).filter((g) => g.time).forEach((g) => iv.push([toMin(g.time), toMin(g.time) + g.mins]));
    idealOn(iso).filter((i) => i.time).forEach((i) => iv.push([toMin(i.time), toMin(i.time) + 60]));
    scheduleOn(iso).filter((x) => x.time).forEach((x) => iv.push([toMin(x.time), toMin(x.time) + (Number(x.mins) || 30)]));
    state.workouts.filter((w) => w.date === iso && w.time && !w.ideal).forEach((w) => iv.push([toMin(w.time), toMin(w.time) + (Number(w.minutes) || 45)]));
    return iv;
  }
  function suggestSlot(iso, mins) {
    const busy = busyOn(iso), now = new Date();
    let start = 9 * 60;
    if (iso === todayISO()) start = Math.max(start, Math.ceil((now.getHours() * 60 + now.getMinutes() + 15) / 15) * 15);
    for (let t = start; t + mins <= 20 * 60; t += 15) if (!busy.some(([a, b]) => t < b && t + mins > a)) return hhmm24(t);
    return '';
  }
  function planCandidates() {
    const iso = todayISO(), wk = U.weekKey(today(), ws()), w = state.weeks[wk] || {}, out = [];
    state.big3.filter((b) => b.date === iso && !b.done).forEach((b) => out.push({ group: "Today's Big 3", text: b.text }));
    (w.top3 || []).filter((x) => !x.done).forEach((x) => out.push({ group: 'Top 3 this week', text: x.text }));
    (w.actions || []).filter((a) => !a.done).forEach((a) => out.push({ group: 'Priority actions', text: a.text }));
    if (F.openTasks) F.openTasks().slice(0, 10).forEach((t) => out.push({ group: 'Tasks', text: t.title, mins: Number(t.mins) || 30 }));
    focusGoals(iso).forEach((g) => { const ns = nextStep(g); out.push({ group: 'Goals · next steps', text: ns ? ns.text : `Work on: ${g.title}`, mins: 60 }); });
    return out;
  }
  function planTray() {
    const items = planCandidates(), groups = [...new Set(items.map((x) => x.group))];
    return `<aside class="tl-tray"><h3>Plan from your lists</h3><p class="muted small">Drag onto a time, or tap 📅.</p>
      ${items.length ? groups.map((g) => `<h4>${esc(g)}</h4>${items.filter((x) => x.group === g).map((x) => `<div class="tray-item" ${dragAttr(x.text, x.mins)}><span class="grow">${esc(x.text)}</span>${schedBtn(x.text, x.mins)}</div>`).join('')}`).join('')
        : '<p class="muted small">Nothing waiting. Add priorities on the Week page, to-dos from the capture bar, or choose a quarterly focus.</p>'}</aside>`;
  }

  /* ---------- calendar: day / week / month ---------- */
  function calParse(arg) {
    const [m0, v0 = ''] = String(arg || '').split(':');
    const mode = ['day', 'week', 'month'].includes(m0) ? m0 : 'week', t = today();
    let focus;
    if (mode === 'month') focus = /^\d{4}-\d{2}$/.test(v0) ? (U.monthKey(t) === v0 ? U.toISO(t) : `${v0}-01`) : U.toISO(t);
    else focus = /^\d{4}-\d{2}-\d{2}$/.test(v0) ? v0 : U.toISO(t);
    const fd = U.parseISO(focus);
    let from, to;
    if (mode === 'day') { from = U.weekKey(fd, ws()); to = U.toISO(U.addDays(U.parseISO(from), 7)); }
    else if (mode === 'week') { from = U.weekKey(fd, ws()); to = U.toISO(U.addDays(U.parseISO(from), 7)); }
    else { const g = U.monthGrid(U.monthKey(fd), ws()); from = U.toISO(g[0][0]); to = U.toISO(U.addDays(g[g.length - 1][6], 1)); }
    return { mode, focus, fd, from, to };
  }

  function photoImports() {
    const b = {};
    state.schedule.filter((x) => x.batch).forEach((x) => { (b[x.batch] = b[x.batch] || { id: x.batch, name: x.batchName || 'Photo import', items: [] }).items.push(x); });
    const list = Object.values(b);
    if (!list.length) return '';
    return `<section class="box"><h3>Imported from photos</h3><ul class="habit-sum batches">${list.map((g) => { const ds = g.items.map((x) => x.date).sort();
      return `<li><span><strong>${esc(g.name)}</strong> <small class="muted">${g.items.length} events · ${U.fmtDate(ds[0])} – ${U.fmtDate(ds[ds.length - 1])}</small></span>
        <button class="x" data-act="delImport" data-id="${g.id}" aria-label="Remove this import">×</button></li>`; }).join('')}</ul></section>`;
  }

  function viewCalendar(arg) {
    const c = calParse(arg), { mode, fd } = c, tIso = todayISO();
    const fIso = c.focus, link = (m, f) => `#/calendar/${m}:${m === 'month' ? U.monthKey(U.parseISO(f)) : m === 'week' ? U.weekKey(U.parseISO(f), ws()) : f}`;
    const inToday = (m) => (m === 'month' ? U.monthKey(fd) === U.monthKey(today()) : m === 'week' ? U.weekKey(fd, ws()) === U.weekKey(today(), ws()) : fIso === tIso);
    const jump = (m, dir) => (m === 'day' ? U.toISO(U.addDays(fd, dir)) : m === 'week' ? U.toISO(U.addDays(fd, 7 * dir)) : U.toISO(new Date(fd.getFullYear(), fd.getMonth() + dir, 1)));
    const switcher = ['day', 'week', 'month'].map((m) => `<a class="chip${m === mode ? ' on' : ''}" href="${link(m, fIso)}">${{ day: 'Day', week: 'Week', month: 'Month' }[m]}</a>`).join('');
    const nav = `<a class="btn ghost" href="${link(mode, jump(mode, -1))}" aria-label="Previous">←</a>
      <a class="btn ghost" href="${link(mode, tIso)}">Today</a>
      <a class="btn ghost" href="${link(mode, jump(mode, 1))}" aria-label="Next">→</a>`;
    let title, sub, content;
    const dayOpts = (days) => opts(days.map((d) => ({ v: d, l: `${U.DAYS[U.parseISO(d).getDay()].slice(0, 3)} ${U.fmtDate(d)}` })), days.includes(tIso) ? tIso : days[0]);
    if (mode === 'day') {
      title = U.fmtDate(fIso, { weekday: 'long', month: 'long', day: 'numeric' }); sub = U.parseISO(fIso).getFullYear();
      content = `<div class="day-cols"><div class="day-main">${dayTimeline(fIso, { height: 680 })}</div>${planTray()}</div>`;
    } else if (mode === 'week') {
      const days = DAYS_ISO(U.weekKey(fd, ws()));
      title = `Week of ${U.fmtDate(days[0], { month: 'short', day: 'numeric' })}`; sub = `${U.fmtDate(days[0])} – ${U.fmtDate(days[6])}`;
      content = timeGridDays(days, dayOpts(days));
    } else {
      const mk = U.monthKey(fd), grid = U.monthGrid(mk, ws());
      title = `${U.MONTHS[fd.getMonth()]} ${fd.getFullYear()}`; sub = 'Google Calendar, key dates and your schedule';
      const dayNames = [0, 1, 2, 3, 4, 5, 6].map((i) => U.DAYS[(i + ws()) % 7]);
      content = `<div class="cal-wrap"><table class="cal month-full"><thead><tr>${dayNames.map((d) => `<th><span class="long">${d}</span><span class="short">${d.slice(0, 3)}</span></th>`).join('')}</tr></thead><tbody>
        ${grid.map((row) => `<tr>${row.map((d) => {
          const iso = U.toISO(d), out = U.monthKey(d) !== mk;
          const items = [
            ...gcalOn(iso).map((g) => ({ cls: 'gcal', c: g.color, t: g.time, txt: `📅 ${g.text}` })),
            ...U.eventsOn(state.events, iso).map((e) => ({ cls: 'key', t: '', txt: `${evIcon(e)}${e.text}` })),
            ...scheduleOn(iso).map((x) => ({ cls: 'sched', t: x.time, txt: x.text })),
          ];
          const shown = items.slice(0, 4);
          return `<td class="${out ? 'out' : ''} ${iso === tIso ? 'today' : ''}"><a class="dnum" href="#/calendar/day:${iso}">${d.getDate()}</a>
            ${shown.map((x) => `<div class="ev ${x.cls}" ${x.c ? `style="${gcalVar(x.c)}" ` : ''}title="${esc(x.txt)}"><span>${x.t ? `${esc(fmtTime(x.t))} ` : ''}${esc(x.txt)}</span></div>`).join('')}
            ${items.length > 4 ? `<a class="more-ev" href="#/calendar/day:${iso}">+${items.length - 4} more</a>` : ''}</td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    const body = `<div class="row cal-bar"><div class="chips">${switcher}</div><span class="grow"></span>${nav}</div>
      ${gcalChips()}
      ${gcalStatusLine(c.from, c.to)}
      <section class="box">${content}</section>
      ${photoImports()}
      <p class="muted small"><span class="key gcal"></span> Google Calendar · <span class="key ideal"></span> Ideal week · <span class="key sched"></span> Your schedule · <span class="key wo"></span> Workouts</p>`;
    return page(title, sub, body);
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
      const picked = (weekSel[wk] || (tIso >= wk && tIso <= endIso ? tIso : wk)) === iso;
      return `<div class="${iso === tIso ? 'today' : ''}${picked ? ' picked' : ''}" data-act="selectDay" data-key="${wk}" data-day="${iso}" data-dropday="${iso}" data-scroll="1" title="Open this day in the planner. Drop a task here to plan it for this day."><strong>${U.DAYS[d.getDay()].slice(0, 3)}</strong> <span>${U.fmtDate(iso)}</span>
        ${U.eventsOn(state.events, iso).map((e) => `<div class="ev">${evIcon(e)}${esc(e.text)}</div>`).join('')}
        ${F.stripTasks ? F.stripTasks(iso) : ''}
        <ul class="sched">${gcalOn(iso).map((g) => `<li class="gcal" style="${gcalVar(g.color)}"><span class="grow">${g.time ? `<time>${esc(fmtTime(g.time))}</time> ` : ''}📅 ${esc(g.text)}${gcalTag(g)}</span></li>`).join('')}
          ${idealOn(iso).map((i) => `<li class="ideal ${idealDone(i, iso) ? 'done' : ''}"><span class="grow">${idealDone(i, iso) ? '✓' : '◦'} ${i.time ? `<time>${esc(fmtTime(i.time))}</time> ` : ''}${esc(i.text)}</span></li>`).join('')}
          ${scheduleOn(iso).map((s) => `<li>${s.time ? `<time>${esc(fmtTime(s.time))}</time>` : ''}<span class="grow">${esc(s.text)}${s.cal ? ` <small class="muted">${esc(s.cal)}</small>` : ''}</span><button class="x" data-act="del" data-path="schedule" data-id="${s.id}" aria-label="Remove">×</button></li>`).join('')}
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

    const top3 = `<section class="box"><h3>Top 3 for the week <small class="muted">${(w.top3 || []).filter((x) => x.done).length}/${(w.top3 || []).length} done</small></h3>
      <ul class="checks">${(w.top3 || []).map((x) => `<li class="${x.done ? 'done' : ''}">${chk(`${base}.top3.@${x.id}.done`, 'Done')}
        <div class="grow"><input class="inline" data-bind="${base}.top3.@${x.id}.text" value="${esc(x.text)}" aria-label="Top 3 item"></div>
        <select class="link" data-bind="${base}.top3.@${x.id}.goalId" data-rerender aria-label="Linked goal">${goalOpts(goals, x.goalId)}</select>
        ${schedBtn(x.text)}<button class="x" data-act="del" data-path="${base}.top3" data-id="${x.id}" aria-label="Remove">×</button></li>`).join('')}</ul>
      ${(w.top3 || []).length < 3 ? `<form class="add" data-add="${base}.top3"><input name="text" placeholder="One of the three most important things this week…" required><select name="goalId" aria-label="Linked goal">${goalOpts(goals, '')}</select><button aria-label="Add">+</button></form>` : '<p class="muted small">Top 3 set. Everything else is secondary.</p>'}</section>`;
    const pullBox = (() => {
      const inb = (F.openTasks ? F.openTasks().filter((t) => !t.day).slice(0, 8) : []).map((t) => ({ id: t.id, text: t.title })), bl = state.bucket.filter((b) => !b.done && b.text).slice(0, 8);
      const row = (src, id, text) => `<li><span class="grow">${esc(text)}</span><button class="btn ghost small" data-act="pullIn" data-src="${src}" data-id="${id}" data-key="${wk}">+ This week</button></li>`;
      return `<section class="box"><h3>Pull in from your lists</h3>
        ${inb.length || bl.length ? `<ul class="checks compact">${inb.map((x) => row('task', x.id, x.text)).join('')}${bl.map((b) => row('bucket', b.id, `Bucket list: ${b.text}`)).join('')}</ul>` : '<p class="muted">Nothing waiting. Capture to-dos on Today and add bucket-list items under <a href="#/lists/bucket">Lists</a>.</p>'}
        <p class="muted small"><a href="#/tasks">Open all tasks →</a></p></section>`;
    })();
    const selIso = weekSel[wk] && days.some((d) => U.toISO(d) === weekSel[wk]) ? weekSel[wk] : (tIso >= wk && tIso <= endIso ? tIso : wk);
    const dayPlanner = (() => {
      const mineSel = tasksOn(selIso), poolSel = taskPool(selIso);
      const tabs = days.map((d) => { const di = U.toISO(d), n = tasksOn(di).length;
        return `<button type="button" class="chip${di === selIso ? ' on' : ''}" data-act="selectDay" data-key="${wk}" data-day="${di}" aria-pressed="${di === selIso}">${U.DAYS[d.getDay()].slice(0, 3)} ${d.getDate()}${n ? ` <small>· ${n}</small>` : ''}${di === tIso ? ' ·today' : ''}</button>`; }).join('');
      return `<section class="box day-planner"><h2>Plan a day <span class="muted">· ${esc(U.fmtDate(selIso, { weekday: 'long', month: 'long', day: 'numeric' }))}</span></h2>
        <p class="prompt">Pick a day to see its full calendar. Assign tasks to it ahead of time; they appear in that day's Other tasks, and you can drag any task onto a time.</p>
        <div class="chips day-tabs">${tabs}</div>
        <div class="day-cols"><div class="day-main">${dayTimeline(selIso, { height: 520 })}</div>
          <aside class="tl-tray"><h3>Tasks for ${esc(U.fmtDate(selIso, { weekday: 'short', month: 'short', day: 'numeric' }))}</h3>
            ${mineSel.length ? mineSel.map((t) => taskRow(t, selIso)).join('') : (F.dayTasksCount && F.dayTasksCount(selIso) ? '' : '<p class="muted small">Nothing assigned yet.</p>')}
            ${F.dayTasks ? F.dayTasks(selIso, true) : ''}
            ${F.quickAdd ? F.quickAdd(selIso, 'New task for this day…') : ''}
            <h4>Assign from your lists</h4>
            ${poolSel.length ? poolSel.map((t) => poolRow(t, selIso)).join('') : '<p class="muted small">Everything is already assigned.</p>'}
          </aside></div></section>`;
    })();
    const body = `
      ${gcalStatusLine(wk, U.toISO(U.addDays(U.parseISO(wk), 7)))}
      ${top3}
      <h2 class="section">Schedule</h2>
      ${strip}
      <p class="muted small"><a href="#/calendar/week:${wk}">Open the full week calendar →</a></p>
      ${dayPlanner}
      <h2 class="section">Priority Actions for the Week</h2>
      ${roleWeekly.length ? `<div class="nudge role-nudge"><strong>Your weekly role commitments:</strong> ${roleWeekly.map((x) => `<span><em>${esc(x.r.name)}:</em> ${esc(x.t)}</span>`).join(' · ')}</div>` : ''}
      <div class="row">
        <button class="btn ghost" data-act="carryWeek" data-key="${wk}">Bring forward unfinished from last week</button>
        <button class="btn ghost" data-act="pullMonth" data-key="${wk}">Pull open actions from ${U.MONTHS[wom.month]}</button>
      </div>
      ${areaBoxes(base + '.actions', w.actions, goals)}
      <details class="box" data-keep="pull"><summary><strong>Pull in from your lists</strong> <span class="muted">to-dos and bucket list</span></summary>${pullBox}</details>
      <details class="box more-week" data-keep="weekmore"><summary><strong>More for the week</strong> <span class="muted">habits, workouts, goal pulse, shopping, notes and review</span></summary>
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
        <h3>Rate your week</h3>${stars}</section>
      </details>`;
    const prev = U.toISO(U.addDays(startD, -7)), next = U.toISO(U.addDays(startD, 7));
    const nav = `<a class="btn ghost" href="#/week/${prev}" aria-label="Previous week">←</a>
      <a class="btn ghost" href="#/week/${U.weekKey(today(), ws())}">This week</a>
      <a class="btn ghost" href="#/week/${next}" aria-label="Next week">→</a>
      <button class="btn" data-act="copyWeek" data-key="${wk}">Copy for planner</button>
      <a class="btn" href="#/print/week/${wk}">Print</a>`;
    return page(`Week ${wom.n} of ${U.MONTHS[wom.month]}`,
      `${U.fmtDate(wk, { weekday: 'short', month: 'short', day: 'numeric' })} – ${U.fmtDate(endIso, { weekday: 'short', month: 'short', day: 'numeric' })} · <a href="#/month/${wom.monthKey}">Month view</a>`,
      body, nav);
  }

  /* ---------- tracking helpers & charts ---------- */
  const scheduleOn = (iso) => state.schedule.filter((s) => s.date === iso && !(s.pushed && gcal.events.some((g) => g.date === iso && g.time === (s.time || '') && g.text.toLowerCase() === s.text.toLowerCase())))
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
  const WHEEL = P.LIFE.map((a) => ({ id: a.id, name: a.short, full: a.name, hint: a.hint }));

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
    const has = (sc, id) => sc && sc[id] != null && sc[id] !== '';
    const last = list[list.length - 1], prev = list[list.length - 2];
    const avg = (sc) => { const ids = WHEEL.filter((a) => has(sc, a.id)); return ids.length ? round1(ids.reduce((s, a) => s + Number(sc[a.id]), 0) / ids.length) : 0; };
    const start = last ? last.scores : {};
    const sorted = last ? WHEEL.filter((a) => has(last.scores, a.id)).sort((a, b) => last.scores[a.id] - last.scores[b.id]) : [];
    const delta = (id) => (last && prev && has(last.scores, id) && has(prev.scores, id) ? last.scores[id] - prev.scores[id] : null);
    const fmtD = (d) => (d == null ? '' : d > 0 ? `+${d}` : d < 0 ? `${d}` : '=');
    const tile = (l, v, sub) => `<div class="tile"><span>${l}</span><strong>${v}</strong><small>${sub}</small></div>`;

    const form = `<form data-act-form="wheel" class="wheel-form">
      <label class="field">Date <input type="date" name="date" value="${todayISO()}" required></label>
      ${WHEEL.map((a) => `<div class="wheel-row"><div><strong>${a.full}</strong><small class="muted">${a.hint}</small></div>
        <input type="range" min="1" max="10" step="1" name="s_${a.id}" value="${start[a.id] || 5}" data-wheel aria-label="${a.name} score"><output>${start[a.id] || 5}</output></div>`).join('')}
      <label class="field">Notes <textarea name="note" rows="2" placeholder="What's driving these scores? What do you want to change?"></textarea></label>
      <div class="row end"><button class="primary">Save assessment</button></div>
    </form>`;

    const body = `
      <p class="lead">Zig Ziglar's Wheel of Life, using the same ten areas as your goals and your balance view. Score each from 1 (needs a lot of attention) to 10 (thriving). Repeat every quarter to watch your balance change.</p>
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
        ${sorted.length ? tile('Strongest', esc(sorted[sorted.length - 1].name), `${last.scores[sorted[sorted.length - 1].id]}/10`) : ''}
        ${sorted.length ? tile('Needs attention', esc(sorted[0].name), `${last.scores[sorted[0].id]}/10`) : ''}
        ${tile('Assessments', list.length, 'saved so far')}
      </div>
      <section class="box"><h2>By area</h2>
        <table class="index wheel-table"><thead><tr><th>Area</th><th>Now</th><th>Change</th><th></th><th>Trend</th></tr></thead><tbody>
        ${WHEEL.map((a) => `<tr><td><strong>${a.full}</strong></td><td>${has(last.scores, a.id) ? `${last.scores[a.id]}/10` : '—'}</td><td class="muted">${fmtD(delta(a.id))}</td>
          <td>${progressBar((Number(last.scores[a.id]) || 0) * 10)}</td>
          <td>${sparkline(list.filter((x) => has(x.scores, a.id)).map((x) => ({ date: x.date, v: x.scores[a.id] * 10 })))}</td></tr>`).join('')}</tbody></table>
        <p class="muted small">Lowest scores are your best places to start. <a href="#/goals">${sorted.length ? `Turn ${esc(sorted[0].name)} into a goal →` : 'Set goals →'}</a></p>
      </section>
      ${list.length > 1 ? `<section class="box"><h2>Balance over time</h2>${lineChart(list.map((x) => ({ date: x.date, value: avg(x.scores) })), null, '/10', 'Wheel of Life balance score')}</section>` : ''}
      <section class="box"><h2>History</h2>
        <div class="cal-wrap"><table class="index"><thead><tr><th>Date</th>${WHEEL.map((a) => `<th>${a.name.slice(0, 4)}</th>`).join('')}<th>Avg</th><th></th></tr></thead><tbody>
        ${list.slice().reverse().map((x) => `<tr><td>${U.fmtDate(x.date, { month: 'short', day: 'numeric', year: 'numeric' })}${x.note ? `<br><small class="muted">${esc(x.note)}</small>` : ''}</td>
          ${WHEEL.map((a) => `<td>${has(x.scores, a.id) ? x.scores[a.id] : '—'}</td>`).join('')}<td><strong>${avg(x.scores)}</strong></td>
          <td><button class="x" data-act="del" data-path="wheel" data-id="${x.id}" aria-label="Delete assessment">×</button></td></tr>`).join('')}</tbody></table></div>
      </section>` : ''}`;
    return page('Wheel of Life', 'Ten life areas, scored over time', body);
  }

  function viewIdeal(arg) {
    const cur = quarterKey(todayISO());
    const qk = /^\d{4}-Q[1-4]$/.test(arg || '') ? arg : cur;
    if (qk === cur) carryIdeal(qk);
    const order = [0, 1, 2, 3, 4, 5, 6].map((i) => (i + ws()) % 7);
    const goals = (currentCycle() ? cycleGoals(currentCycle().id) : []).filter((g) => g.kind !== 'habit');
    const mine = idealFor(qk);
    const prevQ = [...new Set(state.idealWeek.map((i) => i.quarter))].filter((k) => k && k < qk).sort().pop();
    const day = (d) => {
      const items = mine.filter((i) => Number(i.dow) === d).sort((a, b) => ((a.time || '99') < (b.time || '99') ? -1 : 1));
      return `<section class="box ideal-day"><h3>${U.DAYS[d]}</h3>
        <ul class="checks compact ideal-edit">${items.map((i) => { const p = `idealWeek.@${i.id}`; return `<li>
          <input class="inline" type="time" data-bind="${p}.time" value="${esc(i.time || '')}" aria-label="Time">
          <input class="inline" data-bind="${p}.text" value="${esc(i.text)}" aria-label="Block">
          <button class="x" data-act="del" data-path="idealWeek" data-id="${i.id}" aria-label="Remove">×</button>
          <select class="link" data-bind="${p}.goalId" data-rerender aria-label="Linked goal">${goalOpts(goals, i.goalId)}</select>
          <label class="inline-check small"><input type="checkbox" data-bind="${p}.workout" data-rerender ${i.workout ? 'checked' : ''}> workout</label></li>`; }).join('')}</ul>
        <form class="add" data-add="idealWeek"><input type="hidden" name="dow" value="${d}"><input type="hidden" name="quarter" value="${qk}"><input type="time" name="time" aria-label="Time">
          <input name="text" placeholder="Add a block (e.g. Family night)…" required><button aria-label="Add">+</button></form></section>`;
    };
    const tabs = [shiftQ(cur, -1), cur, shiftQ(cur, 1), shiftQ(cur, 2)];
    if (!tabs.includes(qk)) tabs.unshift(qk);
    const body = `
      <p class="lead">Your ideal week is set each quarter: the rhythm you want your days to follow for these three months. Every block appears on that weekday in Today and Week, ready to check off. Tick "workout" to log a workout when you complete it.</p>
      <nav class="tabs">${tabs.map((k) => `<a href="#/ideal/${k}" class="${k === qk ? 'sel' : ''}">${qLabel(k)}${k === cur ? ' · now' : ''}</a>`).join('')}</nav>
      ${state.idealCarried[qk] ? `<p class="nudge">Copied from ${qLabel(state.idealCarried[qk])}. Adjust it for ${qLabel(qk)}, then <button class="chip" data-act="idealReviewed" data-q="${qk}">Looks good ✓</button></p>` : ''}
      ${!mine.length && prevQ ? `<p class="nudge">Nothing set for ${qLabel(qk)} yet. <button class="chip" data-act="copyIdeal" data-from="${prevQ}" data-to="${qk}">Copy from ${qLabel(prevQ)}</button></p>` : ''}
      <div class="row"><button class="btn ghost" data-act="pushIdeal" data-q="${qk}">Add to Google Calendar (repeats weekly until ${U.fmtDate(qEnd(qk), { month: 'short', day: 'numeric' })})</button>
        <a class="btn ghost" href="#/week">See this week →</a></div>
      <div class="ideal-grid">${order.map(day).join('')}</div>`;
    return page('Ideal Week', `${qLabel(qk)} · a purposeful rhythm for every day`, body);
  }

  function viewLists(tab) {
    tab = tab || 'bucket';
    const tabs = [['bucket', 'Bucket List'], ['hobbies', 'Hobbies & Projects'], ['shopping', 'Shopping'], ['reading', 'Reading & Entertainment'], ['journal', 'Journal'], ['inbox', 'Inbox & To-dos'], ['memories', 'Memories & Quotes'], ['index', 'Notes Index']];
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
    } else if (tab === 'inbox') {
      const open = state.inbox.filter((x) => !x.done).sort((a, b) => (a.date < b.date ? 1 : -1));
      const doneN = state.inbox.length - open.length, wkNow = U.weekKey(today(), ws());
      body += `<p class="prompt">Everything you capture lands here as you think of it. Process it: add it to your week, turn a goal idea into a goal, or let it go.</p>
        <form class="add" data-add="inbox"><input type="hidden" name="date" value="${todayISO()}"><input name="text" placeholder="Add a to-do or idea…" required>
          <select name="kind" aria-label="Type"><option value="todo">To-do</option><option value="goal">Goal idea</option><option value="note">Note</option></select><button aria-label="Add">+</button></form>
        ${open.length ? `<ul class="checks">${open.map((x) => `<li>${chk(`inbox.@${x.id}.done`, 'Done')}
          <small class="chip-label">${{ todo: 'To-do', goal: 'Goal idea', note: 'Note' }[x.kind] || 'To-do'}</small>
          <div class="grow"><input class="inline" data-bind="inbox.@${x.id}.text" value="${esc(x.text)}" aria-label="Item"></div>
          ${x.kind === 'todo' ? `<button class="btn ghost small" data-act="pullIn" data-src="inbox" data-id="${x.id}" data-key="${wkNow}">+ This week</button>` : ''}
          ${x.kind === 'goal' ? `<button class="btn ghost small" data-act="inboxToGoal" data-id="${x.id}">→ Goal</button>` : ''}
          ${x.kind === 'todo' ? schedBtn(x.text) : ''}<button class="x" data-act="del" data-path="inbox" data-id="${x.id}" aria-label="Remove">×</button></li>`).join('')}</ul>` : '<p class="muted">Inbox zero. Capture anything from Today and it shows up here.</p>'}
        ${doneN ? `<p class="muted small">${doneN} processed item${doneN > 1 ? 's' : ''}. <button class="btn ghost small" data-act="clearInbox">Clear processed</button></p>` : ''}`;
    } else if (tab === 'memories') {
      const ms = state.memories.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      body += `<p class="prompt">Key memories, events and the things your family says. Capture them before they fade.</p>
        <form class="add wrap" data-add="memories"><input type="date" name="date" value="${todayISO()}" required aria-label="Date">
          <select name="kind" aria-label="Type"><option value="memory">Memory</option><option value="quote">Quote</option><option value="event">Event</option></select>
          <input name="who" placeholder="Who (e.g. Emma, age 6)" aria-label="Who"><input class="grow" name="text" placeholder="What happened or what they said…" required><button aria-label="Add">+</button></form>
        ${ms.length ? `<ul class="memories">${ms.map((m) => `<li class="${m.kind}"><time>${U.fmtDate(m.date, { month: 'short', day: 'numeric', year: 'numeric' })}</time>
          <div class="grow">${m.kind === 'quote' ? '<span class="qmark">“</span>' : ''}${esc(m.text)}${m.kind === 'quote' ? '<span class="qmark">”</span>' : ''}${m.who ? ` <small class="muted">— ${esc(m.who)}</small>` : ''}</div>
          <button class="x" data-act="del" data-path="memories" data-id="${m.id}" aria-label="Remove">×</button></li>`).join('')}</ul>` : '<p class="muted">Nothing yet. Use the capture bar on Today, or add one above.</p>'}`;
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
    const hasCalendar = gcalConnected();
    const currentApiBase = localStorage.getItem('api_base') || API_BASE;
    if (hasCalendar && !state.gcalCalendars.length && !gcal.listTried) setTimeout(loadCalendarList, 0);
    const calPicker = hasCalendar ? `<div class="gcal-picker"><h3>Calendars to show <small class="muted">· view only, nothing is ever changed in Google</small></h3>
      ${state.gcalCalendars.length ? `<ul class="checks compact">${state.gcalCalendars.map((c) => `<li><input type="checkbox" data-act="gcalToggle" data-id="${esc(c.id)}" ${gcalIsSelected(c) ? 'checked' : ''} aria-label="Show ${esc(c.name)}">
        <span class="swatch" style="background:${esc(c.color)}"></span><span class="grow">${esc(c.name)}${c.primary ? ' <small class="muted">primary</small>' : ''}</span>
        ${c.id === gcalMasterMeta().id ? '<span class="chip on small">★ Master</span>' : gcalWritable(c) ? `<button type="button" class="chip small" data-act="gcalMaster" data-id="${esc(c.id)}">Make master</button>` : '<small class="muted">read-only</small>'}</li>`).join('')}</ul>
      <p class="muted small">The <strong>master calendar</strong> is where Life.OS creates events: photo imports, scheduled tasks and your ideal week. Currently: <strong>${esc(gcalMasterMeta().name)}</strong>.</p>`
        : gcal.listError ? `<p class="nudge">${esc(gcal.listError)} ${gcalNeedsReconnect(gcal.listError) ? '<button class="btn small" data-act="reconnectCalendar">Reconnect Google</button>' : ''}</p>` : '<p class="muted small">Loading your calendars…</p>'}
      <button class="btn ghost small" data-act="gcalLoadCalendars">↻ Reload list</button></div>` : '';
    const body = `
      ${accountCard()}
      ${syncCard()}
      <section class="box"><h2>Integrations</h2>
        <div class="row wrap">
          ${hasCalendar ? `<div style="flex:1"><p class="muted small">✓ Google Calendar connected</p><button class="btn small ghost danger" data-act="disconnectCalendar">Disconnect</button></div>` : `<button class="btn" data-act="connectCalendar">Connect Google Calendar</button>`}
          <button class="btn" data-act="uploadPhoto">Upload photo (OCR)</button>
        </div>
        ${calPicker}
        <label>Backend URL <input type="text" id="apiBaseInput" value="${esc(currentApiBase)}" placeholder="https://..." style="flex:1;"></label>
        <p class="muted small">Connected to backend for Calendar sync and photo OCR. Ask your admin for the URL.</p>
      </section>
      <section class="box"><h2>Planner</h2>
        <div class="row wrap">
          <label>Planner year starts in <select data-bind="settings.plannerStartMonth" data-type="number" data-rerender>${opts(U.MONTHS.map((m, i) => ({ v: i, l: m })), s.plannerStartMonth)}</select></label>
          <label>Week starts on <select data-bind="settings.weekStart" data-type="number" data-rerender>${opts([{ v: 0, l: 'Sunday' }, { v: 1, l: 'Monday' }], s.weekStart)}</select></label>
          <label>Default goal cycle <select data-bind="settings.cycleMonths" data-type="number">${opts([{ v: 6, l: '6 months' }, { v: 3, l: '3 months' }], s.cycleMonths)}</select></label>
          <label>Calendar zoom <select data-bind="settings.calZoom" data-type="number">${opts(ZOOMS.map(([v, l]) => ({ v, l })), zoomLevel())}</select></label>
        </div>
        <p class="muted small">Changing the week start after you've planned weeks will hide those weeks (they're stored by start date).</p>
      </section>
      ${F.settingsExtra ? F.settingsExtra() : ''}
      ${canNotify ? `<section class="box"><h2>Daily ritual reminders</h2>
        <label class="row"><input type="checkbox" data-bind="settings.notificationsEnabled" data-rerender> Browser notifications for rituals and goals</label>
        ${notifPerm === 'granted' ? `<div class="row wrap">
          <label>Notify me at <input type="time" data-bind="settings.notificationTime" data-rerender value="${esc(s.notificationTime)}"></label>
          <label>Quiet hours <input type="time" data-bind="settings.quietStart" value="${esc(s.quietStart)}"> to <input type="time" data-bind="settings.quietEnd" value="${esc(s.quietEnd)}"></label>
        </div>` : notifPerm === 'denied' ? '<p class="muted small">⚠️ Notifications are blocked. Check your browser settings.</p>' : s.notificationsEnabled ? '<p class="muted small">Enable notifications for rituals due, habit milestones, and goal check-ins.</p>' : ''}
      </section>` : ''}
      <section class="box"><h2>Your data</h2>
        <p>${signedIn() && state.settings.syncOn ? 'Your plan is on this device and in your own Google Drive (a hidden folder only Life.OS can open).' : 'Your plan is stored only in this browser. Sign in to keep a copy in your own Google Drive.'} Export a backup any time.</p>
        <div class="row wrap">
          <button class="btn" data-act="export">Export backup (.json)</button>
          <a class="btn ghost" href="#/welcome/1">Take the tour</a>
          <a class="btn ghost" href="#/quick/1">Quick start</a>
          <a class="btn ghost" href="#/setup/1">Run setup guide</a>
          ${state.goals.some((g) => g.seed) ? '<button class="btn ghost" data-act="removeSamples">Remove sample goals</button>' : ''}
          <label class="btn ghost file">Import backup<input type="file" accept="application/json,.json" data-import hidden></label>
          <button class="btn ghost danger" data-act="reset">Erase data on this device</button>
          <button class="btn ghost danger" data-act="deleteEverything">Delete everything, everywhere</button>
        </div>
        <p class="muted small">“Delete everything” removes your plan from this device, deletes the copy and backups in your Google Drive, and revokes Life.OS's access to your Google account. <a href="privacy.html">Privacy policy</a> · <a href="terms.html">Terms</a></p>
      </section>`;
    return page('Settings', '', body);
  }

  /* ---------- copy-for-planner text ---------- */
  function actionsText(list) {
    return P.LIFE.map((a) => {
      const l = list.filter((i) => P.lifeArea(i.area || '', '', i.text) === a.id);
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
    goals: () => ({ area: 'career', tier: 'pursuit', progress: 0, status: 'active', target: '', doneBy: '', measure: '', kind: 'achievement', why: '', perWeek: 5, log: {}, milestones: [], objectives: [], routines: [] }),
    big3: () => ({ done: false, goalId: '' }),
    top3: () => ({ done: false, goalId: '' }),
    inbox: () => ({ kind: 'todo', done: false }),
    memories: () => ({ kind: 'memory', who: '' }),
    idealWeek: () => ({ time: '', goalId: '', workout: false }),
    milestones: () => ({ done: false, due: '' }),
    objectives: () => ({ done: false, due: '' }),
    routines: () => ({ perWeek: 1, log: {} }),
    actions: () => ({ done: false, goalId: '' }),
    habits: () => ({ target: 5, days: [false, false, false, false, false, false, false] }),
    shopping: () => ({ done: false }),
    steps: () => ({ done: false }),
    schedule: () => ({ time: '', mins: '' }),
    workouts: () => ({ done: false, details: '', minutes: '', time: '' }),
    projects: () => ({ status: 'active', goalId: '', notes: '', steps: [] }),
    bucket: () => ({ star: false, done: false, budget: '', target: '', details: '' }),
    reading: () => ({ done: false, by: '', genre: '', nutshell: '' }),
    events: () => ({ end: '', yearly: false, kind: 'event' }),
    roles: () => ({ why: '' }),
    journals: () => ({ text: '' }),
  };

  const trashLabel = (it) => String((it && (it.title || it.text || it.name || it.type || it.date)) || '').trim();
  function trashItem(path, item) {
    if (!item || path === 'trash') return;
    state.trash = (state.trash || []).filter((t) => t.at >= U.toISO(U.addDays(today(), -60)));
    state.trash.push({ id: S.uid(), path, item: JSON.parse(JSON.stringify(item)), at: todayISO(), label: trashLabel(item) });
    if (state.trash.length > 300) state.trash.shift();
  }
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
      if (i >= 0) {
        const [item] = list.splice(i, 1);
        trashItem(el.dataset.path, item);
        commit(); toast(`Deleted ${trashLabel(item) ? `“${trashLabel(item).slice(0, 40)}”` : 'item'}`, { label: 'Undo', fn: undo });
      } else commit();
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
      trashItem('roles', r);
      commit(); toast(`Deleted role “${r.name}”`, { label: 'Undo', fn: undo });
    },
    delCycle(el) {
      const c = state.cycles.find((x) => x.id === el.dataset.id);
      if (!confirm(`Delete cycle "${c.name}" and its goals?`)) return;
      state.cycles = state.cycles.filter((x) => x.id !== c.id);
      state.goals = state.goals.filter((g) => g.cycleId !== c.id);
      commit(); location.hash = '#/goals'; toast(`Deleted cycle “${c.name}”`, { label: 'Undo', fn: undo });
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
      if (!confirm('Erase ALL Life.OS data in this browser? A backup file will be downloaded first.')) return;
      ACTS.export();
      state = S.defaultState(); rebaseIds(); commit();
    },
    clearShopping() { state.shopping = state.shopping.filter((x) => !x.done); commit(); },
    copyDlg() {
      const t = document.querySelector('#dlg textarea');
      t.select();
      (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject())
        .then(() => toast('Copied'), () => { document.execCommand('copy'); toast('Copied'); });
    },
    connectCalendar() {
      localStorage.removeItem('google_cal_off');
      if (/auth\/calendar/.test(gScope())) { gcalReset(); commit(); toast('Google Calendar is back on'); } else startGoogleOAuth('calendar');
    },
    disconnectCalendar() {
      if (!confirm('Stop showing Google Calendar?')) return;
      if (signedIn()) localStorage.setItem('google_cal_off', '1');          // stay signed in; just hide the calendar
      else ['google_access_token', 'google_refresh_token', 'google_scope', 'google_email'].forEach((k) => localStorage.removeItem(k));
      gcalReset(); commit();
    },
    async uploadPhoto() {
      if (!signedIn()) { toast('Photo import needs a Google sign-in. Use "Sign in" at the top.'); return; }
      const a = await ocrAllowed();
      if (!a.allowed) { toast(a.signedIn === false ? 'Please sign in with Google again.' : `Photo import is limited to approved accounts. Ask the owner to add ${a.email || 'your email'}.`); return; }
      document.getElementById('uploadDlg').showModal();
    },
    pullIn(el) {
      const { src, id, key } = el.dataset;
      if (src === 'task') { const t = state.tasks.find((x) => x.id === id); if (t) { const days = Array.from({ length: 7 }, (_, i) => U.toISO(U.addDays(U.parseISO(key), i))); t.day = days.includes(todayISO()) ? todayISO() : key; toast('Planned for this week'); commit(); } return; }
      const item = src === 'inbox' ? state.inbox.find((x) => x.id === id) : state.bucket.find((x) => x.id === id);
      if (!item) return;
      getWeek(key).actions.push({ id: S.uid(), area: src === 'bucket' ? 'fun' : 'home', text: item.text, goalId: '', done: false });
      if (src === 'inbox') item.done = true;
      toast('Added to this week'); commit();
    },
    inboxToGoal(el) {
      const it = state.inbox.find((x) => x.id === el.dataset.id);
      if (!it) return;
      addSuggestedGoal({ title: it.text, area: 'career' }, 'achievement');
      it.done = true; toast('Added as a goal. Plan it under Roles & Goals.'); commit();
    },
    clearInbox() { state.inbox = state.inbox.filter((x) => !x.done); commit(); },
    demoFocus(el) {
      const id = el.dataset.id, i = demo.focus.indexOf(id);
      if (i >= 0) demo.focus.splice(i, 1); else if (demo.focus.length >= 4) { toast('Focus on 3–4 goals. Untick one first.'); return; } else demo.focus.push(id);
      render();
    },
    demoAssign(el) { const { id, day } = el.dataset; demo.assigned[id] = demo.assigned[id] === Number(day) ? 0 : Number(day); render(); },
    demoDay(el) { demo.day = Number(el.dataset.day); render(); },
    demoHabit(el) { demo.habit[el.dataset.id] = !demo.habit[el.dataset.id]; render(); },
    demoReset() { demo = demoFresh(); location.hash = '#/welcome/1'; },
    demoPersona(el) {
      const id = el.dataset.id, i = demo.personas.indexOf(id);
      if (i >= 0) demo.personas.splice(i, 1); else demo.personas.push(id);
      rebuildDemo(); render();
    },
    demoStart(el) {   // carry the tour's "about you" answers into the real setup
      if (demo.personas.length) { state.settings.personas = demo.personas.slice(); quick.touched = false; quickPreselect(); S.save(state); }
      location.hash = el.dataset.to === 'setup' ? '#/setup/1' : '#/quick/1';
    },
    demoSchedule(el) {
      const task = demoTasks().find((t) => t.id === el.dataset.id) || (() => { const g = dg(el.dataset.id.replace('step:', '')); return g ? { text: g.steps[0], g } : null; })();
      if (!task) return;
      const dow = demo.day, busy = demoBlocksFor(dow).map((b) => [b.start, b.start + b.mins]);
      let t0 = 9 * 60; while (t0 < 17 * 60 && busy.some(([a, b]) => t0 < b && t0 + 45 > a)) t0 += 15;
      (demo.scheduled[dow] = demo.scheduled[dow] || []).push({ text: task.text, start: t0, mins: 45, color: task.g.color });
      toast(`Scheduled for ${fmtTime(hhmm24(t0))}`); render();
    },
    nextQuote() { quoteIdx = (quoteIdx + 1) % QUOTES.length; showQuote(); },
    assignTask(el) { const it = get(el.dataset.path); if (it) { it.day = el.dataset.day; commit(); } },
    unassignTask(el) { const it = get(el.dataset.path); if (it) { it.day = ''; commit(); } },
    assignStep(el) {
      const g = state.goals.find((x) => x.id === el.dataset.goal); if (!g) return;
      const ns = nextStep(g);
      getWeek(U.weekKey(U.parseISO(el.dataset.day), ws())).actions.push({ id: S.uid(), area: g.area, text: ns ? ns.text : `Work on: ${g.title}`, goalId: g.id, done: false, day: el.dataset.day });
      commit();
    },
    selectDay(el) {
      weekSel[el.dataset.key] = el.dataset.day; render();
      if (el.dataset.scroll) { const dp = document.querySelector('.day-planner'); if (dp) dp.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    },
    scheduleItem(el) { openScheduleDialog({ text: el.dataset.text, date: todayISO(), mins: Number(el.dataset.mins) || 30 }); },
    gcalToggle(el) {
      const prim = gcalPrimary();
      const cur = new Set(gcalSelectedIds().map((id) => (id === 'primary' && prim ? prim.id : id)));
      const id = el.dataset.id;
      if (cur.has(id)) cur.delete(id); else cur.add(id);
      if (!cur.size) { toast('Keep at least one calendar selected'); return; }
      if (cur.size > 10) { toast('You can show up to 10 calendars'); return; }
      state.settings.gcalSelected = [...cur]; gcalReset(); commit();
    },
    reconnectCalendar() {
      gcalReset(); gcal.listTried = false; gcal.listError = '';
      startGoogleOAuth('calendar');
    },
    togglePersona(el) {
      const ids = personas(), id = el.dataset.id, i = ids.indexOf(id);
      if (i >= 0) ids.splice(i, 1); else ids.push(id);
      state.settings.personas = ids;
      showMore.roles = showMore.goals = showMore.habits = false;
      quickPreselect(); commit();
    },
    quickBalance() { quickPreselect(true); quick.touched = true; render(); },
    showMore(el) { showMore[el.dataset.k] = true; render(); },
    addPersonaRoles() {
      personaRoles().forEach((r) => { if (!state.roles.some((x) => x.name.toLowerCase() === r.name.toLowerCase())) state.roles.push({ id: S.uid(), name: r.name, why: r.why }); });
      commit();
    },
    legacySeed(el) {
      const seeds = ['The people I helped…', 'What I want my children to carry forward…', 'The cause or community I invested in…', 'The work I want to leave behind…'];
      const cur = (state.foundation.legacy || '').trim();
      state.foundation.legacy = `${cur ? `${cur}\n\n` : ''}${seeds[Number(el.dataset.idx)] || ''} `; commit();
    },
    fdPurpose() { const p = personas().length ? PERSONAS.find((x) => x.id === personas()[0]).purpose : QUICK_PURPOSES[0]; state.foundation.mission = p; commit(); },
    fdGoal(el) {
      const sg = SUGGEST.goals[Number(el.dataset.idx)]; if (!sg) return;
      const g = addSuggestedGoal(sg, 'achievement', true), qk = quarterKey(todayISO());
      state.focus[qk] = state.focus[qk] || []; if (!state.focus[qk].includes(g.id) && state.focus[qk].length < 4) state.focus[qk].push(g.id);
      if (sg.steps && sg.steps[0] && state.big3.filter((b) => b.date === todayISO()).length < 3) state.big3.push({ id: S.uid(), date: todayISO(), text: sg.steps[0], goalId: g.id, stepRef: '', done: false });
      commit(); toast(`Added “${sg.title}”. Its first step is on today's list.`);
    },
    fdDismiss() { state.settings.setupDismissed = true; commit(); },
    quickPurpose(el) { quick.purpose = purposeIdeas()[Number(el.dataset.idx)] || ''; render(); },
    quickGoal(el) {
      quick.touched = true;
      const id = el.dataset.id, i = quick.goals.indexOf(id);
      if (i >= 0) quick.goals.splice(i, 1);
      else if (quick.goals.length >= 5) { toast('Five is plenty to start. You can add more later.'); return; }
      else quick.goals.push(id);
      render();
    },
    quickHabit(el) {
      quick.touched = true;
      const id = el.dataset.id, i = quick.habits.indexOf(id);
      if (i >= 0) quick.habits.splice(i, 1);
      else if (quick.habits.length >= 5) { toast('Five habits is a good start. You can add more later.'); return; }
      else quick.habits.push(id);
      render();
    },
    quickRhythm() { quick.rhythm = !quick.rhythm; render(); },
    quickAddCustom() {
      const inp = document.getElementById('quickCustom'), t = inp ? inp.value.trim() : '';
      if (!t) return;
      if (quick.goals.length >= 5) { toast('Five is plenty to start. You can add more later.'); return; }
      quick.touched = true; quick.custom.push(t); quick.goals.push(`c${quick.custom.length - 1}`); render();
    },
    quickBuild() {
      const goals = quickGoalList().filter((g) => quick.goals.includes(g.id)), habits = quickHabitList().filter((h) => quick.habits.includes(h.id));
      if (!goals.length && !habits.length && !quick.rhythm && !quick.purpose.trim()) { toast('Pick at least one thing, or choose Skip.'); return; }
      if (quick.purpose.trim()) state.foundation.mission = quick.purpose.trim();
      const qk = quarterKey(todayISO());
      state.focus[qk] = state.focus[qk] || [];
      goals.forEach((sg) => { const g = addSuggestedGoal(sg, 'achievement', true); if (g && !state.focus[qk].includes(g.id) && state.focus[qk].length < 4) state.focus[qk].push(g.id); });
      habits.forEach((h) => addSuggestedGoal(h, 'habit', true));
      personaRoles().forEach((r) => roleIdFor(r.name, true));
      if (quick.rhythm) applyIdealStarter();
      quick = quickFresh(); commit(); toast('Your plan is ready'); location.hash = '#/today';
    },
    pickPhotos() { document.getElementById('uploadInput').click(); },
    signIn() { startGoogleOAuth('signin'); },
    landingSkip() { setAccountMode('local'); location.hash = '#/start'; },
    account() { if (signedIn()) location.hash = '#/settings'; else startGoogleOAuth('signin'); },
    signOut(el) {
      const wipe = el.dataset.wipe === '1';
      if (confirm(wipe ? 'Sign out and remove your plan from this device? It stays safe in your Google Drive.' : 'Sign out? Your plan stays on this device.')) doSignOut(wipe);
    },
    syncEnable() { if (syncHasScope()) { state.settings.syncOn = true; commit(); syncNow(); } else startGoogleOAuth('signin'); },
    syncNow() { if (!state.settings.syncOn) return; syncNow(); },
    async deleteEverything() {
      if (!confirm('Delete EVERYTHING? This erases your plan on this device, deletes your Life.OS copy and backups from Google Drive, and removes Life.OS\'s access to your Google account. It cannot be undone. Download a backup first if you might want it.')) return;
      if ((prompt('Type DELETE to confirm') || '').trim() !== 'DELETE') { toast('Nothing was deleted'); return; }
      toast('Deleting…');
      clearTimeout(sync.timer); sync.epoch++;
      try {
        if (syncHasScope()) for (const f of [...await driveList(`name='${SYNC_FILE}' and trashed=false`), ...await driveList("name contains 'lifeos-backup-' and trashed=false")]) await driveFetch(`${DRIVE}/${f.id}`, { method: 'DELETE' });
      } catch (e) { toast(`Could not delete your Google Drive copy (${e.message}). Nothing was changed. Try again, or remove Life.OS in your Google account settings.`); return; }
      const rt = localStorage.getItem('google_refresh_token') || localStorage.getItem('google_access_token');
      if (rt) { try { await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `token=${encodeURIComponent(rt)}` }); } catch (e) { /* the token also expires on its own */ } }
      try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* storage unavailable */ }
      try { for (const k of await caches.keys()) await caches.delete(k); } catch (e) { /* no cache API */ }
      try { sessionStorage.setItem('lifeos.toast', 'Everything was deleted from this device and from Google Drive.'); } catch (e) { /* storage unavailable */ }
      location.hash = '#/landing'; location.reload();
    },
    syncOff() { state.settings.syncOn = false; sync.status = 'off'; commit(); toast('Sync is off. Your Drive copy is kept.'); },
    syncBackups() { loadBackups(); },
    syncRestore(el) { if (confirm('Replace this device\'s plan with that backup? It becomes your current copy everywhere.')) restoreBackup(el.dataset.id); },
    syncSnooze() { state.settings.syncNudgeUntil = U.toISO(U.addDays(today(), 7)); commit(); },
    async syncDelete() {
      if (!confirm('Delete your Life.OS copy and all backups from Google Drive? Your data on this device is not touched.')) return;
      try {
        for (const f of [...await driveList(`name='${SYNC_FILE}' and trashed=false`), ...await driveList("name contains 'lifeos-backup-' and trashed=false")]) await driveFetch(`${DRIVE}/${f.id}`, { method: 'DELETE' });
        state.settings.syncOn = false; state.syncMeta = {}; sync.backups = null; commit(); toast('Cloud copy deleted');
      } catch (e) { toast(e.message); }
    },
    calZoom(el) {
      const cur = zoomLevel(), i = ZOOMS.findIndex((x) => x[0] === cur), j = Math.min(ZOOMS.length - 1, Math.max(0, i + Number(el.dataset.dir)));
      if (j === i) return;
      const w = document.querySelector('.tl-wrap'), mins = w ? w.scrollTop / cur : null;   // keep the same time of day in view
      state.settings.calZoom = ZOOMS[j][0]; tlScroll = mins != null ? mins * ZOOMS[j][0] : null; commit();
    },
    gcalMaster(el) {
      state.settings.gcalMaster = el.dataset.id; gcalEnsureSelected(el.dataset.id); gcalReset(); commit();
      toast(`Master calendar: ${gcalMasterMeta().name}`);
    },
    gcalLoadCalendars() { loadCalendarList(); },
    gcalRefresh(el) { loadGcal(el.dataset.from, el.dataset.to, true); },
    completeSession(el) {
      const rec = (state.sessions[el.dataset.key] = state.sessions[el.dataset.key] || { steps: {} });
      rec.done = todayISO(); toast('Session complete'); commit();
    },
    idealDone(el) {
      const { id, date } = el.dataset, it = state.idealWeek.find((x) => x.id === id);
      const log = (state.idealLog[date] = state.idealLog[date] || {});
      const now = log[id] !== true;
      log[id] = now ? true : undefined;
      if (it && it.workout) {
        state.workouts = state.workouts.filter((w) => !(w.ideal === id && w.date === date));
        if (now) state.workouts.push({ id: S.uid(), date, type: it.text, done: true, minutes: '', details: '', time: it.time || '', ideal: id });
      }
      commit();
    },
    idealSkip(el) { const log = (state.idealLog[el.dataset.date] = state.idealLog[el.dataset.date] || {}); log[el.dataset.id] = 'skip'; commit(); },
    pushIdeal(el) {
      const qk = (el && el.dataset.q) || quarterKey(todayISO()), items = idealFor(qk).filter((i) => i.text);
      if (!localStorage.getItem('google_access_token')) { toast('Connect Google Calendar in Settings first'); return; }
      if (!items.length) { toast('Add some blocks to this quarter first'); return; }
      if (!confirm(`Add ${items.length} weekly repeating events to your Google Calendar through the end of ${qLabel(qk)}? Do this once per quarter; running it again creates duplicates.`)) return;
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const t0 = U.parseISO(qStart(qk) > todayISO() ? qStart(qk) : todayISO());
      const until = `${qEnd(qk).replace(/-/g, '')}T235959Z`;
      const localIso = (d) => `${U.toISO(d)}T${U.pad(d.getHours())}:${U.pad(d.getMinutes())}:00`;
      pushToGoogleCalendar(items.map((i) => {
        const first = U.addDays(t0, (Number(i.dow) - t0.getDay() + 7) % 7), date = U.toISO(first);
        const raw = { text: i.text, date, recurrence: [`RRULE:FREQ=WEEKLY;UNTIL=${until}`] };
        if (i.time) { const st = new Date(`${date}T${i.time}`); raw.start = localIso(st); raw.end = localIso(new Date(st.getTime() + 3600000)); raw.timeZone = tz; }
        return { raw };
      }));
    },
    copyIdeal(el) {
      const { from, to } = el.dataset;
      idealFor(from).forEach((i) => state.idealWeek.push({ ...i, id: S.uid(), quarter: to }));
      commit(); toast(`Copied from ${qLabel(from)}`);
    },
    idealReviewed(el) { delete state.idealCarried[el.dataset.q]; commit(); },
    toggleFocus(el) {
      const qk = quarterKey(todayISO());
      const list = (state.focus[qk] = (state.focus[qk] || []).filter((id) => state.goals.some((g) => g.id === id)));
      const i = list.indexOf(el.dataset.goal);
      if (i >= 0) list.splice(i, 1);
      else if (list.length >= 4) { toast('Focus on 3–4 goals per quarter. Remove one first.'); return; }
      else list.push(el.dataset.goal);
      commit();
    },
    focusToBig3(el) {
      const iso = todayISO();
      if (state.big3.filter((b) => b.date === iso).length >= 3) { toast('Today already has 3. Finish or remove one first.'); return; }
      const g = state.goals.find((x) => x.id === el.dataset.goal);
      const ns = g && nextStep(g, new Set(state.big3.filter((b) => b.stepRef && (b.done || b.date === iso)).map((b) => b.stepRef)));
      state.big3.push({ id: S.uid(), date: iso, text: ns ? ns.text : `Make progress on: ${g.title}`, goalId: g.id, stepRef: ns ? ns.ref : '', done: false });
      commit();
    },
    migrateBig3(el) {
      const iso = todayISO();
      const b = state.big3.find((x) => x.id === el.dataset.id);
      if (!b || state.big3.filter((x) => x.date === iso).length >= 3) return;
      b.migrated = true;
      state.big3.push({ id: S.uid(), date: iso, text: b.text, goalId: b.goalId, stepRef: b.stepRef, done: false });
      commit();
    },
    dropBig3(el) { const b = state.big3.find((x) => x.id === el.dataset.id); if (b) b.migrated = true; commit(); },
    addSuggestedRole(el) {
      const r = SUGGEST.roles[Number(el.dataset.idx)];
      if (r && !state.roles.some((x) => x.name.toLowerCase() === r.name.toLowerCase())) state.roles.push({ id: S.uid(), name: r.name, why: r.why });
      commit();
    },
    addSuggestedGoal(el) { addSuggestedGoal(SUGGEST.goals[Number(el.dataset.idx)], 'achievement'); commit(); },
    addSuggestedHabit(el) { addSuggestedGoal(SUGGEST.habits[Number(el.dataset.idx)], 'habit'); commit(); },
    addIdealBlock(el) {
      const b = SUGGEST.ideal[Number(el.dataset.idx)];
      if (b) state.idealWeek.push({ id: S.uid(), quarter: quarterKey(todayISO()), dow: Number(el.dataset.dow), time: b.time || '', text: b.text, goalId: '', workout: !!b.workout });
      commit();
    },
    idealStarter() { applyIdealStarter(); commit(); },
    finishSetup() { state.settings.setupDone = true; commit(); location.hash = '#/today'; },
    dismissSetup() { state.settings.setupDismissed = true; commit(); },
    removeSamples() {
      if (!confirm('Remove the sample roles and goals? Your own goals are kept.')) return;
      removeSamples(); commit();
    },
    delImport(el) {
      const n = state.schedule.filter((x) => x.batch === el.dataset.id).length;
      if (!confirm(`Remove all ${n} events from this photo import?`)) return;
      state.schedule = state.schedule.filter((x) => x.batch !== el.dataset.id); commit();
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
      if (el.type === 'checkbox' && /\.done$/.test(el.dataset.bind)) {   // remember when things were finished, for review summaries
        const parent = get(el.dataset.bind.replace(/\.done$/, ''));
        if (parent && typeof parent === 'object' && !Array.isArray(parent)) parent.doneAt = el.checked ? todayISO() : '';
      }
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
    if (form.dataset.actForm === 'capture') {
      e.preventDefault();
      const fd = new FormData(form), text = String(fd.get('text') || '').trim(), kind = fd.get('kind');
      if (!text) return;
      if (kind === 'memory' || kind === 'quote') state.memories.push({ id: S.uid(), date: todayISO(), kind, who: '', text });
      else if (kind === 'todo' && F.quickAdd) { F.addFromText(text); const again = document.querySelector('form.capture input[name=text]'); if (again) again.focus(); return; }
      else state.inbox.push({ id: S.uid(), kind, text, date: todayISO(), done: false });
      commit(); toast(kind === 'memory' || kind === 'quote' ? 'Saved to Memories & Quotes' : 'Captured to your inbox');
      const again = document.querySelector('form.capture input[name=text]'); if (again) again.focus();
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
    if (/\.actions$/.test(path) && !item.area) { const g = state.goals.find((x) => x.id === item.goalId); item.area = g ? g.area : 'personal'; }
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
        state = S.migrate(data); rebaseIds(); commit(); toast('Imported');
      } catch (err) { alert(`Import failed: ${err.message}`); }
    };
    r.readAsText(file);
  }


  function removeSamples() {
    state.goals = state.goals.filter((g) => !g.seed);
    state.roles = state.roles.filter((r) => !r.seed);
    state.idealWeek = state.idealWeek.filter((i) => !i.seed);
  }

  /* ---------- guided setup (onboarding) ---------- */
  /* "I am…" personas tailor the suggestion library. Items with no `for` suit everyone. */
  const PERSONAS = [
    { id: 'student', label: 'I\'m a student', sub: 'school, college or training', purpose: 'To learn deeply, finish what I start and become who I want to be.' },
    { id: 'parent', label: 'I\'m a parent', sub: 'raising kids at home', purpose: 'To raise kids who feel loved, capable and known.' },
    { id: 'partner', label: 'I\'m married or partnered', sub: 'a relationship to nurture', purpose: 'To keep choosing my partner and build a strong home together.' },
    { id: 'work', label: 'I work full-time', sub: 'a job or career', purpose: 'To do work I am proud of and still have energy for the people I love.' },
    { id: 'business', label: 'I run a business', sub: 'owner, founder or freelancer', purpose: 'To build something that serves people well and gives me room to live.' },
    { id: 'caregiver', label: 'I\'m caring for a family member', sub: 'aging parent, partner or child with needs', purpose: 'To care well for those who need me without losing myself.' },
    { id: 'retired', label: 'I\'m retired or semi-retired', sub: 'time to shape on my terms', purpose: 'To spend this season on people, purpose and joy.' },
    { id: 'health', label: 'I want to get healthier', sub: 'fitness, sleep, energy', purpose: 'To have the health and energy to show up fully for my life.' },
    { id: 'faith', label: 'Faith is central to my life', sub: 'prayer, worship, service', purpose: 'To grow in faith and let it shape how I love and serve.' },
    { id: 'creative', label: 'I make things', sub: 'writing, art, music, projects', purpose: 'To make things worth sharing and finish what I begin.' },
  ];
  const G = (f, role, area, title, why, steps, x) => Object.assign({ title, steps, role, area, why, for: f }, x || {});
  const H = (f, role, area, title, perWeek, x) => Object.assign({ title, perWeek, role, area, for: f }, x || {});
  const SUGGEST = {
    roles: [
      { name: 'Parent', why: 'Be present and intentional with my kids while they are young.', for: ['parent'] },
      { name: 'Partner', why: 'Build a strong, loving relationship.', for: ['partner'] },
      { name: 'Professional', why: 'Grow in skill and contribute work I am proud of.', for: ['work'] },
      { name: 'Healthy person', why: 'Energy and health let me show up well for everything else.', for: ['health', 'retired'] },
      { name: 'Friend', why: 'Community is built by showing up.', for: [] },
      { name: 'Learner', why: 'Stay curious and keep growing.', for: ['student', 'retired'] },
      { name: 'Family', why: 'Show up for the people who made me.', for: ['caregiver'] },
      { name: 'Student', why: 'These years shape the options I will have for decades.', for: ['student'] },
      { name: 'Business owner', why: 'Build something that serves customers and sustains my family.', for: ['business'] },
      { name: 'Leader', why: 'Help the people around me do their best work.', for: ['work', 'business'] },
      { name: 'Caregiver', why: 'Love shown through steady, patient care.', for: ['caregiver'] },
      { name: 'Household manager', why: 'A well-run home gives everyone room to breathe.', for: ['parent', 'partner', 'retired'] },
      { name: 'Retiree', why: 'Shape this season of life on purpose, not by default.', for: ['retired'] },
      { name: 'Grandparent', why: 'Be the steady, delighted presence I wish every child had.', for: ['retired'] },
      { name: 'Community member', why: 'The place I live is better when I show up for it.', for: ['retired', 'faith', 'parent'] },
      { name: 'Person of faith', why: 'My faith is the root that everything else grows from.', for: ['faith'] },
      { name: 'Creator', why: 'Making things is how I understand the world and share it.', for: ['creative'] },
      { name: 'Money steward', why: 'Calm finances protect the people and plans I care about.', for: [] },
    ],
    goals: [
      // everyone
      G([], 'Family', 'friends', 'Build a closer relationship with Dad', 'He will not always be a phone call away.', ['Pick a regular call day and time', 'Plan a weekend visit'], { routine: { text: 'Call Dad', perWeek: 1 } }),
      G([], 'Friend', 'friends', 'Reconnect with a close friend', 'Friendships fade unless I tend them.', ['Text a friend to set a coffee', 'Send a birthday card']),
      G([], 'Money steward', 'home', 'Save a three-month emergency fund', 'Financial peace of mind for the people I love.', ['Total up three months of expenses', 'Open a dedicated savings account', 'Set up an automatic transfer']),
      G([], 'Money steward', 'home', 'Create a monthly budget and stick to it', 'Money goes where I decide, not where it drifts.', ['Track spending for one month', 'Set a number for each category', 'Review it on the first of each month']),
      G([], 'Money steward', 'home', 'Pay off a debt', 'Every payment buys back future freedom.', ['List every debt with its rate', 'Pick the one to attack first', 'Automate the extra payment']),
      G([], 'Household manager', 'home', 'Declutter and organize the house', 'A calm home makes room for what matters.', ['Pick the first room to tackle', 'Donate or toss one full box', 'Finish the second room']),
      G([], 'Learner', 'projects', 'Finish a hobby project I keep putting off', 'Finishing it frees mental space.', ['List what is left to do', 'Gather the supplies', 'Finish the next piece']),
      G([], 'Friend', 'friends', 'Host friends or family for a gathering', 'Strong friendships take intention.', ['Pick a date and guest list', 'Send invitations', 'Plan the menu']),
      G([], 'Learner', 'projects', 'Read twelve books this year', 'Reading keeps me learning and curious.', ['Pick the next three books', 'Set a reading goal per month', 'Finish book one']),
      G([], 'Learner', 'fun', 'Try something new every month', 'A life of new things stays vivid.', ['List twelve things I have never tried', 'Put the first one on the calendar', 'Invite someone along']),
      G([], 'Learner', 'projects', 'Learn a new language', 'It opens people, places and a sharper mind.', ['Pick an app or class', 'Set a daily ten-minute slot', 'Have a first conversation']),
      G([], 'Friend', 'friends', 'Make a new friend or join a community', 'Belonging does not happen by accident.', ['List three groups or classes nearby', 'Go to one this month', 'Invite someone for coffee']),
      G([], 'Healthy person', 'health', 'Get a full health checkup', 'Small problems are cheap to fix early.', ['Book physical, dental and eye exams', 'Get bloodwork done', 'Write down my questions']),
      G([], 'Learner', 'home', 'Do a digital declutter', 'Less noise on my phone gives me back attention.', ['Unsubscribe from fifteen lists', 'Delete unused apps', 'Set up a simple photo backup']),
      // student
      G(['student'], 'Student', 'work', 'Finish this term strong', 'The habits I build now carry into the career I want.', ['List every assignment and exam date', 'Block weekly study time on the calendar', 'Meet each teacher or professor once', 'Finish with my target grades']),
      G(['student'], 'Student', 'work', 'Build a study system that works', 'Studying smarter beats studying longer.', ['Choose a regular study spot', 'Try a weekly review of my notes', 'Make flashcards for the hardest subject']),
      G(['student'], 'Student', 'work', 'Land an internship or first job', 'Real experience turns learning into options.', ['Update my resume', 'Apply to five places', 'Practice an interview with a friend', 'Follow up on every application']),
      G(['student'], 'Student', 'work', 'Graduate on time', 'Finishing on schedule saves money and momentum.', ['Meet with my advisor', 'Map every remaining requirement', 'Register for next term']),
      G(['student'], 'Money steward', 'home', 'Live on a student budget without stress', 'Staying out of debt keeps my choices open.', ['Track spending for one month', 'Set a weekly spending limit', 'Open a savings account']),
      G(['student'], 'Friend', 'friends', 'Join a club or team', 'Friends and mentors are half of what school gives.', ['List three clubs that interest me', 'Go to one meeting', 'Take on a small role']),
      // parent
      G(['parent'], 'Parent', 'home', 'One-on-one time with each kid', 'They will remember the time, not the stuff.', ['Pick an activity for each child', 'Put it on the calendar'], { routine: { text: 'Bedtime talk with one child', perWeek: 3 } }),
      G(['parent'], 'Parent', 'fun', 'Take a family trip together', 'Shared experiences become the stories we tell for years.', ['Pick the destination and dates', 'Set the trip budget', 'Book travel and lodging', 'Plan activities with the kids'], { purpose: true }),
      G(['parent'], 'Parent', 'home', 'Teach one new skill a month to the kids', 'Mentor my children to be better versions of themselves.', ['Pick a skill for the month', 'Schedule the lesson on a weekend', 'Review what they learned']),
      G(['parent'], 'Parent', 'fun', 'Start a weekly family night', 'A predictable time together builds belonging.', ['Pick the night', 'Let the kids list ideas', 'Hold the first one']),
      G(['parent'], 'Parent', 'home', 'Calm the family mornings', 'A better start sets the tone for the whole day.', ['Name the three things that cause chaos', 'Prepare bags and clothes the night before', 'Try the new routine for two weeks']),
      G(['parent'], 'Money steward', 'home', 'Start saving for the kids\' future', 'A little each month grows into real options.', ['Open an education or savings account', 'Set an automatic monthly deposit', 'Review it each quarter']),
      G(['parent'], 'Parent', 'fun', 'Make a family photo book', 'These years pass quickly and the photos get buried.', ['Gather this year\'s photos', 'Pick the best fifty', 'Order the book']),
      // partner
      G(['partner'], 'Partner', 'friends', 'Deepen my marriage', 'Our kids learn love by watching ours.', ['Plan a monthly date night', 'Book a weekend away'], { routine: { text: 'Daily check-in with my spouse', perWeek: 7 } }),
      G(['partner'], 'Partner', 'friends', 'Plan a weekend away with my spouse', 'Our relationship deserves focused time together.', ['Pick dates that work for both of us', 'Arrange childcare', 'Book the getaway']),
      G(['partner'], 'Partner', 'home', 'Get on the same page about money', 'Shared goals ease the biggest source of conflict.', ['Pick a monthly money-talk date', 'List our shared goals', 'Set up a shared budget']),
      G(['partner'], 'Partner', 'fun', 'Take up a hobby together', 'Doing something new side by side keeps us curious about each other.', ['Brainstorm five ideas each', 'Try one together', 'Put a regular time on the calendar']),
      // work
      G(['work'], 'Professional', 'work', 'Complete one skill-building course', 'Investing in skills opens the next opportunity.', ['Choose the course', 'Block weekly study time on the calendar', 'Finish half the lessons', 'Finish the final project']),
      G(['work'], 'Professional', 'work', 'Earn a promotion or a bigger role', 'I want my work to grow along with me.', ['Ask my manager what great looks like', 'Pick one visible project', 'Share progress every month']),
      G(['work'], 'Professional', 'work', 'Protect two hours of deep work every day', 'My best work happens without interruptions.', ['Pick the hours that suit me best', 'Block them on my calendar', 'Mute notifications during them']),
      G(['work'], 'Professional', 'work', 'Build my professional network', 'Opportunities come through people.', ['List ten people to reconnect with', 'Send three coffee invitations', 'Attend one industry event']),
      G(['work', 'student'], 'Professional', 'work', 'Find a mentor', 'Someone further down the road saves me years.', ['List three people I admire', 'Ask one for a conversation', 'Agree on a regular check-in']),
      G(['work', 'business'], 'Professional', 'work', 'Set a work-life boundary', 'Rest is what makes the work sustainable.', ['Choose a hard stop time', 'Silence work notifications after hours', 'Plan something I look forward to after work']),
      G(['work', 'business'], 'Money steward', 'home', 'Grow my retirement savings', 'Future me will thank present me.', ['Check what my employer offers', 'Raise my contribution by one percent', 'Review my investments once a year']),
      G(['work', 'business'], 'Leader', 'work', 'Become a better leader for my team', 'People remember how I made them feel.', ['Ask for honest feedback', 'Start weekly one-on-ones', 'Recognize one person\'s work each week']),
      // business
      G(['business'], 'Business owner', 'work', 'Hit my revenue goal this year', 'A clear number keeps every week pointed the right way.', ['Write the number down', 'Review the numbers every Friday', 'Find the one thing that moves it most']),
      G(['business'], 'Business owner', 'work', 'Systemize one process in my business', 'Checklists give me my time back.', ['Pick the task that eats the most time', 'Write it as a checklist', 'Hand it off or automate it']),
      G(['business'], 'Business owner', 'work', 'Build a steady marketing rhythm', 'Consistency beats bursts of effort.', ['Choose one channel', 'Schedule weekly posts or outreach', 'Track what brings customers']),
      G(['business'], 'Business owner', 'work', 'Delegate or hire one role', 'I cannot be the bottleneck forever.', ['Write down what the role does', 'Post it or ask for referrals', 'Interview and decide']),
      G(['business'], 'Money steward', 'home', 'Set aside taxes and pay myself on schedule', 'Surprises are expensive and stressful.', ['Open a tax savings account', 'Move a percentage with every payment', 'Meet my accountant each quarter']),
      G(['business'], 'Business owner', 'fun', 'Take a real vacation from the business', 'Rest is part of building something that lasts.', ['Pick the dates', 'Write the hand-off notes', 'Go, and stay offline']),
      // caregiver
      G(['caregiver'], 'Caregiver', 'home', 'Build a care team so I am not alone', 'Sharing the load makes care sustainable.', ['List who could help and with what', 'Ask one person for one specific favor', 'Set up a shared care calendar']),
      G(['caregiver'], 'Caregiver', 'home', 'Organize medical information and appointments', 'Calm paperwork means calm visits.', ['Put medications and contacts in one folder', 'Put every appointment on the calendar', 'Keep a short log of changes']),
      G(['caregiver'], 'Caregiver', 'health', 'Protect my own health while I care', 'I can only pour from a full cup.', ['Book my own checkup', 'Schedule a weekly break', 'Say yes the next time someone offers help']),
      G(['caregiver'], 'Caregiver', 'health', 'Arrange regular respite care', 'Rest keeps me patient and well.', ['Research respite or day programs', 'Pick a recurring day', 'Use it without guilt']),
      G(['caregiver', 'retired'], 'Family', 'home', 'Get the legal and financial paperwork in order', 'Clear plans spare the family hard choices later.', ['Locate wills and powers of attorney', 'Meet with an elder-law or estate advisor', 'Store copies where family can find them']),
      G(['caregiver', 'retired', 'parent'], 'Family', 'friends', 'Capture family stories', 'These stories live only as long as someone writes them down.', ['Choose one question to ask each visit', 'Record or write the answers', 'Share them with the family']),
      // retired
      G(['retired'], 'Grandparent', 'friends', 'Be a regular presence for my grandchildren', 'These are the memories they will keep.', ['Pick a weekly call or visit', 'Plan one activity with each grandchild', 'Write each a letter'], { routine: { text: 'Call or video-chat a grandchild', perWeek: 2 } }),
      G(['retired'], 'Retiree', 'fun', 'Take the trip that has been on my list', 'I have the time now. I should use it.', ['Choose the place', 'Set a budget and dates', 'Book it']),
      G(['retired', 'faith', 'student'], 'Community member', 'friends', 'Volunteer for a cause I care about', 'Giving my time is how I belong.', ['List three causes I care about', 'Visit one organization', 'Commit to a regular shift']),
      G(['retired'], 'Retiree', 'home', 'Simplify and downsize', 'Fewer things means more freedom.', ['Walk through one room at a time', 'Decide keep, give, sell or toss', 'Hold the first donation drop-off']),
      G(['retired'], 'Healthy person', 'health', 'Stay strong, active and independent', 'Mobility and balance protect my freedom.', ['Book a checkup', 'Pick a gentle activity I enjoy', 'Add strength work twice a week']),
      G(['retired', 'creative'], 'Creator', 'projects', 'Write my life story', 'My family will treasure it.', ['Outline the chapters', 'Write one page a day for a week', 'Share a chapter with family']),
      G(['retired'], 'Money steward', 'home', 'Review my income plan and my legacy', 'Clarity lets me spend and give with confidence.', ['Gather statements in one place', 'Meet with an advisor', 'Update beneficiaries']),
      // health
      G(['health'], 'Healthy person', 'health', 'Run a 10K', 'Proving I can build a hard thing step by step.', ['Run 5K without stopping', 'Register for a 10K race', 'Run 8K', 'Finish the 10K']),
      G(['health'], 'Healthy person', 'health', 'Reach a healthy weight', 'Feeling good in my body changes how I show up.', ['Set a realistic target with my doctor', 'Plan meals for the week', 'Weigh in once a week']),
      G(['health'], 'Healthy person', 'health', 'Build real strength', 'Strength carries over into everything.', ['Pick a three-day plan', 'Learn the basic lifts', 'Log every session']),
      G(['health'], 'Healthy person', 'health', 'Sleep seven hours most nights', 'Sleep makes everything else easier.', ['Choose a bedtime', 'Move screens out of the bedroom', 'Track sleep for two weeks']),
      G(['health', 'parent', 'student'], 'Healthy person', 'home', 'Cook at home most nights', 'Home cooking is better for my body and my budget.', ['Pick five go-to recipes', 'Make a weekly meal plan', 'Stock the pantry']),
      // faith
      G(['faith'], 'Person of faith', 'projects', 'Read through my scripture this year', 'I want to know it, not just know about it.', ['Choose a reading plan', 'Pick a daily time', 'Finish the first book']),
      G(['faith'], 'Person of faith', 'health', 'Deepen my prayer life', 'It is how I stay rooted.', ['Choose a time and place', 'Keep a short prayer journal', 'Find a prayer partner']),
      G(['faith'], 'Person of faith', 'friends', 'Join or lead a small group', 'Faith grows best in community.', ['Find a group that fits my schedule', 'Attend the first meeting', 'Offer to host once']),
      G(['faith'], 'Person of faith', 'home', 'Set up a regular giving plan', 'Generosity loosens money\'s hold on me.', ['Decide on a giving percentage', 'Pick where it goes', 'Automate it']),
      // creative
      G(['creative'], 'Creator', 'projects', 'Finish a creative project', 'A finished piece teaches more than ten started ones.', ['Define what finished means', 'Break it into sessions', 'Share it with one person']),
      G(['creative'], 'Creator', 'projects', 'Write a book or series of essays', 'I have something to say.', ['Outline it', 'Write 500 words a day for a week', 'Edit the first chapter']),
      G(['creative'], 'Creator', 'projects', 'Learn an instrument', 'Music is a joy I can keep for life.', ['Pick the instrument and a teacher or course', 'Practice fifteen minutes a day', 'Play one full song']),
      G(['creative'], 'Creator', 'work', 'Share my work publicly', 'Work becomes real when someone sees it.', ['Choose where to share', 'Publish the first piece', 'Ask for feedback']),
      G(['creative'], 'Creator', 'projects', 'Make something every day for thirty days', 'Showing up beats waiting for inspiration.', ['Pick the medium', 'Set a daily time', 'Keep a simple log']),
    ],
    habits: [
      H([], 'Healthy person', 'health', 'Workout', 5, { purpose: true }),
      H([], 'Learner', 'projects', 'Read a book', 7),
      H([], 'Healthy person', 'health', 'Quiet time or prayer', 7),
      H([], 'Learner', 'projects', 'Journal', 5),
      H([], 'Healthy person', 'health', 'Walk or move outdoors', 5),
      H([], 'Healthy person', 'health', 'In bed on time', 7),
      H([], 'Healthy person', 'health', 'Drink enough water', 7),
      H([], 'Learner', 'projects', 'Write three things I am grateful for', 7),
      H([], 'Friend', 'friends', 'Call or text a friend or family member', 3),
      H([], 'Healthy person', 'health', 'Limit screens before bed', 7),
      H(['parent'], 'Parent', 'home', 'Read to the kids before bed', 7, { purpose: true }),
      H(['parent'], 'Parent', 'fun', 'Spend time outside with the kids', 7),
      H(['parent'], 'Parent', 'home', 'Eat dinner together', 5),
      H(['parent', 'partner', 'retired'], 'Household manager', 'home', 'Ten-minute tidy', 7),
      H(['partner'], 'Partner', 'friends', 'Date night with my spouse', 1),
      H(['partner'], 'Partner', 'friends', 'Walk and talk with my spouse', 3),
      H(['student'], 'Student', 'work', 'Study session', 5, { purpose: true }),
      H(['student'], 'Student', 'work', 'Review notes after class', 4),
      H(['student', 'work', 'business'], 'Professional', 'work', 'Plan tomorrow tonight', 5),
      H(['work', 'business', 'creative'], 'Professional', 'work', 'Deep work block', 5),
      H(['business'], 'Business owner', 'work', 'Reach out to a customer or lead', 5),
      H(['business'], 'Business owner', 'work', 'Review the numbers', 1),
      H(['caregiver'], 'Caregiver', 'friends', 'Check in on my loved one', 7, { purpose: true }),
      H(['caregiver'], 'Caregiver', 'health', 'Take a break just for me', 4),
      H(['retired'], 'Retiree', 'health', 'Morning walk', 7),
      H(['retired'], 'Grandparent', 'friends', 'Call a grandchild', 2),
      H(['retired', 'student'], 'Learner', 'projects', 'Language practice', 5),
      H(['health'], 'Healthy person', 'health', 'Strength training', 3, { purpose: true }),
      H(['health'], 'Healthy person', 'health', 'Stretch or mobility', 4),
      H(['health'], 'Healthy person', 'health', 'Prep meals for the week', 1),
      H(['faith'], 'Person of faith', 'health', 'Read scripture', 7, { purpose: true }),
      H(['faith'], 'Person of faith', 'friends', 'Worship or community gathering', 1),
      H(['creative'], 'Creator', 'projects', 'Make something', 5, { purpose: true }),
      H(['creative'], 'Creator', 'projects', 'Practice my instrument or craft', 5),
    ],
    ideal: [
      { text: 'Workout', time: '06:30', workout: true }, { text: 'Family night', time: '18:00' }, { text: 'Date night', time: '19:00' },
      { text: 'Activities', time: '16:00' }, { text: 'Community impact', time: '17:30' }, { text: 'Home & car maintenance', time: '17:30' },
      { text: 'Plan next week', time: '15:00' }, { text: 'Deep work', time: '09:00' },
    ],
    starterWeek: { 1: ['Workout', 'Home & car maintenance'], 2: ['Workout', 'Family night'], 3: ['Workout', 'Activities'], 4: ['Workout', 'Community impact'], 5: ['Workout', 'Plan next week'] },
  };

  const personas = () => (state.settings.personas || []).filter((id) => PERSONAS.some((p) => p.id === id));
  // 0 = not for you, 1 = suits anyone, 3+ = matches what you told us
  const relScore = (item) => {
    const ps = personas(), f = item.for || [];
    if (!ps.length || !f.length) return 1;
    const hit = f.filter((x) => ps.includes(x)).length;
    return hit ? 2 + hit : 0;
  };
  const rankedIdx = (list, skip) => list.map((item, i) => ({ item, i })).filter((x) => !(skip && skip(x.item)))
    .map((x) => ({ ...x, sc: relScore(x.item) })).sort((a, b) => b.sc - a.sc || a.i - b.i);
  const showMore = { roles: false, goals: false, habits: false };
  const showMoreBtn = (k, hidden) => (hidden > 0 ? `<button type="button" class="btn ghost small" data-act="showMore" data-k="${k}">Show ${hidden} more</button>` : '');
  /* Five life domains to keep in balance */
  const DOMAINS = P.LIFE.map((a) => ({ id: a.id, label: a.short }));
  const domainOf = (role, area, title) => P.lifeArea(area, role, title, false);
  const goalDomain = (g) => P.lifeArea(g.area, roleName(g.roleId), g.title, false);
  function balanceStrip(domainIds, note) {
    const n = (d) => domainIds.filter((x) => x === d).length;
    return `<div class="balance" aria-label="Balance across life areas">${DOMAINS.map((d) => `<span class="bal${n(d.id) ? ' on' : ''}"><b>${n(d.id)}</b> ${d.label}</span>`).join('')}${note ? `<small class="muted">${note}</small>` : ''}</div>`;
  }
  // one best item per life domain, strongest fit first
  function diversePick(list, pre, n) {
    const best = {};
    list.filter((x) => x.id[0] === pre).forEach((x) => { const d = domainOf(x.role, x.area, x.title), sc = relScore(x); if (!best[d] || sc > best[d].sc) best[d] = { id: x.id, sc }; });
    return Object.values(best).sort((a, b) => b.sc - a.sc).slice(0, n).map((x) => x.id);
  }
  const AREA_FIX = { 'Finish a hobby project I keep putting off': 'personal', 'Host friends or family for a gathering': 'personal', 'Make a new friend or join a community': 'personal', 'Take up a hobby together': 'personal', 'Call or text a friend or family member': 'personal', 'Protect my own health while I care': 'mental', 'Take the trip that has been on my list': 'personal' };
  [...SUGGEST.goals, ...SUGGEST.habits].forEach((x) => { x.area = AREA_FIX[x.title] || P.lifeArea(x.area, x.role, x.title, true); });
  function personaRoles() { const ps = personas(); return SUGGEST.roles.filter((r) => (r.for || []).some((x) => ps.includes(x))); }
  function personaPicker(title) {
    const on = personas();
    return `<section class="box"><h2>${title}</h2>
      <p class="prompt">Tap everything that fits. We will tailor your roles, goals and habits so you type less. Not sure? Skip it and see everything.</p>
      <div class="pick-grid">${PERSONAS.map((p) => `<button type="button" class="pick-card${on.includes(p.id) ? ' on' : ''}" data-act="togglePersona" data-id="${p.id}" aria-pressed="${on.includes(p.id)}"><strong>${esc(p.label)}</strong><small class="muted">${esc(p.sub)}</small></button>`).join('')}</div></section>`;
  }

  function ensureCycle() {
    let c = currentCycle();
    if (!c) {
      const t = today(), dates = U.makeCycleDates(U.toISO(new Date(t.getFullYear(), t.getMonth(), 1)), Number(state.settings.cycleMonths) || 6);
      c = { id: S.uid(), name: U.cycleName(dates.start, dates.end), ...dates, review: {}, roleActions: {} };
      state.cycles.push(c); S.save(state);
    }
    return c;
  }
  function setupStatus() {
    return [
      { step: 1, label: 'Purpose', done: !!(state.foundation.mission || '').trim() },
      { step: 2, label: 'Roles', done: state.roles.length > 0 },
      { step: 3, label: 'Annual goals', done: state.goals.some((g) => g.kind !== 'habit' && g.status === 'active') },
      { step: 4, label: 'Quarterly focus', done: focusGoals(todayISO()).length > 0 },
      { step: 5, label: 'Habits', done: state.goals.some((g) => g.kind === 'habit') },
      { step: 6, label: 'Ideal week', done: idealFor(quarterKey(todayISO())).length > 0 },
    ];
  }
  function roleIdFor(name, force) {
    let r = state.roles.find((x) => x.name.toLowerCase() === String(name || '').toLowerCase());
    if (!r && !force && state.roles.length) r = state.roles[0];
    if (!r) { const known = SUGGEST.roles.find((x) => x.name.toLowerCase() === String(name || '').toLowerCase()); r = { id: S.uid(), name: name || 'Me', why: known ? known.why : '' }; state.roles.push(r); }
    return r.id;
  }
  function addSuggestedGoal(sg, kind, force) {
    const cyc = ensureCycle();
    const have = state.goals.find((g) => g.title.toLowerCase() === sg.title.toLowerCase());
    if (have) return have;
    const g = { id: S.uid(), cycleId: cyc.id, roleId: roleIdFor(sg.role, force), title: sg.title, why: sg.why || '', area: sg.area || 'career', tier: sg.purpose ? 'purpose' : 'pursuit',
      progress: 0, status: 'active', target: cyc.end, doneBy: cyc.end, measure: '', kind, perWeek: sg.perWeek || 5, log: {},
      milestones: (sg.steps || []).map((text, i) => ({ id: S.uid(), text, due: U.toISO(U.addDays(today(), 21 * (i + 1))), done: false })), objectives: [],
      routines: sg.routine ? [{ id: S.uid(), text: sg.routine.text, perWeek: sg.routine.perWeek, log: {} }] : [] };
    state.goals.push(g);
    return g;
  }

  function applyIdealStarter() {
      Object.entries(SUGGEST.starterWeek).forEach(([dow, names]) => names.forEach((nm) => {
        if (idealFor(quarterKey(todayISO())).some((i) => Number(i.dow) === Number(dow) && i.text === nm)) return;
        const b = SUGGEST.ideal.find((x) => x.text === nm) || { text: nm };
        state.idealWeek.push({ id: S.uid(), quarter: quarterKey(todayISO()), dow: Number(dow), time: b.time || '', text: nm, goalId: '', workout: !!b.workout });
      }));

  }

  /* ---------- quick start: a one-minute setup ---------- */
  const quickFresh = () => ({ purpose: '', goals: [], habits: [], rhythm: true, custom: [], touched: false });
  let quick = quickFresh();
  const QUICK_PURPOSES = ['To love my family well and serve my community.', 'To grow in faith, health and purpose.', 'To build a calm, intentional life.', 'To leave things better than I found them.'];
  const quickGoalList = () => SUGGEST.goals.map((g, i) => ({ ...g, id: `g${i}` })).concat(quick.custom.map((t, i) => ({ id: `c${i}`, title: t, role: 'Me', area: 'career', why: '', steps: [] })));
  const quickHabitList = () => SUGGEST.habits.map((h, i) => ({ ...h, id: `h${i}` }));
  // What step 3 and 4 show: best matches first, a short list until "Show more"
  const quickShown = (list, pre, selected, k, limit) => {
    const ranked = list.filter((x) => x.id[0] === pre).map((x) => ({ item: x, sc: relScore(x) })).sort((a, b) => b.sc - a.sc);
    const keep = showMore[k] ? ranked : ranked.filter((x, n) => n < limit || selected.includes(x.item.id));
    return { items: keep.map((x) => x.item).concat(list.filter((x) => x.id[0] !== pre)), hidden: ranked.length - keep.length };
  };
  function quickPreselect(force) {
    if (quick.touched && !force) return;
    if (!force && !personas().length) { quick.goals = []; quick.habits = []; return; }
    quick.goals = quick.goals.filter((id) => id[0] === 'c').concat(diversePick(quickGoalList(), 'g', 5 - quick.goals.filter((id) => id[0] === 'c').length));
    quick.habits = diversePick(quickHabitList(), 'h', 5);
  }
  const purposeIdeas = () => personas().map((id) => PERSONAS.find((p) => p.id === id).purpose).concat(QUICK_PURPOSES).slice(0, 5);

  /* The first real Today for someone with an empty plan: three small steps instead of a blank page and a nag. */
  function firstDayCard() {
    const ranked = rankedIdx(SUGGEST.goals).slice(0, 6);
    const idea = personas().length ? PERSONAS.find((p) => p.id === personas()[0]).purpose : QUICK_PURPOSES[0];
    return `<section class="box first-day"><h2>Let's make your first day count</h2>
      <p class="muted">Three small steps, about two minutes. You can change everything later.</p>
      <ol class="fd-steps">
        <li><strong>Why are you here?</strong> <span class="muted">One sentence is plenty. You will see it in your daily review.</span>
          <textarea data-bind="foundation.mission" rows="2" placeholder="My purpose is to…">${esc(state.foundation.mission || '')}</textarea>
          ${state.foundation.mission ? '' : `<div class="chips"><button type="button" class="chip" data-act="fdPurpose" data-idx="0">Use: ${esc(idea)}</button></div>`}</li>
        <li><strong>Pick a goal to start with</strong> <span class="muted">Tap one. It becomes a goal with a first step on today's list.</span>
          <div class="chips">${ranked.map((x) => `<button type="button" class="chip" data-act="fdGoal" data-idx="${x.i}">+ ${esc(x.item.title)}</button>`).join('')}</div></li>
        <li><strong>Add one thing to do today</strong>${F.quickAdd ? F.quickAdd(todayISO(), 'e.g. Call the dentist friday !high') : ''}</li>
      </ol>
      <div class="row"><a class="btn primary" href="#/quick/1">Build my whole plan in a minute →</a><button type="button" class="btn ghost" data-act="fdDismiss">I'll explore on my own</button></div></section>`;
  }

  function viewStart() {
    return page('Set up your plan', 'Pick how much time you have. You can add detail any time.', `
      <div class="grid2">
        <a class="box start-card" href="#/quick/1"><h2>Quick start</h2><p class="muted">About 1 minute. Your why, goals across the main areas of life and a daily rhythm. Today fills itself in.</p><span class="btn primary">Start quick</span></a>
        <a class="box start-card" href="#/setup/1"><h2>Guided setup</h2><p class="muted">About 5 minutes. Roles and their WHY, annual goals, habits and an ideal week, step by step.</p><span class="btn ghost">Start guided</span></a>
      </div>
      <p><a href="#/today">I'll explore on my own</a></p>`);
  }

  function viewQuick(arg) {
    const n = Math.min(4, Math.max(1, Number(arg) || 1));
    const labels = ['About you', 'Your why', 'Focus goals', 'Daily rhythm'];
    const bar = `<ol class="setup-steps">${labels.map((l, i) => `<li class="${i + 1 === n ? 'cur' : ''}${i + 1 < n ? ' ok' : ''}"><a href="#/quick/${i + 1}"><b>${i + 1 < n ? '✓' : i + 1}</b><span>${l}</span></a></li>`).join('')}</ol>`;
    const card = (act, id, on, title, sub, tag) => `<button type="button" class="pick-card${on ? ' on' : ''}" data-act="${act}" data-id="${id}" aria-pressed="${on}"><strong>${esc(title)}</strong>${sub ? `<small class="muted">${esc(sub)}</small>` : ''}${tag ? `<span class="pick-tag">${esc(tag)}</span>` : ''}</button>`;
    const nav = `<div class="row setup-nav">${n > 1 ? `<a class="btn ghost" href="#/quick/${n - 1}">← Back</a>` : ''}<span class="grow"></span>${n < 4
      ? `<a class="btn ghost" href="#/quick/${n + 1}">Skip</a><a class="btn primary" href="#/quick/${n + 1}">Next →</a>`
      : '<button type="button" class="btn primary" data-act="quickBuild">Build my plan →</button>'}</div>`;
    let body = bar;
    if (n === 1) {
      body += personaPicker('Which of these sound like you?');
    } else if (n === 2) {
      body += `<section class="box"><h2>What matters most to you?</h2>
        <p class="prompt">A sentence is plenty. You will see it each morning in your daily review.</p>
        <textarea data-quick="purpose" rows="2" placeholder="My purpose is to…">${esc(quick.purpose)}</textarea>
        <div class="chips">${purposeIdeas().map((t, i) => `<button type="button" class="chip" data-act="quickPurpose" data-idx="${i}">${esc(t)}</button>`).join('')}</div></section>`;
    } else if (n === 3) {
      const sh = quickShown(quickGoalList(), 'g', quick.goals, 'goals', 12);
      body += `<section class="box"><h2>Pick up to 5 goals for this quarter <span class="muted">· ${quick.goals.length} of 5</span></h2>
        <p class="prompt">${personas().length ? 'Chosen to fit you. Untap any that are not right.' : 'Tap what you want to move forward.'} A balanced life has some career, personal, family, faith and fitness in it.</p>
        ${balanceStrip(quickGoalList().filter((g) => quick.goals.includes(g.id)).map((g) => domainOf(g.role, g.area, g.title)))}
        <p><button type="button" class="btn ghost small" data-act="quickBalance">Balance my picks</button></p>
        <div class="pick-grid">${sh.items.map((g) => card('quickGoal', g.id, quick.goals.includes(g.id), g.title, g.why, g.role)).join('')}</div>
        ${showMoreBtn('goals', sh.hidden)}
        <div class="add"><input id="quickCustom" placeholder="Or write your own goal…" aria-label="Your own goal"><button type="button" data-act="quickAddCustom" aria-label="Add">+</button></div></section>`;
    } else {
      const sh = quickShown(quickHabitList(), 'h', quick.habits, 'habits', 10);
      body += `<section class="box"><h2>Choose your daily rhythm <span class="muted">· ${quick.habits.length} habit${quick.habits.length === 1 ? '' : 's'}</span></h2>
        <p class="prompt">Habits appear on Today as a checkbox, with a picture of how you are doing.</p>
        ${balanceStrip(quickHabitList().filter((h) => quick.habits.includes(h.id)).map((h) => domainOf(h.role, h.area, h.title)))}
        <div class="pick-grid">${sh.items.map((h) => card('quickHabit', h.id, quick.habits.includes(h.id), h.title, h.perWeek === 7 ? 'every day' : h.perWeek === 1 ? 'once a week' : `${h.perWeek}× a week`, '')).join('')}</div>
        ${showMoreBtn('habits', sh.hidden)}
        <h3>A starter week</h3>
        ${card('quickRhythm', 'rhythm', quick.rhythm, 'Give my week a starter rhythm', 'Workouts Monday to Friday, plus a theme for each weekday. It shows on your calendar and you can change it later.', '')}</section>`;
    }
    return page('Quick start', `Step ${n} of 4 · about a minute. Skip anything.`, body + nav);
  }
  document.addEventListener('input', (e) => { if (e.target.dataset && e.target.dataset.quick === 'purpose') quick.purpose = e.target.value; });

  function viewSetup(step) {
    const n = Math.min(6, Math.max(1, Number(step) || 1));
    const cyc = n >= 3 && n <= 5 ? ensureCycle() : currentCycle();
    const st = setupStatus();
    const bar = `<ol class="setup-steps">${st.map((x) => `<li class="${x.step === n ? 'cur' : ''}${x.done ? ' ok' : ''}"><a href="#/setup/${x.step}"><b>${x.done ? '✓' : x.step}</b><span>${x.label}</span></a></li>`).join('')}</ol>`;
    const nav = `<div class="row setup-nav">${n > 1 ? `<a class="btn ghost" href="#/setup/${n - 1}">← Back</a>` : ''}<span class="grow"></span>${n < 6
      ? `<a class="btn ghost" href="#/setup/${n + 1}">Skip</a><a class="btn primary" href="#/setup/${n + 1}">Next →</a>`
      : '<button class="btn primary" data-act="finishSetup">Finish &amp; go to Today</button>'}</div>`;
    const chip = (act, i, label) => `<button type="button" class="chip" data-act="${act}" data-idx="${i}">+ ${esc(label)}</button>`;
    const chipList = (k, list, skip, label, act, limit) => {
      const r = rankedIdx(list, skip), vis = showMore[k] ? r : r.filter((x, n) => n < limit);
      return `<div class="chips">${vis.map((x) => chip(act, x.i, label(x.item))).join('')}</div>${showMoreBtn(k, r.length - vis.length)}`;
    };
    const roleOpts = (cur) => opts(state.roles.map((r) => ({ v: r.id, l: r.name })).concat(state.roles.length ? [] : [{ v: '', l: '(no role yet)' }]), cur);
    let body = bar;

    if (n === 1) {
      body += `<p class="muted small">In a hurry? <a href="#/quick/1">Quick start</a> does the essentials in about a minute.</p>
      ${personaPicker('First, which of these sound like you?')}
      <section class="box"><h2>Your purpose</h2>
        <p class="prompt">In a sentence or two: why are you here, and how do you want to spend your life? You will read this in your daily review.</p>
        ${ta('foundation.mission', 'My purpose is to…', 4)}
        <h3>Who I'm becoming <small class="muted">optional · 5–10 years from now</small></h3>
        ${ta('foundation.vision', 'I am…', 4)}</section>`;
    } else if (n === 2) {
      const have = new Set(state.roles.map((r) => r.name.toLowerCase()));
      body += `<section class="box"><h2>Your roles</h2>
        <p class="prompt">Roles are the hats you wear. For each one, write your <strong>WHY</strong>: the underlying reasons it matters.</p>
        ${state.roles.map((r) => `<div class="role-edit"><div class="row"><input class="inline role-name grow" data-bind="roles.@${r.id}.name" value="${esc(r.name)}" aria-label="Role name"><button class="x" data-act="delRole" data-id="${r.id}" aria-label="Delete role">×</button></div>
          ${ta(`roles.@${r.id}.why`, 'Why does this role matter to you?', 2)}</div>`).join('')}
        ${personaRoles().some((r) => !have.has(r.name.toLowerCase())) ? `<p><button type="button" class="btn primary" data-act="addPersonaRoles">Add the roles that fit me: ${esc(personaRoles().filter((r) => !have.has(r.name.toLowerCase())).map((r) => r.name).join(', '))}</button></p>` : ''}
        ${chipList('roles', SUGGEST.roles, (r) => have.has(r.name.toLowerCase()), (r) => r.name, 'addSuggestedRole', 8)}
        <form class="add" data-add="roles"><input name="name" placeholder="Add your own role" required><button aria-label="Add role">+</button></form>
        <p class="muted small">Have a planner page? <button type="button" class="btn ghost" data-act="uploadPhoto">Import from a photo</button></p></section>`;
    } else if (n === 3) {
      const gl = state.goals.filter((g) => g.cycleId === cyc.id && g.kind !== 'habit' && g.status === 'active');
      const have = new Set(state.goals.map((g) => g.title.toLowerCase()));
      body += `<section class="box"><h2>Your annual goals <span class="muted">· ${gl.length} so far · aim for about 10</span></h2>
        <p class="prompt">Big things you want to accomplish. Habits come in step 5, so keep this list to goals you can finish.</p>
        <ul class="checks compact">${gl.map((g) => `<li><input class="inline grow" data-bind="goals.@${g.id}.title" value="${esc(g.title)}" aria-label="Goal"><small class="muted">${esc(roleName(g.roleId))}</small>
          <button class="x" data-act="del" data-path="goals" data-id="${g.id}" aria-label="Remove">×</button></li>`).join('')}</ul>
        <h3>Suggestions <small class="muted">tap to add</small></h3>
        ${chipList('goals', SUGGEST.goals, (g) => have.has(g.title.toLowerCase()), (g) => g.title, 'addSuggestedGoal', 12)}
        <form class="add" data-add="goals"><input type="hidden" name="cycleId" value="${cyc.id}"><input type="hidden" name="kind" value="achievement">
          <input name="title" placeholder="Add your own goal…" required><select name="roleId" aria-label="Role">${roleOpts('')}</select><select name="area" aria-label="Area">${lifeOpts('career')}</select><button aria-label="Add goal">+</button></form></section>`;
    } else if (n === 4) {
      const gl = state.goals.filter((g) => g.cycleId === cyc.id && g.kind !== 'habit' && g.status === 'active');
      const sel = focusGoals(todayISO());
      body += `<section class="box"><h2>This quarter's focus <span class="muted">· ${quarterLabel(todayISO())} · ${sel.length}/4</span></h2>
        <p class="prompt">You cannot give ten goals your best energy at once. Choose the <strong>3 or 4</strong> that matter most right now. Their next steps will be pre-filled on Today each morning.</p>
        <div class="chips">${gl.map((g) => { const on = sel.some((f) => f.id === g.id); return `<button type="button" class="chip${on ? ' on' : ''}" data-act="toggleFocus" data-goal="${g.id}" aria-pressed="${on}">${on ? '⚑ ' : ''}${esc(g.title)}</button>`; }).join('') || '<p class="muted">Add some goals in step 3 first.</p>'}</div></section>`;
    } else if (n === 5) {
      const hl = state.goals.filter((g) => g.cycleId === cyc.id && g.kind === 'habit' && g.status === 'active');
      const have = new Set(state.goals.map((g) => g.title.toLowerCase()));
      body += `<section class="box"><h2>Your habits <span class="muted">· ${hl.length}</span></h2>
        <p class="prompt">Things you want to do on a regular rhythm. Each appears on Today as a checkbox, with a visual of how you are doing.</p>
        <ul class="checks compact">${hl.map((g) => `<li><input class="inline grow" data-bind="goals.@${g.id}.title" value="${esc(g.title)}" aria-label="Habit">
          <select data-bind="goals.@${g.id}.perWeek" data-type="number" data-rerender aria-label="Days per week">${opts([1, 2, 3, 4, 5, 6, 7].map((d) => ({ v: d, l: d === 7 ? 'Every day' : d === 1 ? 'Once a week' : `${d}× a week` })), g.perWeek || 5)}</select>
          <button class="x" data-act="del" data-path="goals" data-id="${g.id}" aria-label="Remove">×</button></li>`).join('')}</ul>
        <h3>Suggestions <small class="muted">tap to add</small></h3>
        ${chipList('habits', SUGGEST.habits, (h) => have.has(h.title.toLowerCase()), (h) => `${h.title} (${h.perWeek === 7 ? 'daily' : h.perWeek + '×/wk'})`, 'addSuggestedHabit', 10)}
        <form class="add" data-add="goals"><input type="hidden" name="cycleId" value="${cyc.id}"><input type="hidden" name="kind" value="habit"><input type="hidden" name="area" value="fitness"><input type="hidden" name="roleId" value="${state.roles[0] ? state.roles[0].id : ''}">
          <input name="title" placeholder="Add your own habit…" required><select name="perWeek" aria-label="Days per week">${opts([1, 2, 3, 4, 5, 6, 7].map((d) => ({ v: d, l: d === 7 ? 'Every day' : `${d}× a week` })), 5)}</select><button aria-label="Add habit">+</button></form></section>`;
    } else {
      const order = [0, 1, 2, 3, 4, 5, 6].map((i) => (i + ws()) % 7);
      body += `<section class="box"><h2>Your ideal week</h2>
        <p class="prompt">Give each day a purpose for this quarter (${qLabel(quarterKey(todayISO()))}). These blocks appear on that day in Today and Week, ready to check off. You will revisit it each quarter.</p>
        <p><button type="button" class="btn" data-act="idealStarter">Fill in a starter week</button> <span class="muted small">workout Mon–Fri, plus a theme each weekday. Edit anything afterwards.</span></p></section>
        <div class="ideal-grid">${order.map((d) => {
          const items = idealFor(quarterKey(todayISO())).filter((i) => Number(i.dow) === d).sort((a, b) => ((a.time || '99') < (b.time || '99') ? -1 : 1));
          const have = new Set(items.map((i) => i.text.toLowerCase()));
          return `<section class="box ideal-day"><h3>${U.DAYS[d]}</h3>
            <ul class="checks compact">${items.map((i) => `<li><span class="grow">${i.time ? `<time>${esc(fmtTime(i.time))}</time> ` : ''}${esc(i.text)}</span><button class="x" data-act="del" data-path="idealWeek" data-id="${i.id}" aria-label="Remove">×</button></li>`).join('')}</ul>
            <div class="chips">${SUGGEST.ideal.map((b, i) => (have.has(b.text.toLowerCase()) ? '' : `<button type="button" class="chip" data-act="addIdealBlock" data-dow="${d}" data-idx="${i}">+ ${esc(b.text)}</button>`)).join('')}</div>
            <form class="add" data-add="idealWeek"><input type="hidden" name="dow" value="${d}"><input type="hidden" name="quarter" value="${quarterKey(todayISO())}"><input name="text" placeholder="Your own block…" required><button aria-label="Add">+</button></form></section>`;
        }).join('')}</div>`;
    }
    return page('Set up Life.OS', `Step ${n} of 6 · about 5 minutes. Skip anything and come back later.`, body + nav);
  }

  /* ---------- guided planning sessions (yearly, quarterly, monthly, weekly, daily) ---------- */
  function sessionCtx() {
    const t = today(), iso = U.toISO(t);
    const py = U.plannerYearStart(t, Number(state.settings.plannerStartMonth));
    return { t, iso, wk: U.weekKey(t, ws()), mk: U.monthKey(t), qk: quarterKey(iso), py };
  }
  const SESSIONS = {
    yearly: {
      title: 'Yearly planning', when: 'Once a year, at the start of your planner year',
      period: (c) => ({ key: `yearly:${c.py.year}`, label: c.py.month === 0 ? `${c.py.year}` : `${U.MONTHS[c.py.month].slice(0, 3)} ${c.py.year} – ${U.MONTHS[c.py.month - 1].slice(0, 3)} ${c.py.year + 1}` }),
      due: (c) => U.daysBetween(new Date(c.py.year, c.py.month, 1), c.t) <= 21,
      steps: (c) => [
        { id: 'plan', label: 'Revisit your life plan', hint: 'Re-read your purpose, vision and roles. Does it still ring true?', href: '#/foundation' },
        { id: 'wheel', label: 'Evaluate your full Wheel of Life', hint: 'Score all seven areas and note the lowest.', href: '#/wheel', auto: state.wheel.some((w) => U.daysBetween(U.parseISO(w.date), c.t) <= 45) },
        { id: 'goals', label: 'Set your goals for the year', hint: 'About ten across your roles. Habits are tracked separately.', href: '#/goals' },
        { id: 'focus', label: 'Set your quarterly goals', hint: 'Choose the 3–4 goals that get your best energy this quarter.', href: '#/goals', auto: focusGoals(c.iso).length > 0 },
        { id: 'next', label: 'Define key next steps', hint: 'Give each focus goal milestones and objectives.', href: '#/goals', auto: focusGoals(c.iso).length > 0 && focusGoals(c.iso).every((g) => (g.milestones || []).length || (g.objectives || []).length) },
        { id: 'events', label: 'Document key events and plans for the year', hint: 'Trips, birthdays, conferences, milestones.', href: '#/year' },
      ],
    },
    quarterly: {
      title: 'Quarterly planning', when: 'At the start of each quarter',
      period: (c) => ({ key: `quarterly:${c.qk}`, label: qLabel(c.qk) }),
      due: (c) => U.daysBetween(U.parseISO(qStart(c.qk)), c.t) <= 14,
      steps: (c) => [
        { id: 'review', label: 'Review your yearly goals and update timelines', hint: 'Celebrate wins. Adjust target dates and progress.', href: '#/goals' },
        { id: 'focus', label: 'Set this quarter\'s focus', hint: 'Pick 3–4 goals to move forward.', href: '#/goals', auto: focusGoals(c.iso).length > 0 },
        { id: 'actions', label: 'Set monthly and weekly goals for each role', hint: 'Write the actions under each role on Roles & Goals.', href: '#/goals' },
        { id: 'vacation', label: 'Plan family vacations', hint: 'Add each trip as a "Family vacation" key date.', href: '#/year', auto: state.events.some((e) => e.kind === 'vacation' && (e.end || e.start) >= c.iso) },
        { id: 'relax', label: 'Schedule relaxation days', hint: 'Block rest days on purpose. Add them as "Relaxation day".', href: '#/year', auto: state.events.some((e) => e.kind === 'relax' && (e.end || e.start) >= c.iso) },
        { id: 'ideal', label: 'Set your ideal week for the quarter', hint: 'Give each weekday a purpose.', href: '#/ideal', auto: idealFor(c.qk).length > 0 && !state.idealCarried[c.qk] },
        { id: 'calendar', label: 'Fill in the next three months with key events', hint: 'Open each month and pencil in known events.', links: [0, 1, 2].map((i) => { const m = U.monthKey(new Date(c.t.getFullYear(), c.t.getMonth() + i, 1)); return { label: U.MONTHS[Number(m.slice(5)) - 1], href: `#/month/${m}` }; }) },
      ],
    },
    monthly: {
      title: 'Monthly planning', when: 'At the start of each month',
      period: (c) => ({ key: `monthly:${c.mk}`, label: `${U.MONTHS[c.t.getMonth()]} ${c.t.getFullYear()}` }),
      due: (c) => c.t.getDate() <= 7,
      steps: (c) => { const m = state.months[c.mk] || {}; return [
        { id: 'events', label: 'Plan known events', hint: 'Appointments, trips, birthdays, commitments.', href: `#/month/${c.mk}` },
        { id: 'goals', label: 'Review your goals', hint: 'Are the focus goals moving?', href: '#/goals' },
        { id: 'actions', label: 'Set monthly and weekly goals and actions', hint: 'Priority actions in each area, linked to goals.', href: `#/month/${c.mk}`, auto: (m.actions || []).length > 0 },
        { id: 'days', label: 'Document days for events and activities', hint: 'Note which days the key things happen.', href: `#/month/${c.mk}` },
        { id: 'reflect', label: 'Write lessons learned, gratitude and memories', hint: 'Capture last month\'s lessons and what you are grateful for.', href: `#/month/${c.mk}`, auto: !!(m.grateful || (m.reflection && (m.reflection.improve || m.reflection.memories))) },
      ]; },
    },
    weekly: {
      title: 'Weekly planning', when: 'Plan on the first day of the week; review in the last days',
      period: (c) => ({ key: `weekly:${c.wk}`, label: `Week of ${U.fmtDate(c.wk, { month: 'short', day: 'numeric' })}` }),
      due: (c) => { const d = U.daysBetween(U.parseISO(c.wk), c.t); return d === 0 || d >= 5; },
      steps: (c) => { const w = state.weeks[c.wk] || {}; const end = U.toISO(U.addDays(U.parseISO(c.wk), 6)); return [
        { id: 'grid', label: 'Plan the full week by the half hour', hint: 'Calls, meetings, appointments, workouts, family time.', href: `#/week/${c.wk}`, auto: state.schedule.filter((x) => x.time && x.date >= c.wk && x.date <= end).length >= 3 },
        { id: 'top3', label: 'Pick your top 3 for the week', hint: 'The three things that would make the week a win.', href: `#/week/${c.wk}`, auto: (w.top3 || []).length > 0 },
        { id: 'actions', label: 'Set weekly actions toward your goals', hint: 'Link each to a goal.', href: `#/week/${c.wk}`, auto: (w.actions || []).length > 0 },
        { id: 'assign', label: 'Assign tasks to days', hint: 'Use "Plan a day" on the Week page.', href: `#/week/${c.wk}`, auto: assignedTasks().some((t) => t.day >= c.wk && t.day <= end) },
        { id: 'pull', label: 'Pull in items from your bucket list and to-dos', hint: 'Use the "Pull in" box on the Week page.', href: `#/week/${c.wk}` },
        { id: 'buy', label: 'Document items to buy', hint: 'Add to your shopping list.', href: '#/lists/shopping' },
        { id: 'progress', label: 'Track progress toward your goals', hint: 'Check the goal pulse and tick milestones.', href: `#/week/${c.wk}`, auto: Object.keys(w.pulse || {}).length > 0 },
      ]; },
    },
    daily: {
      title: 'Daily planning', when: 'Every day',
      period: (c) => ({ key: `daily:${c.iso}`, label: U.fmtDate(c.iso, { weekday: 'long', month: 'short', day: 'numeric' }) }),
      due: () => false,
      steps: (c) => [
        { id: 'review', label: 'Review your purpose, goals and ideal week', hint: 'The three checks in your daily review.', href: '#/today', auto: reviewDone(c.iso) },
        { id: 'big3', label: 'Pick your top 3 for the day', hint: 'Pre-filled from your focus goals. Adjust as needed.', href: '#/today', auto: state.big3.some((b) => b.date === c.iso) },
        { id: 'habits', label: 'Work on your habits', hint: 'Tick them off as you go.', href: '#/today', auto: trackers().some((k) => k.log[c.iso]) },
        { id: 'todos', label: 'Track your to-dos and notes', hint: 'Process your inbox.', href: '#/lists/inbox' },
        { id: 'capture', label: 'Save future tasks and goals as you think of them', hint: 'Use the capture bar on Today.', href: '#/today', auto: state.inbox.some((x) => x.date === c.iso) || state.tasks.some((x) => x.created === c.iso) },
        { id: 'memories', label: 'Document key memories, events and family quotes', hint: 'Capture them before they fade.', href: '#/lists/memories', auto: state.memories.some((m) => m.date === c.iso) },
      ],
    },
  };
  function sessionStatus(cad, c) {
    const def = SESSIONS[cad], per = def.period(c), steps = def.steps(c), rec = state.sessions[per.key] || {};
    steps.forEach((st) => { st.done = st.auto === true || !!(rec.steps && rec.steps[st.id]); });
    const doneN = steps.filter((x) => x.done).length;
    return { cad, def, per, steps, doneN, complete: !!rec.done || doneN === steps.length, due: def.due(c) };
  }
  const SESSION_ORDER = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

  function viewSession(arg) {
    const c = sessionCtx();
    if (!SESSIONS[arg]) {
      const cards = SESSION_ORDER.slice().reverse().map((cad) => {
        const st = sessionStatus(cad, c);
        const last = Object.entries(state.sessions).filter(([k, v]) => k.startsWith(cad + ':') && v.done).map(([, v]) => v.done).sort().pop();
        return `<section class="box session-card${st.complete ? ' done' : ''}">
          <h2>${st.def.title} ${st.due && !st.complete ? '<span class="pulse slip">due</span>' : ''}</h2>
          <p class="muted">${esc(st.def.when)} · <strong>${esc(st.per.label)}</strong></p>
          <p>${progressBar((st.doneN / st.steps.length) * 100)} <small>${st.doneN}/${st.steps.length}${st.complete ? ' · complete ✓' : ''}</small></p>
          ${last ? `<p class="muted small">Last completed ${U.fmtDate(last, { month: 'short', day: 'numeric', year: 'numeric' })}</p>` : ''}
          <a class="btn ${st.complete ? 'ghost' : 'primary'}" href="#/session/${cad}">${st.complete ? 'Review' : st.doneN ? 'Continue' : 'Start'} →</a></section>`;
      }).join('');
      return page('Planning sessions', 'A rhythm of review and planning: yearly, quarterly, monthly, weekly and daily', `<div class="grid2">${cards}</div>`);
    }
    const st = sessionStatus(arg, c), recKey = st.per.key;
    if (st.doneN === st.steps.length && !(state.sessions[recKey] && state.sessions[recKey].done)) {
      state.sessions[recKey] = Object.assign(state.sessions[recKey] || { steps: {} }, { done: c.iso }); S.save(state);
    }
    const body = `
      <p class="lead">${esc(st.def.when)}. Work through each step. Steps tick themselves when Life.OS can see you did them; tick the rest yourself.</p>
      <section class="box"><h2>${esc(st.per.label)} <span class="muted">· ${st.doneN}/${st.steps.length}</span></h2>
        <p>${progressBar((st.doneN / st.steps.length) * 100)}</p>
        <ol class="session-steps">${st.steps.map((x) => `<li class="${x.done ? 'done' : ''}">
          ${x.auto === true ? '<input type="checkbox" checked disabled aria-label="Done automatically">' : chk(`sessions.${recKey}.steps.${x.id}`, x.label)}
          <div class="grow"><strong>${esc(x.label)}</strong>${x.auto === true ? ' <small class="muted">done</small>' : ''}<br><small class="muted">${esc(x.hint || '')}</small>
            ${x.links ? `<div class="chips">${x.links.map((l) => `<a class="chip" href="${l.href}">${esc(l.label)} →</a>`).join('')}</div>` : ''}</div>
          ${x.href ? `<a class="btn ghost small" href="${x.href}">Open →</a>` : ''}</li>`).join('')}</ol>
        <div class="row end"><a class="btn ghost" href="#/session">All sessions</a>
          ${st.complete ? `<span class="muted">Session complete ✓</span>` : `<button class="btn primary" data-act="completeSession" data-key="${recKey}">Mark session complete</button>`}</div>
      </section>`;
    return page(st.def.title, st.per.label, body);
  }


  /* ---------- landing page for people who have not signed up ---------- */
  function viewLandingV1() {  // the first landing page, kept so it can be restored: point ROUTES.landing at this
    const cta = (primaryLabel) => `<div class="land-cta">
      <button type="button" class="btn primary big" data-act="signIn">${primaryLabel || 'Continue with Google'}</button>
      <a class="btn big" href="#/welcome/1">See how it works</a>
      <button type="button" class="linklike muted" data-act="landingSkip">or start without an account</button></div>`;
    const areas = P.LIFE.map((a) => `<span class="land-chip">${esc(a.short)}</span>`).join('');
    const feat = (ico, h, t) => `<div class="land-feat"><span class="ico" aria-hidden="true">${ico}</span><h3>${h}</h3><p>${t}</p></div>`;
    return `<div class="landing">
      <section class="land-hero">
        <div class="land-copy">
          <p class="land-kicker">Life.OS · purpose-based planning</p>
          <h1>Build a life that matters, <em>not just a longer to-do list.</em></h1>
          <p class="land-sub">Most planners help you do more. Life.OS starts with what you want your life to stand for, then turns it into goals, habits and a calendar you can actually follow, so the things you do add up to the life you want.</p>
          ${cta()}
          <p class="land-note">No account needed. Your plan stays on your device, or in your own Google Drive if you sign in.</p>
        </div>
        <div class="land-preview" aria-hidden="true">
          <div class="lp-card">
            <div class="lp-purpose"><small>MY PURPOSE</small>To love my family well, stay healthy and serve my community.</div>
            <div class="lp-row"><b>Today's Big 3</b></div>
            <div class="lp-item"><i class="on"></i>Call Dad <span class="lp-tag t1">Family</span></div>
            <div class="lp-item"><i></i>Finish quarterly report <span class="lp-tag t2">Career</span></div>
            <div class="lp-item"><i></i>5K run <span class="lp-tag t3">Fitness</span></div>
            <div class="lp-row"><b>Tasks</b></div>
            <div class="lp-item"><i></i>Pay rent <span class="lp-tag">↻ monthly</span></div>
            <div class="lp-item"><i></i>Book dentist <span class="lp-tag">Fri</span></div>
          </div>
        </div>
      </section>

      <section class="land-contrast">
        <h2>Doing more is not the same as living well</h2>
        <div class="land-two">
          <div class="land-col muted-col"><h3>A busy life</h3><ul><li>A task list that never ends</li><li>Urgent things crowd out important things</li><li>Another year of "someday"</li><li>Productive, but not sure it mattered</li></ul></div>
          <div class="land-col good-col"><h3>A life that matters</h3><ul><li>Your purpose and values come first</li><li>Goals that grow from your roles and relationships</li><li>A few focus goals, not fifty</li><li>Time on the calendar for what counts</li></ul></div>
        </div>
      </section>

      <section class="land-steps">
        <h2>From purpose to Tuesday afternoon</h2>
        <ol class="land-flow">
          <li><b>1</b><h3>Know your why</h3><p>Write your purpose, vision and legacy. They return in your daily review so you never drift.</p></li>
          <li><b>2</b><h3>Set goals that matter</h3><p>Choose goals for each of your roles, across the areas of life that deserve attention.</p></li>
          <li><b>3</b><h3>Plan your week</h3><p>Pick 3 or 4 focus goals, a Big 3 for each day and tasks for the days they belong.</p></li>
          <li><b>4</b><h3>Live it daily</h3><p>See your day by the 15 minutes, check off habits, and look back on what you finished.</p></li>
        </ol>
      </section>

      <section class="land-balance">
        <h2>A balanced life, in plain sight</h2>
        <p>Goals, habits and the Wheel of Life share the same ten areas, so you can see what is getting your time and what is being neglected.</p>
        <div class="land-chips">${areas}</div>
      </section>

      <section class="land-tools">
        <h2>And the planning tools to do it well</h2>
        <p class="land-lead">Purpose gives the direction. Life.OS also gives you the everyday machinery to get there.</p>
        <div class="land-feats">
          ${feat('✓', 'Tasks that fit your life', 'Due dates, priorities, projects, tags, subtasks, Waiting and Someday lists. Add them in plain words, like “pay rent monthly on the 1st”.')}
          ${feat('↻', 'Repeating tasks and habits', 'Chores, bills and routines repeat on their own. Habits show streaks instead of piling up as overdue.')}
          ${feat('▦', 'A real daily calendar', 'An hour-by-hour day down to 15 minutes. Drag tasks onto it, and see your Google Calendars beside them.')}
          ${feat('☰', 'Weekly and daily planning', 'Guided sessions for the year, quarter, month, week and day, plus a Big 3 and a one-tap “move undone to tomorrow”.')}
          ${feat('★', 'Review and reflect', '“What I finished” summaries by week, month, quarter or year you can copy, download or print.')}
          ${feat('⌘', 'Fast and forgiving', 'Search everything with one key, undo and restore deleted items, work offline, and print a clean page for your paper planner.')}
        </div>
      </section>

      <section class="land-final">
        <h2>Start with what matters. Plan the rest around it.</h2>
        <p>Your first sign-in creates your account. There is nothing else to fill in. Or take the two-minute demo first.</p>
        ${cta('Get started with Google')}
        <p class="land-quote">“The key is not to prioritize what's on your schedule, but to schedule your priorities.” <span>Stephen Covey</span></p>
      </section>
    </div>`;
  }

  function viewLanding() {
    const cta = (primaryLabel) => `<div class="land-cta">
      <button type="button" class="btn primary big" data-act="signIn">${primaryLabel || 'Continue with Google'}</button>
      <a class="btn big" href="#/welcome/1">See how it works</a>
      ${isBlank() ? '<button type="button" class="linklike muted" data-act="landingSkip">or start without an account</button>' : '<a class="linklike muted" href="#/today">or go back to my plan</a>'}</div>`;
    const chipsOf = (ids) => ids.map((id) => `<span class="land-chip">${esc(P.LIFE.find((a) => a.id === id).short)}</span>`).join('');
    const feat = (ico, h, t) => `<div class="land-feat"><span class="ico" aria-hidden="true">${ico}</span><h3>${h}</h3><p>${t}</p></div>`;
    return `<div class="landing">
      <section class="land-hero">
        <div class="land-copy">
          <p class="land-kicker">Life.OS · purpose-based planning</p>
          <h1>Build a life that matters, <em>not just a longer to-do list.</em></h1>
          <p class="land-sub">Life.OS starts with what you want your life to stand for: the work you are called to, the people you love, the faith, health and community that sustain you. Then it turns that into goals, habits and a calendar you can actually follow, so the things you do add up to the life you want.</p>
          ${cta()}
          <p class="land-note">No account needed. Your plan stays on your device, or in your own Google Drive if you sign in.</p>
        </div>
        <div class="land-preview" aria-hidden="true">
          <div class="lp-card">
            <div class="lp-purpose"><small>MY PURPOSE</small>To do work I am proud of, so I can love my family well and serve my community.</div>
            <div class="lp-row"><b>Today's Big 3</b></div>
            <div class="lp-item"><i class="on"></i>Draft the proposal <span class="lp-tag t2">Career</span></div>
            <div class="lp-item"><i></i>Call Dad <span class="lp-tag t1">Family</span></div>
            <div class="lp-item"><i></i>5K run <span class="lp-tag t3">Fitness</span></div>
            <div class="lp-row"><b>Tasks</b></div>
            <div class="lp-item"><i></i>Send invoice <span class="lp-tag">+Business</span></div>
            <div class="lp-item"><i></i>Pay rent <span class="lp-tag">↻ monthly</span></div>
          </div>
        </div>
      </section>

      <section class="land-work">
        <h2>Your work is part of the point</h2>
        <p class="land-lead">The career you choose and the passions you pursue shape almost everything else: the time you have, the money you can give and keep, the energy you bring home, and the person you become. Meaning does not live only outside of work. Life.OS plans for both.</p>
        <div class="land-three">
          <div class="land-card"><span class="ico" aria-hidden="true">⚒</span><h3>Work that makes room</h3><p>A good career is how you provide, grow your skills and earn the freedom to say yes to what matters most: family, faith, community, generosity.</p></div>
          <div class="land-card"><span class="ico" aria-hidden="true">✦</span><h3>Passion that gives it meaning</h3><p>The craft you love, the problem you care about, the business you are building. When your work and your values line up, effort stops feeling like a grind.</p></div>
          <div class="land-card"><span class="ico" aria-hidden="true">⚖</span><h3>Boundaries that protect the rest</h3><p>Ambition that eats your evenings is not success. Put deep work, rest, family time and workouts on the same calendar, so work serves your life instead of replacing it.</p></div>
        </div>
        <ol class="land-loop" aria-label="How the areas of life feed each other"><li>Purpose</li><li>Work &amp; passion</li><li>Income, skills &amp; energy</li><li>Family, faith, health &amp; community</li><li>Purpose</li></ol>
      </section>

      <section class="land-contrast">
        <h2>Doing more is not the same as living well</h2>
        <div class="land-two">
          <div class="land-col muted-col"><h3>A busy life</h3><ul><li>A task list that never ends</li><li>Urgent things crowd out important things</li><li>Work for its own sake, or work you drifted into</li><li>Productive, but not sure it mattered</li></ul></div>
          <div class="land-col good-col"><h3>A life that matters</h3><ul><li>Your purpose and values come first</li><li>Career and passions chosen on purpose</li><li>A few focus goals, not fifty</li><li>Time on the calendar for what counts</li></ul></div>
        </div>
      </section>

      <section class="land-steps">
        <h2>From purpose to Tuesday afternoon</h2>
        <ol class="land-flow">
          <li><b>1</b><h3>Know your why</h3><p>Write your purpose, vision and legacy. They return in your daily review so you never drift.</p></li>
          <li><b>2</b><h3>Set goals that matter</h3><p>Choose goals for your career and passions as well as for home, health and faith, one set for each of your roles.</p></li>
          <li><b>3</b><h3>Plan your week</h3><p>Pick 3 or 4 focus goals, a Big 3 for each day and tasks for the days they belong.</p></li>
          <li><b>4</b><h3>Live it daily</h3><p>See your day by the 15 minutes, check off habits, and look back on what you finished.</p></li>
        </ol>
      </section>

      <section class="land-balance">
        <h2>A balanced life, in plain sight</h2>
        <p>Goals, habits and the Wheel of Life share the same ten areas, so you can see what is getting your time and what is being neglected. Work and money are the foundation. The rest is what they make possible.</p>
        <div class="land-groups">
          <div><h3>Work &amp; means</h3><div class="land-chips">${chipsOf(['career', 'finances', 'learning'])}</div></div>
          <div><h3>What it makes room for</h3><div class="land-chips">${chipsOf(['family', 'faith', 'fitness', 'mental', 'community', 'personal', 'home'])}</div></div>
        </div>
      </section>

      <section class="land-tools">
        <h2>And the planning tools to do it well</h2>
        <p class="land-lead">Purpose gives the direction. Life.OS also gives you the everyday machinery for serious work and a full life.</p>
        <div class="land-feats">
          ${feat('✓', 'Tasks and projects for real work', 'Due dates, priorities, projects, tags, subtasks, and Waiting and Someday lists. Add them in plain words, like “send invoice friday !high +Client”.')}
          ${feat('↻', 'Repeating tasks and habits', 'Bills, reports and routines repeat on their own. Habits show streaks instead of piling up as overdue.')}
          ${feat('▦', 'A real daily calendar', 'An hour-by-hour day down to 15 minutes. Block time for deep work, drag tasks onto it, and see your Google Calendars beside them.')}
          ${feat('☰', 'Weekly and daily planning', 'Guided sessions for the year, quarter, month, week and day, plus a Big 3 and a one-tap “move undone to tomorrow”.')}
          ${feat('★', 'Review and reflect', '“What I finished” summaries by week, month, quarter or year you can copy, download or print, handy for career reviews too.')}
          ${feat('⌘', 'Fast and forgiving', 'Search everything with one key, undo and restore deleted items, work offline, and print a clean page for your paper planner.')}
        </div>
      </section>

      <section class="land-final">
        <h2>Choose work that matters. Build a life around it.</h2>
        <p>Your first sign-in creates your account. There is nothing else to fill in. Or take the two-minute demo first.</p>
        ${cta('Get started with Google')}
        <p class="land-quote">“The key is not to prioritize what's on your schedule, but to schedule your priorities.” <span>Stephen Covey</span></p>
      </section>
    </div>`;
  }

  /* ---------- welcome: an interactive demo with sample data (never touches your real data) ---------- */
  const DEMO_DEFAULT_GOALS = [
    { id: 'dad', title: 'Build a closer relationship with Dad', color: '#b5603c', why: 'He will not always be a phone call away.', steps: ['Pick a regular call day and time'], actions: ['Pick a call day and time with Dad'], routine: { text: 'Call Dad', per: 'once a week' } },
    { id: 'spouse', title: 'Deepen my marriage', color: '#a9697a', why: 'Our kids learn love by watching ours.', steps: ['Plan a monthly date night'], actions: ['Pick a date-night restaurant'], routine: { text: 'Daily check-in with my spouse', per: 'every day' } },
    { id: 'kids', title: 'One-on-one time with each kid', color: '#8a76a8', why: 'They will remember the time, not the stuff.', steps: ['Pick an activity for each child'], actions: ['Take Emma to breakfast'], routine: { text: 'Bedtime talk with one child', per: '3× a week' } },
    { id: 'friend', title: 'Reconnect with a close friend', color: '#5b7a5a', why: 'Friendships fade unless I tend them.', steps: ['Text Alex to set a coffee'], actions: ['Text Alex about coffee'] },
    { id: 'run', title: 'Run a 10K', color: '#6f8296', why: 'Health gives me energy for everyone else.', steps: ['Run 5K without stopping'], actions: ['Plan three runs this week'] },
    { id: 'trip', title: 'Take a family trip', color: '#c29a3f', why: 'Shared adventures become family stories.', steps: ['Pick the destination and dates'], actions: ['Choose trip dates'] },
  ];
  const DEMO_HABITS = [{ id: 'read', text: 'Read to the kids before bed', per: 'every day' }, { id: 'work', text: 'Workout', per: '5× a week' }];
  const DEMO_DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri']];
  const demoFresh = () => ({
    purpose: 'To raise confident kids, stay healthy, and serve my community.',
    focus: ['dad', 'kids', 'run'], day: 2, scheduled: {}, habit: {},
    assigned: { 'dad:0': 2, 'kids:0': 3, 'run:0': 1 },
    personas: [], goals: DEMO_DEFAULT_GOALS,
  });
  let demo = demoFresh();
  const dg = (id) => demo.goals.find((g) => g.id === id);
  /* The tour's sample data follows the "I am…" answers: six goals spread across life areas that fit those answers. */
  function rebuildDemo() {
    const ids = demo.personas;
    if (!ids.length) { const keep = { personas: [], day: demo.day }; demo = Object.assign(demoFresh(), keep); return; }
    const sc = (it) => { const f = it.for || [], hit = f.filter((x) => ids.includes(x)).length; return !f.length ? 1 : hit ? 2 + hit : 0; };
    const ranked = SUGGEST.goals.map((g, i) => ({ g, i, sc: sc(g) })).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc || a.i - b.i);
    const picked = [], areas = new Set();
    ranked.forEach((x) => { if (picked.length < 6 && !areas.has(x.g.area)) { picked.push(x); areas.add(x.g.area); } });
    ranked.forEach((x) => { if (picked.length < 6 && !picked.includes(x)) picked.push(x); });
    const perLabel = (n) => (n === 7 ? 'every day' : n === 1 ? 'once a week' : `${n}× a week`);
    const goals = picked.map((x, i) => ({ id: `s${x.i}`, title: x.g.title, color: ['#b5603c', '#a9697a', '#8a76a8', '#5b7a5a', '#6f8296', '#c29a3f'][i % 6], why: x.g.why, steps: x.g.steps.slice(0, 2), actions: [x.g.steps[0]], routine: x.g.routine ? { text: x.g.routine.text, per: perLabel(x.g.routine.perWeek) } : undefined }));
    const purpose = PERSONAS.filter((p) => ids.includes(p.id)).map((p) => p.purpose)[0] || demoFresh().purpose;
    const focus = goals.slice(0, 3).map((g) => g.id), days = [2, 3, 1];
    demo = Object.assign(demoFresh(), { personas: ids, goals, purpose, focus, assigned: Object.fromEntries(focus.map((id, i) => [`${id}:0`, days[i]])), day: demo.day });
  }
  const gtag = (g) => `<span class="gtag" style="--c:${g.color}"><i></i>${esc(g.title)}</span>`;
  const demoTasks = () => demo.focus.flatMap((id) => dg(id).actions.slice(0, 1).map((text, i) => ({ id: `${id}:${i}`, text, g: dg(id) })));
  const demoBlocksFor = (dow) => {
    const b = [];
    if (dow >= 1 && dow <= 5) b.push({ cls: 'ideal', start: 390, mins: 60, time: '06:30', html: '🏃 Workout' });
    const themed = { 1: ['Home & car maintenance', 1050], 2: ['Family night', 1080], 3: ['Activities', 960], 4: ['Community impact', 1050], 5: ['Plan next week', 900] }[dow];
    if (themed) b.push({ cls: 'ideal', start: themed[1], mins: 60, time: hhmm24(themed[1]), html: themed[0] });
    if (dow === 2 || dow === 4) b.push({ cls: 'gcal', start: 600, mins: 60, time: '10:00', html: '📅 Team meeting', c: '#6f8296' });
    (demo.scheduled[dow] || []).forEach((x) => b.push({ cls: 'sched', start: x.start, mins: x.mins, time: hhmm24(x.start), html: `${esc(x.text)}`, c: x.color }));
    return b;
  };

  function viewWelcome(arg) {
    const n = Math.min(5, Math.max(1, Number(arg) || 1));
    const labels = ['About you', 'Purpose & goals', 'Weekly plan', 'Daily calendar', 'Make it yours'];
    const stepper = `<ol class="setup-steps">${labels.map((l, i) => `<li class="${i + 1 === n ? 'cur' : ''}${i + 1 < n ? ' ok' : ''}"><a href="#/welcome/${i + 1}"><b>${i + 1 < n ? '✓' : i + 1}</b><span>${l}</span></a></li>`).join('')}</ol>`;
    const nav = `<div class="row setup-nav">${n > 1 ? `<a class="btn ghost" href="#/welcome/${n - 1}">← Back</a>` : ''}<span class="grow"></span>${n < 5 ? `<a class="btn primary" href="#/welcome/${n + 1}">Next →</a>` : ''}</div>`;
    const fg = demo.focus.map(dg);
    const signInStrip = signedIn() ? '' : `<section class="box sync-nudge signin-strip"><div class="grow"><strong>Already have an account, or want your plan saved?</strong> <span class="muted">Sign in with Google to keep it in your own Drive and open it on any device. New here? Your first sign-in creates your account.</span></div>
        <button type="button" class="btn primary" data-act="signIn">Continue with Google</button></section>`;
    let body = signInStrip + stepper;

    if (n === 1) {
      const on = demo.personas;
      body += `<section class="box"><h2>First, which of these sound like you?</h2>
        <p class="prompt">Tap everything that fits and the sample plan on the next steps will match your life. Nothing here is saved, and you can skip it.</p>
        <div class="pick-grid">${PERSONAS.map((p) => `<button type="button" class="pick-card${on.includes(p.id) ? ' on' : ''}" data-act="demoPersona" data-id="${p.id}" aria-pressed="${on.includes(p.id)}"><strong>${esc(p.label)}</strong><small class="muted">${esc(p.sub)}</small></button>`).join('')}</div></section>`;
    } else if (n === 2) {
      body += `<section class="box"><h2>Turn your purpose into your calendar</h2>
          <p class="prompt">A two-minute tour with sample data. Nothing here is saved.</p>
          <h3>Your purpose</h3><textarea data-demo="purpose" rows="2">${esc(demo.purpose)}</textarea>
          <h3>Choose this quarter's focus <span class="muted">· ${fg.length} of 4</span></h3>
          <div class="chips">${demo.goals.map((g) => { const on = demo.focus.includes(g.id); return `<button type="button" class="chip${on ? ' on' : ''}" style="--c:${g.color}" data-act="demoFocus" data-id="${g.id}" aria-pressed="${on}">${esc(g.title)}</button>`; }).join('')}</div>
          ${fg.length ? `<ul class="plain-list">${fg.map((g) => `<li>${gtag(g)}<small class="muted">${esc(g.why)}</small></li>`).join('')}</ul>` : '<p class="muted">Pick at least one to continue.</p>'}
        </section>`;
    } else if (n === 3) {
      const tasks = demoTasks();
      body += `<section class="box"><h2>3 · Each focus goal becomes an action</h2>
          <p class="prompt">In your weekly planning, choose the day each one happens.</p>
          ${tasks.map((t) => `<div class="demo-task"><div class="grow">${esc(t.text)}<br>${gtag(t.g)}</div><div class="daychips">${DEMO_DAYS.map(([d, l]) => `<button type="button" class="chip small${demo.assigned[t.id] === d ? ' on' : ''}" data-act="demoAssign" data-id="${t.id}" data-day="${d}">${l}</button>`).join('')}</div></div>`).join('') || '<p class="muted">Pick focus goals in step 1.</p>'}
          <h3>Your week</h3>
          <div class="board">${DEMO_DAYS.map(([d, l]) => `<div class="board-col"><strong>${l}</strong>${tasks.filter((t) => demo.assigned[t.id] === d).map((t) => `<div class="board-item" style="--c:${t.g.color}">${esc(t.text)}</div>`).join('')}</div>`).join('')}</div>
        </section>`;
    } else if (n === 4) {
      const dow = demo.day, dayName = DEMO_DAYS.find((x) => x[0] === dow)[1];
      const tasks = demoTasks().filter((t) => demo.assigned[t.id] === dow);
      const big = [...tasks.slice(0, 3)];
      fg.forEach((g) => { if (big.length < 3 && !big.some((t) => t.g.id === g.id)) big.push({ id: `step:${g.id}`, text: g.steps[0], g }); });
      const placed = layoutDay(demoBlocksFor(dow).map((o) => ({ ...o, end: o.start + o.mins })));
      const hours = Array.from({ length: 24 }, (_, h) => `<div class="tl-hr" style="top:${h * 60}px">${h === 0 ? '' : esc(fmtTime(`${U.pad(h)}:00`))}</div>`).join('');
      const blocks = placed.map((o) => `<div class="tl-blk ${o.cls}" style="top:${o.start}px;height:${o.end - o.start - 1}px;left:calc(${(o.col / o.cols) * 100}% + 1px);width:calc(${100 / o.cols}% - 3px)${o.c ? `;--c:${o.c}` : ''}"><b>${esc(fmtTime(o.time))}</b> ${o.html}</div>`).join('');
      const routines = fg.filter((g) => g.routine);
      body += `<section class="box"><h2>4 · The plan lands on your calendar</h2>
          <p class="prompt">Open a day. Tap 📅 on a task to give it a time.</p>
          <div class="chips">${DEMO_DAYS.map(([d, l]) => `<button type="button" class="chip${d === dow ? ' on' : ''}" data-act="demoDay" data-day="${d}">${l}</button>`).join('')}</div>
          <blockquote class="vision small">${esc(demo.purpose)}</blockquote></section>
        <div class="today-cols"><div class="today-left"><section class="box"><h3>${dayName}'s schedule</h3>
            <div class="tl-wrap" data-start="360" style="height:400px"><div class="tl"><div class="tl-hours">${hours}</div><div class="tl-canvas">${Array.from({ length: 24 }, (_, h) => `<div class="tl-slot hr" style="top:${h * 60}px"></div>`).join('')}${blocks}</div></div></div></section></div>
          <div class="today-right">
            <section class="box"><h3>Today's priorities</h3>${big.map((t) => `<div class="demo-task"><div class="grow">${esc(t.text)}<br>${gtag(t.g)}</div><button type="button" class="btn ghost small" data-act="demoSchedule" data-id="${t.id}">📅</button></div>`).join('') || '<p class="muted small">Choose focus goals in step 1.</p>'}</section>
            ${routines.length ? `<section class="box"><h3>Routines</h3>${routines.map((g) => `<label class="inline-check demo-habit"><input type="checkbox" data-act="demoHabit" data-id="r-${g.id}:${dow}" ${demo.habit[`r-${g.id}:${dow}`] ? 'checked' : ''}> ${esc(g.routine.text)} <small class="muted">${esc(g.routine.per)}</small></label>`).join('')}</section>` : ''}
          </div></div>`;
    } else {
      body += `<section class="box demo-hero"><h2>5 · Make it yours</h2>
          <p class="lead">Purpose, focus goals, a weekly plan, and a daily calendar, with a short review to keep it honest.</p>
          <div class="row"><button type="button" class="btn primary" data-act="demoStart" data-to="quick">Quick start (about 1 minute)</button>${signedIn() ? '' : '<button type="button" class="btn" data-act="signIn">Sign in with Google</button>'}<button type="button" class="btn ghost" data-act="demoStart" data-to="setup">Full guide (about 5 minutes)</button><a class="btn ghost" href="#/today">Skip, explore the app</a><button type="button" class="btn ghost" data-act="demoReset">Replay the demo</button></div></section>`;
    }
    return page('Welcome to Life.OS', `Interactive demo · step ${n} of 5 · sample data only`, body + nav);
  }
  document.addEventListener('input', (e) => { if (e.target.dataset && e.target.dataset.demo === 'purpose') demo.purpose = e.target.value; });

  /* ---------- rotating quotes ---------- */
  const QUOTES = [
    ['The key is not to prioritize what\'s on your schedule, but to schedule your priorities.', 'Stephen Covey'],
    ['The main thing is to keep the main thing the main thing.', 'Stephen Covey'],
    ['Begin with the end in mind.', 'Stephen Covey'],
    ['Most people do not listen with the intent to understand; they listen with the intent to reply.', 'Stephen Covey'],
    ['You don\'t have to be great to start, but you have to start to be great.', 'Zig Ziglar'],
    ['If you aim at nothing, you will hit it every time.', 'Zig Ziglar'],
    ['A goal properly set is halfway reached.', 'Zig Ziglar'],
    ['Lack of direction, not lack of time, is the problem. We all have twenty-four hour days.', 'Zig Ziglar'],
    ['Success is the doing, not the getting; in the trying, not the triumph.', 'Zig Ziglar'],
    ['People often say that motivation doesn\'t last. Well, neither does bathing. That\'s why we recommend it daily.', 'Zig Ziglar'],
    ['Efficiency is doing things right; effectiveness is doing the right things.', 'Peter Drucker'],
    ['There is nothing so useless as doing efficiently that which should not be done at all.', 'Peter Drucker'],
    ['If you don\'t prioritize your life, someone else will.', 'Greg McKeown'],
    ['Clarity about what matters provides clarity about what does not.', 'Cal Newport'],
    ['How we spend our days is, of course, how we spend our lives.', 'Annie Dillard'],
    ['Those who have a why to live can bear almost any how.', 'Viktor Frankl'],
    ['It is not that we have a short time to live, but that we waste a lot of it.', 'Seneca'],
    ['Lost time is never found again.', 'Benjamin Franklin'],
    ['Plans are worthless, but planning is everything.', 'Dwight D. Eisenhower'],
    ['Either you run the day or the day runs you.', 'Jim Rohn'],
    ['Don\'t wish it were easier. Wish you were better.', 'Jim Rohn'],
    ['Failing to plan is planning to fail.', 'Alan Lakein'],
    ['What you do every day matters more than what you do once in a while.', 'Gretchen Rubin'],
    ['You do not rise to the level of your goals. You fall to the level of your systems.', 'James Clear'],
    ['Every action you take is a vote for the type of person you wish to become.', 'James Clear'],
    ['Every minute you spend in planning saves ten minutes in execution.', 'Brian Tracy'],
    ['Where focus goes, energy flows.', 'Tony Robbins'],
    ['Time is what we want most, but what we use worst.', 'William Penn'],
    ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'],
    ['The best time to plant a tree was twenty years ago. The second best time is now.', 'Proverb'],
  ];
  let quoteIdx = Math.floor(U.parseISO(todayISO()).getTime() / 86400000) % QUOTES.length;
  function showQuote() {
    const el = document.getElementById('quoteText'), q = QUOTES[quoteIdx];
    if (el) el.textContent = `“${q[0]}” · ${q[1]}`;
  }

  /* ---------- protect my plan: sync across devices (Google Drive app data) ---------- */
  const SYNC_FILE = 'lifeos-data.json', SYNC_KEEP = 14;
  const DRIVE = 'https://www.googleapis.com/drive/v3/files', UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files', DRIVE_FIELDS = 'id,name,md5Checksum,modifiedTime';
  const gScope = () => localStorage.getItem('google_scope') || '';
  const syncHasScope = () => !!localStorage.getItem('google_access_token') && /auth\/drive\.appdata/.test(gScope());
  const syncEnabled = () => !!state.settings.syncOn && syncHasScope();
  const sync = { busy: false, status: 'off', msg: '', timer: null, backups: null, epoch: 0 };
  const fmtClock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const syncVersion = (f) => (f ? f.md5Checksum || f.modifiedTime : '');
  const deviceId = () => { let d = localStorage.getItem('lifeos.device'); if (!d) { d = S.uid(); localStorage.setItem('lifeos.device', d); } return d; };
  const hashStr = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return String(h >>> 0); };
  const wrapData = (data) => ({ app: 'lifeos', version: 1, updatedAt: new Date().toISOString(), device: deviceId(), data });
  const dataWeight = () => ['goals', 'roles', 'events', 'workouts', 'journals', 'schedule', 'idealWeek', 'wheel', 'memories', 'inbox', 'tasks'].reduce((n, k) => n + state[k].length, 0)
    + Object.keys(state.weeks).length + Object.keys(state.months).length + ((state.foundation.mission || '').trim() ? 4 : 0);
  function isBlank() {
    return ['goals', 'roles', 'schedule', 'workouts', 'journals', 'events', 'idealWeek', 'inbox', 'tasks', 'wheel', 'memories'].every((k) => !state[k].length) && !(state.foundation.mission || '').trim();
  }
  /* Everything except per-device things (notification state, calendar list cache, sync bookkeeping). */
  function syncPayload() {
    const o = JSON.parse(JSON.stringify(state));
    ['lastNotifications', 'gcalCalendars', 'syncMeta', 'trash'].forEach((k) => delete o[k]);
    ['notificationsEnabled', 'syncOn'].forEach((k) => delete o.settings[k]);
    return o;
  }
  function adoptData(data) {
    const keep = { lastNotifications: state.lastNotifications, gcalCalendars: state.gcalCalendars, syncMeta: state.syncMeta, trash: state.trash };
    const dev = { notificationsEnabled: state.settings.notificationsEnabled, syncOn: state.settings.syncOn };
    const next = S.migrate(data);
    Object.assign(next, keep); Object.assign(next.settings, dev);
    return next;
  }
  const mergeStates = P.mergeStates;

  async function googleRefresh() {
    const rt = localStorage.getItem('google_refresh_token');
    if (!rt) return false;
    const r = await fetch(`${API_BASE}/api/auth/google/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }) });
    if (!r.ok) return false;
    localStorage.setItem('google_access_token', (await r.json()).access_token);
    return true;
  }
  async function driveFetch(url, opts, retried) {
    const res = await fetch(url, { ...(opts || {}), headers: { ...((opts && opts.headers) || {}), Authorization: `Bearer ${localStorage.getItem('google_access_token')}` } });
    if (res.status === 401 && !retried) { if (await googleRefresh()) return driveFetch(url, opts, true); throw new Error('Google sign-in expired. Turn sync on again in Settings.'); }
    if (!res.ok) throw new Error(`Google Drive error ${res.status}`);
    return res;
  }
  async function driveList(q) {
    const res = await driveFetch(`${DRIVE}?spaces=appDataFolder&pageSize=100&q=${encodeURIComponent(q)}&fields=${encodeURIComponent(`files(${DRIVE_FIELDS})`)}`);
    return (await res.json()).files || [];
  }
  const driveFind = async () => (await driveList(`name='${SYNC_FILE}' and trashed=false`))[0] || null;
  const driveRead = async (id) => (await driveFetch(`${DRIVE}/${id}?alt=media`)).json();
  async function driveWrite(id, name, content) {
    const body = JSON.stringify(content);
    if (id) return (await driveFetch(`${UPLOAD}/${id}?uploadType=media&fields=${DRIVE_FIELDS}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body })).json();
    const b = `lifeos${S.uid()}`;
    const multipart = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: ['appDataFolder'] })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`;
    return (await driveFetch(`${UPLOAD}?uploadType=multipart&fields=${DRIVE_FIELDS}`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body: multipart })).json();
  }

  const signedIn = () => !!localStorage.getItem('google_access_token') && /userinfo\.email|(^|\s)email(\s|$)/.test(gScope());
  function renderAccountChip() {
    const b = document.getElementById('navAccount');
    if (!b) return;
    if (signedIn()) { const e = localStorage.getItem('google_email') || '?'; b.textContent = e[0].toUpperCase(); b.title = `Signed in as ${e}`; b.className = 'nav-acct on'; b.setAttribute('aria-label', `Account: ${e}`); }
    else { b.textContent = 'Sign in'; b.title = 'Sign in with Google'; b.className = 'nav-acct'; b.setAttribute('aria-label', 'Sign in with Google'); }
  }
  async function doSignOut(wipe) {
    if (wipe) {
      if (!syncEnabled()) { toast('Sync is off, so clearing this device would lose your plan. Turn sync on first.'); return; }
      await syncNow();
      if (sync.status !== 'ok') { toast('Could not confirm your plan is saved to Drive, so nothing was cleared.'); return; }
    }
    clearTimeout(sync.timer); sync.epoch++; sync.busy = false;      // stop anything still syncing
    ['google_access_token', 'google_refresh_token', 'google_scope', 'google_email', 'google_intent', 'google_cal_off', 'account_mode', 'login_prompt_seen'].forEach((k) => localStorage.removeItem(k));
    state.settings.syncOn = false; state.syncMeta = {}; gcalReset(); gcal.listTried = false; sync.status = 'off'; sync.backups = null;
    if (wipe) { state = S.defaultState(); rebaseIds(); }
    rawSave(state);
    try { sessionStorage.setItem('lifeos.toast', wipe ? 'Signed out. This device is cleared; your plan is safe in Google Drive.' : 'Signed out. Your plan stays on this device.'); } catch (e) { /* storage unavailable */ }
    // reload so nothing from the signed-in session lingers in memory
    location.hash = wipe ? '#/landing' : '#/settings'; location.reload();
  }
  function accountCard() {
    if (signedIn()) return `<section class="box account-card"><h2>Account</h2>
      <p>Signed in with Google as <strong>${esc(localStorage.getItem('google_email') || 'your account')}</strong>. Your plan is saved to your own Google Drive and follows you to any device you sign in on.</p>
      <div class="row wrap"><button class="btn ghost" data-act="signOut" data-wipe="0">Sign out</button><button class="btn ghost danger" data-act="signOut" data-wipe="1">Sign out and clear this device</button></div></section>`;
    return `<section class="box account-card"><h2>Account</h2>
      <p class="prompt">Sign in with Google to keep your plan safe in your own Drive and open it on any device. New here? Your first sign-in creates your account; there is nothing else to fill in.</p>
      <div class="row wrap"><button class="btn primary" data-act="signIn">Sign in with Google</button></div>
      <p class="muted small">Prefer not to? Life.OS works without an account, and your plan then stays on this device only.</p></section>`;
  }
  async function ocrAllowed() {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(`${API_BASE}/api/ocr/access`, { headers: { Authorization: `Bearer ${localStorage.getItem('google_access_token') || ''}` } });
        const a = await r.json();
        if (a.signedIn === false && attempt === 0 && await googleRefresh()) continue;
        return a;
      } catch (e) { return { allowed: true, unknown: true }; }                // server unreachable: let the upload report it
    }
    return { allowed: false, signedIn: false };
  }

  function showSyncStatus() {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    const m = state.syncMeta || {};
    el.textContent = !syncEnabled() ? '' : sync.status === 'syncing' ? '☁ Syncing…' : sync.status === 'error' ? `⚠ Sync problem: ${sync.msg}`
      : m.at ? `☁ Backed up ${fmtClock(m.at)}` : '☁ Sync on';
  }
  function setSync(status, msg) {
    sync.status = status; sync.msg = msg || '';
    showSyncStatus();
    if (location.hash.startsWith('#/settings')) render();
  }
  async function snapshotToday(cur) {            // one dated backup per day, newest 14 kept
    const day = todayISO();
    if ((state.syncMeta || {}).snapshotDay === day) return;
    const have = await driveList(`name='lifeos-backup-${day}.json' and trashed=false`);   // another device may have made today's already
    if (!have.length) await driveWrite(null, `lifeos-backup-${day}.json`, wrapData(cur));
    state.syncMeta.snapshotDay = day; rawSave(state);
    const files = (await driveList("name contains 'lifeos-backup-' and trashed=false")).sort((a, b) => (a.name < b.name ? 1 : -1));
    for (const f of files.slice(SYNC_KEEP)) await driveFetch(`${DRIVE}/${f.id}`, { method: 'DELETE' });
  }
  async function pushLocal(fileId) {
    const ep = sync.epoch, cur = syncPayload(), f = await driveWrite(fileId, SYNC_FILE, wrapData(cur));
    if (ep !== sync.epoch) return;   // signed out while this was in flight
    state.syncMeta = { ...(state.syncMeta || {}), fileId: f.id, remoteVersion: syncVersion(f), hash: hashStr(JSON.stringify(cur)), at: new Date().toISOString() };
    rawSave(state);
    snapshotToday(cur).catch((e) => console.warn('Backup copy failed', e));
  }
  function applyRemote(data, remote) {
    const prevMeta = state.syncMeta || {};
    state = adoptData(data); rebaseIds();
    state.syncMeta = { ...prevMeta, fileId: remote.id, remoteVersion: syncVersion(remote), at: new Date().toISOString() };
    state.syncMeta.hash = hashStr(JSON.stringify(syncPayload()));
    rawSave(state); render();
  }
  /* Both sides changed (or this device already had a plan when it met your Drive copy): combine them automatically.
     Deleted items stay deleted (tombstones) and a copy of both versions is saved to Drive first, so nothing can be lost. */
  async function reconcile(remote, data) {
    const day = todayISO();
    await driveWrite(null, `lifeos-backup-${day}-before-merge-this-device.json`, wrapData(syncPayload())).catch(() => {});
    await driveWrite(null, `lifeos-backup-${day}-before-merge-drive-copy.json`, wrapData(data)).catch(() => {});
    applyRemote(mergeStates(syncPayload(), data), remote);
    await pushLocal(remote.id);
    setSync('ok'); toast('Combined the changes from your other device');
  }

  async function syncNow() {
    if (!syncEnabled() || sync.busy) return;
    sync.busy = true; setSync('syncing');
    const ep = sync.epoch, stale = () => ep !== sync.epoch || !syncEnabled();   // signing out cancels anything still in flight
    try {
      const meta = state.syncMeta || {}, curHash = hashStr(JSON.stringify(syncPayload())), dirty = curHash !== meta.hash;
      const remote = await driveFind();
      if (stale()) return;
      if (!remote) { if (!isBlank()) await pushLocal(null); setSync('ok'); }
      else if (meta.fileId !== remote.id) {                    // first time this device meets this Drive file
        const w = await driveRead(remote.id);
        if (stale()) return;
        if (isBlank()) { applyRemote(w.data, remote); setSync('ok'); toast('Your plan was restored from Google Drive'); }
        else await reconcile(remote, w.data);
      } else if (syncVersion(remote) === meta.remoteVersion) { if (dirty) await pushLocal(remote.id); setSync('ok'); }
      else {
        const w = await driveRead(remote.id);
        if (stale()) return;
        if (!dirty) { applyRemote(w.data, remote); setSync('ok'); } else await reconcile(remote, w.data);
      }
    } catch (e) { if (!stale()) { console.error('Sync failed:', e); setSync('error', e.message); } }
    finally { if (ep === sync.epoch) sync.busy = false; showSyncStatus(); }
  }
  function scheduleSync() {
    if (!syncEnabled()) return;
    clearTimeout(sync.timer); sync.timer = setTimeout(syncNow, 3000);
  }
  async function loadBackups() {
    try { sync.backups = (await driveList("name contains 'lifeos-backup-' and trashed=false")).sort((a, b) => (a.name < b.name ? 1 : -1)); }
    catch (e) { sync.backups = []; toast(e.message); }
    render();
  }
  async function restoreBackup(id) {
    try {
      const w = await driveRead(id);
      await driveWrite(null, `lifeos-backup-${todayISO()}-before-restore.json`, wrapData(syncPayload())).catch(() => {});   // never lose the current plan
      state = adoptData(w.data); rebaseIds();
      state.syncMeta = { ...(state.syncMeta || {}), hash: '' };      // mark as changed so it is uploaded as the new current copy
      rawSave(state); render(); scheduleSync(); toast('Restored from the backup');
    } catch (e) { toast(e.message); }
  }
  function syncCard() {
    const on = syncEnabled(), email = localStorage.getItem('google_email') || '', m = state.syncMeta || {};
    const backups = sync.backups ? (sync.backups.length ? `<ul class="backups">${sync.backups.map((f) => `<li><strong>${esc(f.name.replace(/^lifeos-backup-|\.json$/g, ''))}</strong><button type="button" class="btn ghost small" data-act="syncRestore" data-id="${esc(f.id)}">Restore</button></li>`).join('')}</ul>` : '<p class="muted small">No backup copies yet. One is saved each day you change your plan.</p>') : '';
    return `<section class="box sync-card"><h2>Protect my plan <small class="muted">· sync across devices</small></h2>
      <p class="prompt">Your plan is saved in this browser. Turn on sync and it is also kept as one private file in <strong>your own Google Drive</strong> (a hidden app folder that only Life.OS can open), so a cleared browser or a lost phone can't erase it, and every device stays the same. A dated backup is saved daily.</p>
      ${on ? `<p>${sync.status === 'error' ? `<span class="nudge">⚠ ${esc(sync.msg)}</span>` : `✓ Syncing${email ? ` as <strong>${esc(email)}</strong>` : ''}${m.at ? ` · last synced ${esc(fmtClock(m.at))}` : ''}`}</p>
        <div class="row wrap"><button class="btn" data-act="syncNow">Sync now</button><button class="btn ghost" data-act="syncBackups">Cloud backups…</button><button class="btn ghost" data-act="export">Download a backup file</button><button class="btn ghost" data-act="syncOff">Turn off</button><button class="btn ghost danger" data-act="syncDelete">Delete cloud copy</button></div>${backups}`
      : `<div class="row wrap">${signedIn() ? '<button class="btn primary" data-act="syncEnable">Turn sync back on</button>' : '<span class="muted">Sign in above to turn this on.</span>'}<button class="btn ghost" data-act="export">Download a backup file</button></div>
        <p class="muted small">Life.OS only asks Google for your email and its own private folder in Drive. It can't see your other files.</p>`}
    </section>`;
  }

  /* ---------- router ---------- */
  document.addEventListener('scroll', (e) => { if (e.target.classList && e.target.classList.contains('tl-wrap')) tlScroll = e.target.scrollTop; }, true);
  document.addEventListener('click', (e) => {
    const slot = e.target.closest && e.target.closest('.tl-slot');
    if (!slot) return;
    const f = slot.closest('.tl-box').querySelector('form');
    f.querySelector('input[name=time]').value = slot.dataset.time;
    f.querySelector('input[name=text]').focus();
  });
  const keepOpen = {};
  document.addEventListener('toggle', (e) => { const k = e.target.dataset && e.target.dataset.keep; if (k) keepOpen[k] = e.target.open; }, true);
  const ROUTES = {
    today: viewToday, landing: viewLanding, 'landing-v1': viewLandingV1, foundation: viewFoundation, goals: viewGoals, year: viewYear,
    month: viewMonth, week: viewWeek, ideal: viewIdeal, setup: viewSetup, welcome: viewWelcome, demo: viewWelcome, quick: viewQuick, start: viewStart, session: viewSession, calendar: viewCalendar, track: viewTrack, wheel: viewWheel, lists: viewLists, settings: viewSettings,
  };
  function render() {
    const [, name = 'today', arg, arg2] = (location.hash || '#/today').split('/');
    const view = ROUTES[name] || viewToday;
    const y = window.scrollY;
    const focused = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.bind;
    app.innerHTML = view(arg, arg2);
    document.body.classList.toggle('printing-view', name === 'print');
    document.body.classList.toggle('landing-view', name === 'landing' || name === 'landing-v1');
    gcalKick(name, arg);
    maybePromptLogin(name);
    app.querySelectorAll('details[data-keep]').forEach((d) => { if (d.dataset.keep in keepOpen) d.open = keepOpen[d.dataset.keep]; });
    const active = ROUTES[name] ? name : 'today';
    document.querySelectorAll('[data-route]').forEach((a) => {
      a.classList.toggle('sel', a.dataset.route === active);
      if (a.dataset.route === active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    moreBtn.classList.toggle('sel', moreBtn.dataset.moreRoutes.split(' ').includes(active));
    setMore(false);
    closeNavMenus();
    document.querySelectorAll('[data-routes]').forEach((el) => el.classList.toggle('sel', el.dataset.routes.split(' ').includes(active)));
    const tlw = app.querySelector('.tl-wrap');
    if (tlw) tlw.scrollTop = render.last === location.hash && tlScroll != null ? tlScroll : (Number(tlw.dataset.start) || 0) * (Number(tlw.dataset.zoom) || 1);
    if (render.last === location.hash) window.scrollTo(0, y); else window.scrollTo(0, 0);
    if (render.last !== location.hash) quoteIdx = (quoteIdx + 1) % QUOTES.length;
    showQuote(); showSyncStatus(); renderAccountChip();
    render.last = location.hash;
    if (focused) { const f = app.querySelector(`[data-bind="${CSS.escape(focused)}"]`); if (f) f.focus(); }
  }
  function closeNavMenus(except) {
    document.querySelectorAll('.nav-group').forEach((g) => {
      if (g === except) return;
      g.querySelector('.nav-menu').hidden = true; g.querySelector('.nav-btn').setAttribute('aria-expanded', 'false');
    });
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-btn');
    if (btn) {
      const g = btn.parentElement, menu = g.querySelector('.nav-menu'), opening = menu.hidden;
      closeNavMenus(g); menu.hidden = !opening; btn.setAttribute('aria-expanded', String(opening));
      return;
    }
    if (!e.target.closest('.nav-menu') || e.target.closest('.nav-menu a')) closeNavMenus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = document.querySelector('.nav-menu:not([hidden])');
    closeNavMenus(); if (open) open.parentElement.querySelector('.nav-btn').focus();
  });
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
    const intentNow = localStorage.getItem('google_intent');
    history.replaceState(null, '', location.pathname + (location.hash || (intentNow === 'signin' ? '#/today' : '#/settings')));
    try {
      const res = await fetch(`${API_BASE}/api/auth/google/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code })
      });
      if (!res.ok) throw new Error(await res.text());
      const t = await res.json();
      localStorage.setItem('google_access_token', t.access_token);
      if (t.refresh_token) localStorage.setItem('google_refresh_token', t.refresh_token);
      if (t.scope) localStorage.setItem('google_scope', t.scope);
      if (t.id_token) { try { const pl = JSON.parse(atob(t.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); if (pl.email) localStorage.setItem('google_email', pl.email); } catch (e) { /* email is only for display */ } }
      const intent = localStorage.getItem('google_intent'); localStorage.removeItem('google_intent');
      if (intent === 'sync' || intent === 'signin') {
        if (!syncHasScope()) { toast('Google did not allow Drive access. Try again and keep every box ticked.'); render(); return; }
        localStorage.setItem('account_mode', 'google');
        state.settings.syncOn = true; S.save(state); renderAccountChip();
        toast(`Signed in${localStorage.getItem('google_email') ? ` as ${localStorage.getItem('google_email')}` : ''}`);
        syncNow().then(() => {
          if (isBlank() && !/^#\/(setup|quick|start)/.test(location.hash)) location.hash = '#/start';      // first sign-in: create the plan
          else if (/^#\/(welcome|demo)/.test(location.hash)) location.hash = '#/today';
          render();
        });
        render(); return;
      }
      localStorage.removeItem('google_cal_off');
      const canRead = !t.scope || /auth\/calendar(\.readonly|\.calendarlist(\.readonly)?)?(\s|$)/.test(t.scope);
      toast(intent === 'calendarwrite' ? 'Permission granted. Try adding to your calendar again.' : canRead ? 'Google Calendar connected' : 'Connected, but Google did not allow reading your calendars. Reconnect and tick every box.');
      render();
    } catch (e) { console.error('Google login failed:', e); toast('Google login failed'); }
  })();
  const loginDlg = document.getElementById('loginDlg');
  const setAccountMode = (m) => { try { localStorage.setItem('account_mode', m); } catch (e) { /* storage unavailable */ } };
  if (loginDlg) {
    document.getElementById('loginGoogleBtn').addEventListener('click', () => startGoogleOAuth('signin'));
    document.getElementById('loginSkipBtn').addEventListener('click', () => setAccountMode('local'));
    loginDlg.addEventListener('cancel', () => setAccountMode('local'));
    document.getElementById('loginDemo').addEventListener('click', () => loginDlg.close());
  }
  /* Ask people to sign in (or choose no account) once, but never on top of the tour or the setup guide. */
  function maybePromptLogin(route) {
    if (!loginDlg || loginDlg.open || location.protocol === 'file:' || /^(landing|landing-v1|welcome|demo|setup|quick|start)$/.test(route)) return;
    let mode = '';
    try { mode = localStorage.getItem('account_mode') || localStorage.getItem('login_prompt_seen') || ''; } catch (e) { /* storage unavailable */ }
    if (mode || signedIn() || new URLSearchParams(location.search).get('code')) return;
    loginDlg.showModal();
  }
  window.addEventListener('hashchange', render);
  window.addEventListener('storage', (e) => { if (e.key === S.KEY) { state = S.load(); rebaseIds(); render(); } });
  document.getElementById('copyBtn').addEventListener('click', () => ACTS.copyDlg());
  /* The logo goes to the landing page until you are signed in, and to Today after. */
  document.querySelector('.brand').addEventListener('click', (e) => {
    e.preventDefault();
    const dest = signedIn() ? '#/today' : '#/landing';
    if (location.hash === dest) { render(); window.scrollTo(0, 0); } else location.hash = dest;
  });

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
  let calReviewName = '';
  /* ---------- review step for photo imports ---------- */
  const T = (k, ph, extra) => ({ k, ph, ...extra });
  const REVIEW = {
    goals: { title: 'Review roles & goals', route: 'goals', sections: [
      { key: 'roles', label: 'Roles', cols: [T('name', 'Role'), T('why', 'WHY', { wide: true })] },
      { key: 'goals', label: 'Goals', cols: [T('title', 'Goal', { wide: true }), T('role', 'Role'), T('cadence', '', { select: [['once', 'One-off goal'], ['daily', 'Daily habit'], ['weekly', 'Weekly habit'], ['monthly', 'Monthly']] }), T('target', '', { type: 'date' })] }] },
    workouts: { title: 'Review workouts', route: 'workouts', sections: [{ key: 'workouts', cols: [T('date', '', { type: 'date' }), T('type', 'Type'), T('minutes', 'min', { type: 'number', num: true }), T('details', 'Details', { wide: true })] }] },
    weights: { title: 'Review weigh-ins', route: 'weights', sections: [{ key: 'weights', cols: [T('date', '', { type: 'date' }), T('value', 'Weight', { type: 'number', num: true })] }] },
    habits: { title: 'Review habits', route: 'habits', sections: [{ key: 'habits', cols: [T('name', 'Habit', { wide: true }), T('target', 'days/wk', { type: 'number', num: true })] }] },
    shopping: { title: 'Review shopping list', route: 'shopping', sections: [{ key: 'items', cols: [T('text', 'Item', { wide: true })] }] },
    bucket: { title: 'Review bucket list', route: 'bucket', sections: [{ key: 'items', cols: [T('text', 'I\'m going to…', { wide: true }), T('budget', 'Budget'), T('target', 'Target')] }] },
    reading: { title: 'Review reading list', route: 'reading', sections: [{ key: 'items', cols: [T('title', 'Title', { wide: true }), T('by', 'By'), T('genre', 'Genre')] }] },
    events: { title: 'Review key dates', route: 'events', sections: [{ key: 'events', cols: [T('date', 'YYYY-MM-DD or MM-DD'), T('text', 'What', { wide: true }), T('yearly', 'Every year', { check: true })] }] },
    projects: { title: 'Review projects', route: 'projects', sections: [{ key: 'projects', cols: [T('name', 'Project'), T('steps', 'Next steps (one per line)', { area: true, wide: true })] }],
      load: (d) => ({ projects: (d.projects || []).map((p) => ({ ...p, steps: (p.steps || []).map((x) => x.text || x).join('\n') })) }),
      apply: (c) => ({ projects: c.projects.map((p) => ({ ...p, steps: String(p.steps || '').split('\n').map((t) => t.trim()).filter(Boolean).map((text) => ({ text })) })) }) },
    journal: { title: 'Review journal entry', route: 'journal', sections: [{ key: 'items', cols: [T('text', 'Text', { area: true, wide: true })] }],
      load: (d) => ({ items: [{ text: d.text || '' }] }), apply: (c) => ({ text: (c.items[0] || {}).text || '' }) },
    reflections: { title: 'Review reflections', route: 'journal', sections: [{ key: 'items', cols: [T('progress', 'Progress', { area: true, wide: true }), T('improve', 'To improve', { area: true, wide: true }), T('memories', 'Memories', { area: true, wide: true })] }],
      load: (d) => ({ items: [{ progress: d.progress || '', improve: d.improve || '', memories: d.memories || '' }] }),
      apply: (c) => { const r = c.items[0] || {}; return { text: `Progress: ${r.progress}\nTo improve: ${r.improve}\nMemories: ${r.memories}` }; } },
  };
  let reviewType = '';
  function showReview(type, data) {
    const def = REVIEW[type];
    reviewType = type;
    const d = def.load ? def.load(data) : data;
    const cell = (c, v) => {
      const val = v == null ? '' : v;
      if (c.check) return `<input type="checkbox" data-k="${c.k}" ${val ? 'checked' : ''} aria-label="${esc(c.ph)}">`;
      if (c.select) return `<select data-k="${c.k}">${opts(c.select.map(([x, l]) => ({ v: x, l })), val)}</select>`;
      if (c.area) return `<textarea data-k="${c.k}" rows="3" placeholder="${esc(c.ph)}">${esc(val)}</textarea>`;
      return `<input data-k="${c.k}" type="${c.type || 'text'}" ${c.num ? 'step="any" min="0" class="num"' : c.wide ? 'class="rev-text"' : ''} value="${esc(val)}" placeholder="${esc(c.ph || '')}" aria-label="${esc(c.ph || c.k)}">`;
    };
    let total = 0;
    const html = def.sections.map((sec) => {
      const rows = d[sec.key] || [];
      total += rows.length;
      return `${sec.label ? `<h3>${esc(sec.label)}</h3>` : ''}${rows.length ? `<table class="rev-table"><tbody>${rows.map((r) => `<tr class="rev-row" data-sec="${sec.key}"><td><input type="checkbox" class="rev-on" checked aria-label="Include"></td>${sec.cols.map((c) => `<td>${cell(c, r[c.k])}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p class="muted small">None found.</p>'}`;
    }).join('');
    document.getElementById('ocrTitle').textContent = def.title;
    document.getElementById('ocrType').textContent = total ? `${total} item${total === 1 ? '' : 's'} found. Fix anything wrong, untick what you don't want, then add.` : 'Nothing readable was found. Try a clearer, closer photo.';
    const preview = document.getElementById('ocrPreview');
    preview.style.maxHeight = '50vh';
    preview.innerHTML = total ? html : '';
    document.getElementById('routeButtons').innerHTML = total ? '<button type="button" class="btn primary" data-rev-add>Add selected</button>' : '';
    ocrSuggestions = [];
    uploadDlg.close(); ocrResultDlg.showModal();
  }
  function addReviewed() {
    const def = REVIEW[reviewType], out = {};
    def.sections.forEach((sec) => { out[sec.key] = []; });
    document.querySelectorAll('#ocrPreview .rev-row').forEach((tr) => {
      if (!tr.querySelector('.rev-on').checked) return;
      const row = {};
      tr.querySelectorAll('[data-k]').forEach((el) => { row[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value.trim(); });
      out[tr.dataset.sec].push(row);
    });
    ocrResultDlg.close();
    addOCRDataToApp(def.route, def.apply ? def.apply(out) : out);
  }


  const uploadType = document.getElementById('uploadType');
  uploadType.addEventListener('change', () => {
    const cal = uploadType.value === 'calendar';
    document.getElementById('uploadCalWrap').hidden = !cal; document.getElementById('uploadCalTip').hidden = !cal;
  });

  function showCalendarReview(rawEvents, calName) {
    calReviewName = calName || '';
    const events = [];
    rawEvents.forEach((ev) => {
      if (ev.allDay && ev.endDate && ev.endDate > ev.date) {
        for (let d = U.parseISO(ev.date), i = 0; U.toISO(d) <= ev.endDate && i < 14; d = U.addDays(d, 1), i++) events.push({ ...ev, date: U.toISO(d), endDate: '' });
      } else events.push(ev);
    });
    events.sort((a, b) => ((a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1));
    const approxN = events.filter((e) => e.approx).length;
    document.getElementById('ocrTitle').textContent = 'Review calendar events';
    document.getElementById('ocrType').textContent = events.length
      ? `${events.length} event${events.length === 1 ? '' : 's'} found${calName ? ` in "${calName}"` : ''}${approxN ? ` · ${approxN} marked ⚠ need a check (estimated time or cut-off title)` : ''}. Fix anything wrong, untick what you don't want.`
      : 'No events were found. Try a clearer screenshot that shows the day headers.';
    const preview = document.getElementById('ocrPreview');
    preview.style.maxHeight = '50vh';
    preview.innerHTML = events.length ? `<table class="rev-table"><tbody>${events.map((e) => `<tr class="rev-row${e.approx ? ' approx' : ''}">
      <td><input type="checkbox" checked aria-label="Include"></td>
      <td><input type="date" value="${esc(e.date)}" aria-label="Date"></td>
      <td><input type="time" value="${esc(e.time || '')}" aria-label="Start time"></td>
      <td><input type="number" class="num" min="0" step="5" value="${esc(e.mins)}" placeholder="min" aria-label="Minutes"></td>
      <td><input class="rev-text" value="${esc(e.text)}" aria-label="Title"></td>
      <td>${e.approx ? '<span title="Estimated or cut off. Please check">⚠</span>' : ''}</td></tr>`).join('')}</tbody></table>` : '';
    const writable = state.gcalCalendars.filter(gcalWritable), masterId = gcalMasterMeta().id;
    document.getElementById('routeButtons').innerHTML = !events.length ? '' : gcalConnected()
      ? `<label class="field">Create the meetings on <select id="revCal">${(writable.length ? writable : [{ id: 'primary', name: 'Primary calendar' }]).map((c) => `<option value="${esc(c.id)}"${c.id === masterId ? ' selected' : ''}>${esc(c.name)}${c.id === masterId ? ' (master)' : ''}</option>`).join('')}</select></label>
        <button type="button" class="btn primary" data-cal-act="google">Add to Google Calendar</button>
        <button type="button" class="btn ghost" data-cal-act="local">Life.OS only</button>`
      : '<button type="button" class="btn primary" data-cal-act="local">Add selected to my calendar</button>';
    ocrSuggestions = [];
    uploadDlg.close(); ocrResultDlg.showModal();
  }

  async function addReviewedEvents(mode) {
    const rows = [...document.querySelectorAll('#ocrPreview .rev-row')].filter((r) => r.querySelector('input[type=checkbox]').checked).map((r) => ({
      date: r.querySelector('input[type=date]').value, time: r.querySelector('input[type=time]').value,
      mins: Number(r.querySelector('input[type=number]').value) || '', text: r.querySelector('input.rev-text').value.trim(),
    })).filter((x) => x.date && x.text);
    if (!rows.length) { toast('Nothing selected'); return; }
    const batch = S.uid(), batchName = `${calReviewName || 'Photo'} · ${U.fmtDate(todayISO(), { month: 'short', day: 'numeric' })}`;
    let toLocal = rows;
    if (mode === 'google') {
      const sel = document.getElementById('revCal'), calId = sel ? sel.value : gcalMasterMeta().id;
      const results = await pushToGoogleCalendar(rows, calId);
      toLocal = rows.filter((_, i) => !results[i]);           // anything Google refused is kept in Life.OS
      if (toLocal.length) toast(`${results.length - toLocal.length} added to Google; ${toLocal.length} could not be, so they were saved in Life.OS instead`);
    }
    let added = 0;
    toLocal.forEach((x) => {
      if (state.schedule.some((s) => s.date === x.date && (s.time || '') === x.time && s.text.toLowerCase() === x.text.toLowerCase())) return;
      state.schedule.push({ id: S.uid(), date: x.date, time: x.time, mins: x.mins, text: x.text, cal: calReviewName, batch, batchName }); added++;
    });
    ocrResultDlg.close();
    S.save(state);
    if (mode !== 'google') toast(added ? `Added ${added} event${added === 1 ? '' : 's'} to Life.OS` : 'Those events were already on your calendar');
    location.hash = `#/calendar/week:${U.weekKey(U.parseISO(rows[0].date), ws())}`;
    render();
  }

  uploadInput.addEventListener('change', async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const type = uploadType.value || 'auto', calName = document.getElementById('uploadCal').value.trim();
    toast(files.length > 1 ? `Reading ${files.length} photos…` : 'Reading photo…');
    try {
      if (type === 'calendar') {
        const events = [];
        for (const f of files) { const r = await uploadPhotoOCR(f, 'calendar'); (r.data.events || []).forEach((ev) => events.push(ev)); }
        showCalendarReview(events, calName); return;
      }
      const result = await uploadPhotoOCR(files[0], type);
      if (result.type === 'calendar') { showCalendarReview(result.data.events || [], calName); return; }
      if (result.type === 'schedule') { showCalendarReview((result.data.entries || []).map((x) => ({ date: x.date, time: x.time || '', text: x.text, mins: '', allDay: !x.time, approx: !x.time })), calName); return; }
      if (REVIEW[result.type]) { showReview(result.type, result.data); return; }
      const { type: detected, data, suggestions = [] } = result;
      ocrSuggestions = suggestions;
      document.getElementById('ocrTitle').textContent = 'What is this?';
      document.getElementById('ocrPreview').style.maxHeight = '200px';
      document.getElementById('ocrType').textContent = `Detected: ${detected}`;
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
    const cb = e.target.closest('[data-cal-act]');
    if (cb) { addReviewedEvents(cb.dataset.calAct); return; }
    if (e.target.closest('[data-rev-add]')) { addReviewed(); return; }
    const btn = e.target.closest('[data-ocr-route]');
    const s = btn && ocrSuggestions[Number(btn.dataset.ocrRoute)];
    if (!s) return;
    ocrResultDlg.close();
    addOCRDataToApp(s.route, s.data);
  });

  /* ---------- schedule dialog + drag and drop ---------- */
  const schDlg = document.getElementById('scheduleDlg');
  const schEl = { text: document.getElementById('schText'), date: document.getElementById('schDate'), time: document.getElementById('schTime'), mins: document.getElementById('schMins'), google: document.getElementById('schGoogle'), gWrap: document.getElementById('schGoogleWrap') };
  let schTouched = false;
  function schSuggest() { if (!schTouched) schEl.time.value = schEl.date.value ? suggestSlot(schEl.date.value, Number(schEl.mins.value) || 30) : ''; }
  function openScheduleDialog(o) {
    schEl.text.value = o.text || ''; schEl.date.value = o.date || todayISO(); schEl.mins.value = String(o.mins || 30);
    if (![...schEl.mins.options].some((x) => x.value === schEl.mins.value)) schEl.mins.value = '30';
    schTouched = false; schSuggest();
    schEl.gWrap.hidden = !gcalConnected(); schEl.google.checked = false;
    document.getElementById('schGoogleLabel').textContent = `Also add to ${gcalMasterMeta().name}`;
    schDlg.showModal();
  }
  schEl.date.addEventListener('change', schSuggest);
  schEl.mins.addEventListener('change', schSuggest);
  schEl.time.addEventListener('input', () => { schTouched = true; });
  document.getElementById('schCancel').addEventListener('click', () => schDlg.close());
  document.getElementById('scheduleForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const o = { text: schEl.text.value.trim(), date: schEl.date.value, time: schEl.time.value, mins: Number(schEl.mins.value) || 30 };
    if (!o.text || !o.date) return;
    const added = addScheduleItem(o);
    if (added && schEl.google.checked && o.time) pushToGoogleCalendar([o]).then((r) => { if (r[0]) { added.pushed = true; S.save(state); render(); } });
    schDlg.close(); commit();
    toast(added ? `Scheduled${o.time ? ` for ${fmtTime(o.time)}` : ''} on ${U.fmtDate(o.date, { weekday: 'short', month: 'short', day: 'numeric' })}` : 'Already on your calendar');
  });
  document.addEventListener('dragstart', (e) => {
    const el = e.target.closest && e.target.closest('[data-drag]');
    if (!el) return;
    e.dataTransfer.setData('text/plain', el.dataset.drag); e.dataTransfer.effectAllowed = 'copy';
  });
  document.addEventListener('dragover', (e) => {
    const slot = e.target.closest && e.target.closest('.tl-slot');
    if (!slot) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    document.querySelectorAll('.tl-slot.drop').forEach((x) => { if (x !== slot) x.classList.remove('drop'); });
    slot.classList.add('drop');
  });
  document.addEventListener('drop', (e) => {
    const slot = e.target.closest && e.target.closest('.tl-slot');
    document.querySelectorAll('.tl-slot.drop').forEach((x) => x.classList.remove('drop'));
    if (!slot) return;
    e.preventDefault();
    let d; try { d = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
    if (!d || !d.text) return;
    const date = slot.closest('.tl-box').dataset.date;
    if (d.taskId && F.dropTaskOnSlot && F.dropTaskOnSlot(d.taskId, date, slot.dataset.time)) { commit(); toast(`Time-blocked for ${fmtTime(slot.dataset.time)}`, { label: 'Undo', fn: undo }); return; }
    const added = addScheduleItem({ text: d.text, date, time: slot.dataset.time, mins: d.mins || 30 });
    commit();
    toast(added ? `Scheduled for ${fmtTime(slot.dataset.time)}` : 'Already on your calendar');
  });

  if (state.idealWeek.some((i) => !i.quarter)) { state.idealWeek.forEach((i) => { if (!i.quarter) i.quarter = quarterKey(todayISO()); }); if (!firstRun) S.save(state); }
  const noAccountYet = (() => { try { return isBlank() && !signedIn() && !localStorage.getItem('account_mode') && !localStorage.getItem('login_prompt_seen'); } catch (e) { return firstRun; } })();
  if (noAccountYet && !new URLSearchParams(location.search).get('code') && !/^#\/(landing|welcome|demo|setup|quick|start)/.test(location.hash)) location.hash = '#/landing';
  if (navigator.storage && navigator.storage.persist && !isBlank()) navigator.storage.persist().catch(() => {});
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(syncNow, 5 * 60 * 1000);
  try { const sc = [...document.scripts].find((x) => /js\/app\.js/.test(x.src)), m = sc && /v=(\d{8})(\d{4})/.exec(sc.src), el = document.getElementById('appVer'); if (el && m) el.textContent = `Version ${m[1].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')} ${m[2].replace(/(\d{2})(\d{2})/, '$1:$2')}`; } catch (e) { /* cosmetic */ }
  try { const m = sessionStorage.getItem('lifeos.toast'); if (m) { sessionStorage.removeItem('lifeos.toast'); setTimeout(() => toast(m), 300); } } catch (e) { /* storage unavailable */ }
  const ctx = {
    get state() { return state; }, S, U, P, F, ROUTES, ACTS, DEFAULTS, esc, today, todayISO, ws, get, commit, render, toast, opts, chk, ta, inp, page, goalOpts, lifeOpts, schedBtn, dragAttr,
    fmtTime, hhmm24, openScheduleDialog, addScheduleItem, suggestSlot, nextStep, focusGoals, cycleGoals, currentCycle, areaName, roleName, showText, getWeek, quarterKey, weekSel,
    undo, redo, trashItem, trashLabel, sendNotification, progressBar, weekText, monthText, balanceStrip, goalDomain, history: hist,
  };
  if (window.LifeFeatures) window.LifeFeatures(ctx);
  render();
  checkNotifications();
  syncNow();
})();
