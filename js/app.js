/* Life.OS — application: router, views and interactions. */
(function () {
  'use strict';
  const U = window.LifeUtil;
  const S = window.LifeStore;
  const AREAS = S.AREAS;

  let state = S.load();
  const app = document.getElementById('app');

  /* ---------- basics ---------- */
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
      <div class="grid2">
        <section class="box">
          <h2>Today's plan <a class="more" href="#/week/${wk}">Schedule →</a></h2>
          ${todayEvents.length ? `<ul class="events">${todayEvents.map((e) => `<li><time>All day</time> ${esc(e.text)}</li>`).join('')}</ul>` : ''}
          ${todaySched.length ? `<ul class="events">${todaySched.map((s) => `<li><time>${esc(fmtTime(s.time)) || '—'}</time> ${esc(s.text)}</li>`).join('')}</ul>` : ''}
          ${todayWos.length ? `<ul class="checks compact">${todayWos.map((x) => `<li>${chk(`workouts.@${x.id}.done`, 'Workout done')}<span class="grow">Workout: ${esc(x.type)}${x.details ? ` <small class="muted">${esc(x.details)}</small>` : ''}</span></li>`).join('')}</ul>` : ''}
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
        <input class="inline measure" data-bind="${p}.measure" value="${esc(g.measure)}" placeholder="What does done look like? (be specific)">
      </div>`;
    };
    const addGoal = (roleId) => `<form class="add" data-add="goals">
        <input type="hidden" name="cycleId" value="${cyc.id}"><input type="hidden" name="roleId" value="${roleId}">
        <input name="title" placeholder="New goal…" required>
        <select name="area" aria-label="Area">${areaOpts('work')}</select>
        <select name="tier" aria-label="Tier">${tierOpts('pursuit')}</select>
        <button aria-label="Add goal">+</button></form>`;

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
  function lineChart(pts, target, unit) {
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
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight trend, ${pts.length} entries">
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
    const tabs = [['weight', 'Weight'], ['workouts', 'Workouts'], ['habits', 'Habits'], ['goals', 'Goal progress']];
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
          <a class="btn ghost" href="#/week">Plan this week's workouts →</a></div></section>
        <div class="grid2">
          <section class="box"><h2>By type</h2>${Object.keys(byType).length ? `<ul class="habit-sum">${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<li><span>${esc(t)}</span><span>${n}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing logged yet.</p>'}</section>
          <section class="box"><h2>Recent</h2>${done.length ? `<table class="index"><tbody>${done.slice(0, 15).map((x) => `<tr><td>${U.fmtDate(x.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td><td>${esc(x.type)}</td><td class="muted">${esc(x.details)}</td><td>${x.minutes ? `${x.minutes} min` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Check off workouts on the Week page and they appear here.</p>'}</section>
        </div>`;
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
      body += `<section class="box"><h2>Habit history <small class="muted">last 8 weeks · cells show days done / weekly goal</small></h2>
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
    const body = `
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
    goals: () => ({ area: 'work', tier: 'pursuit', progress: 0, status: 'active', target: '', doneBy: '', measure: '' }),
    actions: () => ({ done: false, goalId: '' }),
    habits: () => ({ target: 5, days: [false, false, false, false, false, false, false] }),
    shopping: () => ({ done: false }),
    steps: () => ({ done: false }),
    schedule: () => ({ time: '' }),
    workouts: () => ({ done: false, details: '', minutes: '' }),
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
      open.forEach((g) => state.goals.push({ ...g, id: S.uid(), cycleId: nc.id, carriedFrom: g.id }));
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
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('[data-nav]')) { location.hash = el.value; return; }
    if (el.matches('[data-import]')) { importFile(el.files[0]); return; }
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

  /* ---------- router ---------- */
  const ROUTES = {
    today: viewToday, foundation: viewFoundation, goals: viewGoals, year: viewYear,
    month: viewMonth, week: viewWeek, track: viewTrack, lists: viewLists, settings: viewSettings,
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
  window.addEventListener('hashchange', render);
  window.addEventListener('storage', (e) => { if (e.key === S.KEY) { state = S.load(); render(); } });
  document.getElementById('copyBtn').addEventListener('click', () => ACTS.copyDlg());
  render();
  checkNotifications();
})();
