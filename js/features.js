/* Telos — features plugin: unified tasks, recurrence, rollover, search, shortcuts, templates,
   review summaries, print layouts, archive/trash and reminders. Loaded before app.js, which calls
   window.LifeFeatures(ctx) once everything it shares is ready. */
window.LifeFeatures = function (c) {
  'use strict';
  const { S, U, P, F, esc, ACTS, ROUTES } = c;
  const st = () => c.state;
  const T = () => st().tasks;
  const iso0 = () => c.todayISO();
  const plus = (iso, n) => U.toISO(U.addDays(U.parseISO(iso), n));
  const tomorrow = () => plus(iso0(), 1);
  const PRI = { high: 'High', med: 'Medium', low: 'Low' };
  const PRI_ORDER = { high: 0, med: 1, low: 2, '': 3 };
  const fmt = (d, o) => U.fmtDate(d, o || { weekday: 'short', month: 'short', day: 'numeric' });
  const $ = (sel, root) => (root || document).querySelector(sel);
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

  /* ===================================================================== tasks ===== */
  const isOpen = (t) => t.status !== 'done' && !t.archived;
  const when = (t) => t.day || t.due || '';
  const mkTask = (o) => Object.assign({ id: S.uid(), title: '', notes: '', status: 'next', due: '', day: '', time: '', mins: 30, priority: '', project: '', tags: [], goalId: '', area: '', subtasks: [], recur: null, remind: '', waitingOn: '', created: iso0(), doneAt: '', archived: false }, o);
  const byId = (id) => T().find((t) => t.id === id);
  const sortTasks = (a, b) => (a.due || a.day || '9999') < (b.due || b.day || '9999') ? -1 : (a.due || a.day || '9999') > (b.due || b.day || '9999') ? 1
    : PRI_ORDER[a.priority || ''] - PRI_ORDER[b.priority || ''] || (a.time || '99') .localeCompare(b.time || '99') || (a.created || '').localeCompare(b.created || '');
  const openTasks = () => T().filter((t) => isOpen(t) && t.status === 'next').sort(sortTasks);
  const onPlate = (t, iso) => isOpen(t) && t.status !== 'waiting' && t.status !== 'someday' && (t.day === iso || (!t.day && t.due === iso));
  const isLate = (t, iso) => isOpen(t) && t.status !== 'waiting' && t.status !== 'someday' && ((t.day && t.day < iso) || (!t.day && t.due && t.due < iso));
  const tasksOn = (iso) => T().filter((t) => onPlate(t, iso)).sort(sortTasks);
  const lateTasks = (iso) => T().filter((t) => isLate(t, iso)).sort(sortTasks);

  function addFromText(text, extra, refocus) {
    const q = P.parseQuick(text, iso0());
    const t = mkTask(Object.assign({ title: q.title || text, due: q.due, priority: q.priority, tags: q.tags, project: q.project, status: q.status, recur: q.recur }, extra || {}));
    if (q.due && extra && extra.day) t.day = '';
    T().push(t);
    c.commit();
    c.toast(`Added “${t.title.slice(0, 40)}”${t.due ? ` · due ${fmt(t.due)}` : ''}`, { label: 'Undo', fn: c.undo });
    if (refocus) { const again = $('form[data-tform=add] input[name=text]'); if (again) again.focus(); }
    return t;
  }
  function spawnNext(t) {
    if (!t.recur) return null;
    const today = iso0();
    let nd = P.nextDue(t.recur, t.due || t.day || today, today);
    for (let i = 0; nd && nd <= today && t.recur.mode !== 'after' && i < 400; i++) nd = P.nextDue(t.recur, nd, today);
    if (!nd) return null;
    const n = mkTask(Object.assign({}, JSON.parse(JSON.stringify(t)), { id: S.uid(), status: 'next', due: nd, day: '', doneAt: '', created: today, rolled: 0, origDue: '', archived: false }));
    n.subtasks = n.subtasks.map((x) => ({ id: S.uid(), text: x.text, done: false }));
    T().push(n);
    return n;
  }
  function completeTask(t) {
    if (t.status === 'done') { t.status = 'next'; t.doneAt = ''; return null; }
    t.status = 'done'; t.doneAt = iso0();
    (t.subtasks || []).forEach((s) => { s.done = true; });
    return spawnNext(t);
  }
  const dueLabel = (t) => {
    const d = t.due || t.day, today = iso0();
    if (!d) return '';
    const diff = U.daysBetween(U.parseISO(today), U.parseISO(d));
    const base = d === today ? 'Today' : d === tomorrow() ? 'Tomorrow' : diff < 0 ? `${-diff}d overdue` : diff < 7 ? fmt(d, { weekday: 'long' }) : fmt(d, { month: 'short', day: 'numeric' });
    return `${t.due ? 'Due ' : 'On '}${base}${t.time ? ` ${c.fmtTime(t.time)}` : ''}`;
  };
  function chips(t, o) {
    const out = [], today = iso0();
    const d = t.due || t.day;
    if (d && !(o && o.noDue)) out.push(`<span class="tchip due${isLate(t, today) ? ' late' : ''}${d === today ? ' now' : ''}">${esc(dueLabel(t))}</span>`);
    if (t.priority) out.push(`<span class="tchip pri-${t.priority}" title="${PRI[t.priority]} priority">${t.priority === 'high' ? '!!!' : t.priority === 'med' ? '!!' : '!'}</span>`);
    if (t.status === 'waiting') out.push(`<span class="tchip wait">⏳ ${esc(t.waitingOn || 'waiting')}</span>`);
    if (t.status === 'someday') out.push('<span class="tchip">someday</span>');
    if (t.recur) out.push(`<span class="tchip rep" title="${esc(P.recurLabel(t.recur))}">↻ ${esc(P.recurLabel(t.recur))}</span>`);
    if (t.project && !(o && o.noProject)) out.push(`<span class="tchip proj">+${esc(t.project)}</span>`);
    (t.tags || []).forEach((g) => out.push(`<span class="tchip tag">#${esc(g)}</span>`));
    if ((t.subtasks || []).length) out.push(`<span class="tchip">☑ ${t.subtasks.filter((x) => x.done).length}/${t.subtasks.length}</span>`);
    if (t.goalId) { const g = st().goals.find((x) => x.id === t.goalId); if (g) out.push(`<span class="tchip goal">★ ${esc(g.title.slice(0, 32))}</span>`); }
    if (t.remind) out.push('<span class="tchip" title="Reminder set">🔔</span>');
    return out.join('');
  }
  function row(t, o) {
    o = o || {};
    const drag = `draggable="true" data-drag="${esc(JSON.stringify({ text: t.title, mins: Number(t.mins) || 30, taskId: t.id }))}"`;
    return `<div class="trow${t.status === 'done' ? ' done' : ''}${o.late ? ' late' : ''} ${t.priority ? `p-${t.priority}` : ''}" ${drag}>
      <input type="checkbox" data-act="taskDone" data-id="${t.id}" ${t.status === 'done' ? 'checked' : ''} aria-label="Done: ${esc(t.title)}">
      <div class="tmain"><button type="button" class="ttitle" data-act="taskEdit" data-id="${t.id}">${esc(t.title) || '(untitled)'}</button><span class="tchips">${chips(t, o)}</span></div>
      <span class="tact">${t.status === 'done' ? '' : `${t.recur && o.late ? `<button type="button" class="x" data-act="taskSkip" data-id="${t.id}" title="Skip this one">⤼</button>` : ''}${c.schedBtn(t.title, t.mins)}<button type="button" class="x" data-act="taskPush" data-id="${t.id}" title="Move to tomorrow" aria-label="Move to tomorrow">›</button>`}</span></div>`;
  }
  const quickAdd = (day, ph, goalId) => `<form class="add tadd" data-tform="add" data-day="${esc(day || '')}" data-goal="${esc(goalId || '')}"><input name="text" placeholder="${esc(ph || 'Add a task… try “Call dentist friday !high #health”')}" required aria-label="New task"><button aria-label="Add task">+</button></form>`;

  Object.assign(F, {
    addFromText, quickAdd, openTasks,
    newTask: (o) => { const t = mkTask(o); T().push(t); return t; },
    plannerTasks: (iso) => T().filter((t) => isOpen(t) && t.status === 'next' && when(t) === iso).sort(sortTasks),
    poolTasks: (iso) => openTasks().filter((t) => !t.day && (!t.due || t.due > iso)).slice(0, 8),
    dayTasks: (iso, compact) => {
      const late = iso === iso0() ? lateTasks(iso) : [], mine = tasksOn(iso);
      return (late.length ? `<h4 class="tl-h">Overdue</h4>${late.map((t) => row(t, { late: true })).join('')}` : '')
        + (mine.length ? `${late.length && !compact ? '<h4 class="tl-h">Today</h4>' : ''}${mine.map((t) => row(t)).join('')}` : '');
    },
    snapshotTasks: (iso) => (iso === iso0() ? lateTasks(iso) : []).concat(tasksOn(iso)).map((t) => t.title),
    dayTasksCount: (iso) => tasksOn(iso).length + (iso === iso0() ? lateTasks(iso).length : 0),
    dayTasksDone: (iso, mine) => {
      const dayDone = T().filter((t) => t.status === 'done' && (t.doneAt === iso || t.day === iso)).length, total = tasksOn(iso).length + dayDone + mine.length;
      return `${dayDone + mine.filter((t) => t.done).length}/${total} done`;
    },
    stripTasks: (iso) => { const l = tasksOn(iso); return l.length ? `<div class="strip-tasks">${l.slice(0, 4).map((t) => `<div class="ev task${t.priority === 'high' ? ' hi' : ''}" draggable="true" data-drag="${esc(JSON.stringify({ text: t.title, mins: Number(t.mins) || 30, taskId: t.id }))}" title="${esc(t.title)}">☐ ${esc(t.title)}</div>`).join('')}${l.length > 4 ? `<small class="muted">+${l.length - 4} more</small>` : ''}</div>` : ''; },
    monthTasks: (iso) => { const l = tasksOn(iso); return l.length ? `${l.slice(0, 2).map((t) => `<div class="ev task" title="${esc(t.title)}"><span>☐ ${esc(t.title)}</span></div>`).join('')}${l.length > 2 ? `<div class="ev task"><span>+${l.length - 2} tasks</span></div>` : ''}` : ''; },
    timelineTasks: (iso) => ({
      timed: T().filter((t) => isOpen(t) && when(t) === iso && t.time).map((t) => ({ cls: `task${t.priority === 'high' ? ' hi' : ''}`, time: t.time, mins: Number(t.mins) || 30, html: `<input type="checkbox" data-act="taskDone" data-id="${t.id}" aria-label="Done: ${esc(t.title)}"> <button type="button" class="ttl" data-act="taskEdit" data-id="${t.id}">${esc(t.title)}</button>`, tip: t.title })),
      anytime: [],
    }),
    goalTasks: (g) => {
      const list = T().filter((t) => t.goalId === g.id && isOpen(t)).sort(sortTasks), done = T().filter((t) => t.goalId === g.id && t.status === 'done').length;
      return `<details class="goal-tasks" data-keep="gt-${g.id}"><summary>Tasks <span class="muted">· ${list.length} open${done ? `, ${done} done` : ''}</span></summary>
        ${list.map((t) => row(t, { noDue: false })).join('')}${quickAdd('', 'Add a task for this goal…', g.id)}</details>`;
    },
    rolloverBar: (iso) => {
      const n = rollCount(iso);
      if (iso !== iso0()) return '';
      return n ? `<div class="rollover"><span><strong>${n}</strong> unfinished item${n === 1 ? '' : 's'} from today or earlier.</span> <button type="button" class="btn small" data-act="rollover">Move undone to tomorrow</button> <small class="muted">Repeating tasks and habits stay put.</small></div>` : '';
    },
  });

  /* ---- rollover: everything undone moves to tomorrow (repeating tasks and habits do not roll) ---- */
  function plannedActions(iso) {
    const out = [];
    Object.values(st().weeks).forEach((w) => [...(w.actions || []), ...(w.top3 || [])].forEach((a) => { if (a.day && a.day <= iso && !a.done) out.push(a); }));
    Object.values(st().months).forEach((m) => (m.actions || []).forEach((a) => { if (a.day && a.day <= iso && !a.done) out.push(a); }));
    return out;
  }
  const bigUndone = (iso) => st().big3.filter((b) => b.date <= iso && !b.done && !b.migrated);
  const rollCount = (iso) => T().filter((t) => P.rollable(t, iso)).length + plannedActions(iso).length + bigUndone(iso).length;
  ACTS.rollover = () => {
    const today = iso0(), target = tomorrow();
    let n = P.rollTasks(T(), today, target);
    plannedActions(today).forEach((a) => { a.day = target; n++; });
    bigUndone(today).forEach((b) => { b.migrated = true; st().big3.push({ id: S.uid(), date: target, text: b.text, goalId: b.goalId, stepRef: b.stepRef, done: false }); n++; });
    c.commit(); c.toast(n ? `Moved ${n} item${n === 1 ? '' : 's'} to tomorrow` : 'Nothing to move', n ? { label: 'Undo', fn: c.undo } : null);
  };

  /* ---- task actions ---- */
  ACTS.taskDone = (el) => {
    const t = byId(el.dataset.id); if (!t) return;
    const was = t.status === 'done', nxt = completeTask(t);
    c.commit();
    c.toast(was ? 'Reopened' : nxt ? `Done ✓ Next: ${fmt(nxt.due)}` : 'Done ✓', { label: 'Undo', fn: c.undo });
  };
  ACTS.taskEdit = (el) => openTask(el.dataset.id);
  ACTS.taskNew = () => openTask(null, { day: '' });
  ACTS.taskPush = (el) => { const t = byId(el.dataset.id); if (!t) return; t.day = tomorrow(); if (t.due && t.due < t.day) t.due = t.day; c.commit(); c.toast('Moved to tomorrow', { label: 'Undo', fn: c.undo }); };
  ACTS.taskAssign = (el) => { const t = byId(el.dataset.id); if (t) { t.day = el.dataset.day; c.commit(); } };
  ACTS.taskSkip = (el) => {
    const t = byId(el.dataset.id); if (!t || !t.recur) return;
    let nd = P.nextDue(t.recur, t.due || t.day, iso0());
    for (let i = 0; nd && nd <= iso0() && i < 400; i++) nd = P.nextDue(t.recur, nd, iso0());
    if (nd) { t.due = nd; t.day = ''; t.skipped = (t.skipped || 0) + 1; c.commit(); c.toast(`Skipped. Next: ${fmt(nd)}`, { label: 'Undo', fn: c.undo }); }
  };
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (!f.dataset || f.dataset.tform !== 'add') return;
    e.preventDefault();
    const text = String(new FormData(f).get('text') || '').trim(); if (!text) return;
    addFromText(text, { day: f.dataset.day || '', goalId: f.dataset.goal || '' }, true);
  });

  /* ---- drag and drop: onto a day (plans it) or a time slot (time-blocks it) ---- */
  F.dropTaskOnSlot = (taskId, date, time) => {
    const t = byId(taskId); if (!t) return false;
    t.day = date; t.time = time; return true;
  };
  document.addEventListener('dragover', (e) => {
    const day = e.target.closest && e.target.closest('[data-dropday]');
    if (!day) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    document.querySelectorAll('[data-dropday].drop').forEach((x) => { if (x !== day) x.classList.remove('drop'); });
    day.classList.add('drop');
  });
  document.addEventListener('dragleave', (e) => { const d = e.target.closest && e.target.closest('[data-dropday]'); if (d && !d.contains(e.relatedTarget)) d.classList.remove('drop'); });
  document.addEventListener('drop', (e) => {
    const day = e.target.closest && e.target.closest('[data-dropday]');
    document.querySelectorAll('[data-dropday].drop').forEach((x) => x.classList.remove('drop'));
    if (!day) return;
    e.preventDefault(); e.stopPropagation();
    let d; try { d = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
    if (!d || !d.text) return;
    const iso = day.dataset.dropday;
    if (d.taskId && byId(d.taskId)) { const t = byId(d.taskId); t.day = iso; t.time = ''; }
    else T().push(mkTask({ title: d.text, day: iso }));
    c.commit(); c.toast(`Planned for ${fmt(iso)}`, { label: 'Undo', fn: c.undo });
  }, true);

  /* ---- task editor ---- */
  const dlg = document.createElement('dialog'); dlg.id = 'taskDlg'; dlg.className = 'wide';
  document.body.appendChild(dlg);
  let editing = null, working = null;
  const goalChoices = () => { const cyc = c.currentCycle(); return [{ v: '', l: '— no goal —' }].concat(st().goals.filter((g) => g.status === 'active' && (!cyc || g.cycleId === cyc.id)).map((g) => ({ v: g.id, l: g.title }))); };
  function openTask(id, defaults) {
    editing = id ? byId(id) : null;
    working = editing ? JSON.parse(JSON.stringify(editing)) : mkTask(defaults || {});
    drawTask(); dlg.showModal();
    const ti = $('input[name=title]', dlg); if (ti && !editing) ti.focus();
  }
  function drawTask() {
    const t = working, r = t.recur || { freq: '' };
    const projects = [...new Set(T().map((x) => x.project).filter(Boolean))];
    const dows = r.dows || [];
    dlg.innerHTML = `<form id="taskForm" method="dialog">
      <h2>${editing ? 'Edit task' : 'New task'}</h2>
      <label class="field">Task <input name="title" required value="${esc(t.title)}" placeholder="What needs doing?"></label>
      <div class="row">
        <label>Status <select name="status">${c.opts(Object.entries({ next: 'Next', waiting: 'Waiting for…', someday: 'Someday / maybe', done: 'Done' }).map(([v, l]) => ({ v, l })), t.status)}</select></label>
        <label>Priority <select name="priority">${c.opts([{ v: '', l: 'None' }, { v: 'high', l: 'High' }, { v: 'med', l: 'Medium' }, { v: 'low', l: 'Low' }], t.priority)}</select></label>
        <label class="grow" ${t.status === 'waiting' ? '' : 'hidden'} data-wait>Waiting on <input name="waitingOn" value="${esc(t.waitingOn)}" placeholder="Who or what?"></label>
      </div>
      <div class="row">
        <label>Due <input type="date" name="due" value="${esc(t.due)}"></label>
        <label>Plan for day <input type="date" name="day" value="${esc(t.day)}"></label>
        <label>Time <input type="time" name="time" step="900" value="${esc(t.time)}"></label>
        <label>Length <select name="mins">${c.opts([15, 30, 45, 60, 90, 120, 180, 240].map((n) => ({ v: n, l: n >= 60 ? `${n / 60} hr` : `${n} min` })), Number(t.mins) || 30)}</select></label>
      </div>
      <div class="row">
        <label class="grow">Project <input name="project" list="projList" value="${esc(t.project)}" placeholder="e.g. Taxes"></label>
        <label class="grow">Tags <input name="tags" value="${esc((t.tags || []).join(', '))}" placeholder="home, errands"></label>
        <label class="grow">Goal <select name="goalId">${c.opts(goalChoices(), t.goalId)}</select></label>
      </div>
      <datalist id="projList">${projects.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
      <label class="field">Notes <textarea name="notes" rows="2">${esc(t.notes)}</textarea></label>
      <fieldset class="subs"><legend>Subtasks</legend>
        ${(t.subtasks || []).map((s, i) => `<div class="row sub"><input type="checkbox" data-sub-done="${i}" ${s.done ? 'checked' : ''} aria-label="Subtask done"><input class="inline grow" data-sub-text="${i}" value="${esc(s.text)}"><button type="button" class="x" data-sub-del="${i}" aria-label="Remove subtask">×</button></div>`).join('')}
        <div class="row"><input id="subNew" class="grow" placeholder="Add a subtask and press Enter"><button type="button" class="btn ghost small" id="subAdd">Add</button></div></fieldset>
      <fieldset class="subs"><legend>Repeat</legend>
        <div class="row"><label>Repeats <select name="rfreq">${c.opts([{ v: '', l: 'Does not repeat' }, { v: 'daily', l: 'Daily' }, { v: 'weekly', l: 'Weekly' }, { v: 'monthly', l: 'Monthly' }, { v: 'yearly', l: 'Yearly' }], r.freq || '')}</select></label>
          <label data-rec ${r.freq ? '' : 'hidden'}>Every <input type="number" name="revery" min="1" max="99" value="${Number(r.every) || 1}" class="num"></label>
          <label data-rec ${r.freq ? '' : 'hidden'}>Counting from <select name="rmode">${c.opts([{ v: 'fixed', l: 'the schedule' }, { v: 'after', l: 'when I finish it' }], r.mode || 'fixed')}</select></label>
          <label data-rec ${r.freq ? '' : 'hidden'}>Until <input type="date" name="runtil" value="${esc(r.until || '')}"></label></div>
        <div class="row" data-recw ${r.freq === 'weekly' ? '' : 'hidden'}>${U.DAYS.map((d, i) => `<label class="inline-check"><input type="checkbox" name="rdow" value="${i}" ${dows.includes(i) ? 'checked' : ''}> ${d.slice(0, 3)}</label>`).join('')}</div>
        <div class="row" data-recm ${r.freq === 'monthly' ? '' : 'hidden'}><label>On day <input type="number" name="rdom" min="1" max="31" value="${Number(r.dom) || ''}" class="num" placeholder="of month"></label></div>
        <p class="muted small">Repeating tasks create the next one when you finish this one. They never roll over to tomorrow; skip one with ⤼.</p></fieldset>
      <div class="row"><label>Reminder <select name="remind">${c.opts([{ v: '', l: 'None' }, { v: 'time', l: 'At the time' }, { v: '10', l: '10 minutes before' }, { v: '60', l: '1 hour before' }, { v: '1440', l: '1 day before' }, { v: 'morning', l: 'Morning of the day' }], t.remind || '')}</select></label>
        <span class="muted small grow">Reminders need a due date or day. Turn on notifications in Settings.</span></div>
      <div class="row end">
        ${editing ? '<button type="button" class="btn ghost" id="tkDel">Delete</button><button type="button" class="btn ghost" id="tkDup">Duplicate</button><button type="button" class="btn ghost" id="tkSched">Put on calendar</button>' : ''}
        <span class="grow"></span><button type="button" class="btn ghost" id="tkCancel">Cancel</button><button class="btn primary">Save</button></div>
    </form>`;
  }
  function readForm() {
    const f = $('#taskForm', dlg), fd = new FormData(f), t = working;
    ['title', 'notes', 'project', 'waitingOn', 'due', 'day', 'time', 'priority', 'status', 'goalId', 'remind'].forEach((k) => { t[k] = String(fd.get(k) || '').trim(); });
    t.mins = Number(fd.get('mins')) || 30;
    t.tags = String(fd.get('tags') || '').split(/[,\s]+/).map((x) => x.replace(/^#/, '').toLowerCase()).filter(Boolean);
    const freq = String(fd.get('rfreq') || '');
    t.recur = freq ? { freq, every: Math.max(1, Number(fd.get('revery')) || 1), mode: fd.get('rmode') || 'fixed', until: fd.get('runtil') || '', dows: fd.getAll('rdow').map(Number), dom: Number(fd.get('rdom')) || 0 } : null;
    if (t.recur && t.recur.freq === 'weekly' && !t.recur.dows.length) t.recur.dows = [U.parseISO(t.due || t.day || iso0()).getDay()];
    if (t.recur && !t.due && !t.day) t.due = iso0();
    (t.subtasks || []).forEach((s, i) => { const tx = $(`[data-sub-text="${i}"]`, dlg), dn = $(`[data-sub-done="${i}"]`, dlg); if (tx) s.text = tx.value.trim(); if (dn) s.done = dn.checked; });
    t.subtasks = (t.subtasks || []).filter((s) => s.text);
    if (t.status === 'done' && !t.doneAt) t.doneAt = iso0(); if (t.status !== 'done') t.doneAt = '';
    return t;
  }
  dlg.addEventListener('click', (e) => {
    const sd = e.target.closest('[data-sub-del]');
    if (sd) { readForm(); working.subtasks.splice(Number(sd.dataset.subDel), 1); drawTask(); return; }
    if (e.target.id === 'subAdd') { addSub(); return; }
    if (e.target.id === 'tkCancel') { dlg.close(); return; }
    if (e.target.id === 'tkDel') {
      const t = editing; dlg.close(); const i = T().indexOf(t);
      if (i >= 0) { T().splice(i, 1); c.trashItem('tasks', t); c.commit(); c.toast('Task deleted', { label: 'Undo', fn: c.undo }); }
      return;
    }
    if (e.target.id === 'tkDup') { readForm(); const cp = mkTask(Object.assign({}, JSON.parse(JSON.stringify(working)), { id: S.uid(), status: 'next', doneAt: '', created: iso0() })); T().push(cp); dlg.close(); c.commit(); c.toast('Duplicated'); return; }
    if (e.target.id === 'tkSched') { readForm(); const t = working; dlg.close(); c.openScheduleDialog({ text: t.title, date: t.day || t.due || iso0(), mins: t.mins }); }
  });
  function addSub() { const i = $('#subNew', dlg); if (!i || !i.value.trim()) return; readForm(); working.subtasks.push({ id: S.uid(), text: i.value.trim(), done: false }); drawTask(); const n = $('#subNew', dlg); if (n) n.focus(); }
  dlg.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'subNew') { e.preventDefault(); addSub(); } });
  dlg.addEventListener('change', (e) => {
    if (e.target.name === 'status') { const w = $('[data-wait]', dlg); if (w) w.hidden = e.target.value !== 'waiting'; }
    if (e.target.name === 'rfreq') {
      const v = e.target.value;
      dlg.querySelectorAll('[data-rec]').forEach((x) => { x.hidden = !v; });
      const w = $('[data-recw]', dlg), m = $('[data-recm]', dlg); if (w) w.hidden = v !== 'weekly'; if (m) m.hidden = v !== 'monthly';
    }
  });
  dlg.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = readForm(); if (!t.title) return;
    if (editing) { const i = T().indexOf(editing); const wasDone = editing.status === 'done'; if (i >= 0) T()[i] = t; if (!wasDone && t.status === 'done') spawnNext(t); }
    else { T().push(t); }
    dlg.close(); c.commit(); c.toast('Saved');
  });

  /* ---- Tasks page ---- */
  const tf = { project: '', tag: '', q: '' };
  const TABS = [['today', 'Today'], ['next', 'Next'], ['waiting', 'Waiting'], ['someday', 'Someday'], ['upcoming', 'Upcoming'], ['done', 'Done']];
  function matches(t) {
    if (tf.project && t.project !== tf.project) return false;
    if (tf.tag && !(t.tags || []).includes(tf.tag)) return false;
    if (tf.q) { const hay = [t.title, t.notes, t.project, (t.tags || []).join(' '), t.waitingOn].join(' ').toLowerCase(); if (!tf.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false; }
    return true;
  }
  function listFor(tab) {
    const today = iso0(), all = T().filter(matches);
    if (tab === 'today') return all.filter((t) => onPlate(t, today) || isLate(t, today)).sort(sortTasks);
    if (tab === 'next') return all.filter((t) => isOpen(t) && t.status === 'next').sort(sortTasks);
    if (tab === 'waiting') return all.filter((t) => isOpen(t) && t.status === 'waiting').sort(sortTasks);
    if (tab === 'someday') return all.filter((t) => isOpen(t) && t.status === 'someday').sort(sortTasks);
    if (tab === 'upcoming') return all.filter((t) => isOpen(t) && t.status === 'next' && when(t) > today).sort(sortTasks);
    return all.filter((t) => t.status === 'done' && !t.archived).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  }
  const bucketOf = (t) => {
    const d = when(t), today = iso0();
    if (!d) return '0 No date';
    if (isLate(t, today)) return '1 Overdue';
    if (d === today) return '2 Today';
    if (d === tomorrow()) return '3 Tomorrow';
    if (d <= plus(today, 7)) return '4 This week';
    return '5 Later';
  };
  function viewTasks(arg) {
    const tab = TABS.some((x) => x[0] === arg) ? arg : (st().settings.tasksTab || 'today');
    if (st().settings.tasksTab !== tab) st().settings.tasksTab = tab;
    const today = iso0(), counts = {};
    TABS.forEach(([k]) => { counts[k] = k === 'done' ? 0 : listFor(k).length; });
    const list = listFor(tab);
    const projects = [...new Set(T().filter(isOpen).map((t) => t.project).filter(Boolean))].sort();
    const tags = [...new Set(T().filter(isOpen).flatMap((t) => t.tags || []))].sort();
    let groups;
    if (tab === 'next' || tab === 'upcoming' || tab === 'today') {
      const g = {}; list.forEach((t) => { (g[bucketOf(t)] = g[bucketOf(t)] || []).push(t); });
      groups = Object.keys(g).sort((a, b) => (tab === 'next' ? ((a[0] === '0' ? '9' : a[0]) < (b[0] === '0' ? '9' : b[0]) ? -1 : 1) : (a < b ? -1 : 1))).map((k) => [k.slice(2), g[k]]);
      if (tab === 'today') groups = groups.filter(([, l]) => l.length);
    } else groups = list.length ? [['', list]] : [];
    const projCard = tf.project ? (() => {
      const all = T().filter((t) => t.project === tf.project), done = all.filter((t) => t.status === 'done').length;
      return `<div class="proj-head"><strong>+${esc(tf.project)}</strong> ${c.progressBar(all.length ? (done / all.length) * 100 : 0)} <small>${done}/${all.length}</small>
        <button type="button" class="btn ghost small" data-act="tplFromProject" data-project="${esc(tf.project)}">Save as template</button></div>`;
    })() : '';
    const body = `${quickAdd('', 'Add a task… try “Call dentist friday !high #health +Admin” or “Pay rent monthly on the 1st”')}
      <div class="chips ttabs" role="tablist">${TABS.map(([k, l]) => `<a class="chip${k === tab ? ' on' : ''}" role="tab" aria-selected="${k === tab}" href="#/tasks/${k}">${l}${k !== 'done' && counts[k] ? ` <b>${counts[k]}</b>` : ''}</a>`).join('')}</div>
      <div class="tfilters row">
        <input id="tfq" type="search" value="${esc(tf.q)}" placeholder="Filter this list…" aria-label="Filter tasks">
        <select data-tf="project" aria-label="Project"><option value="">All projects</option>${projects.map((p) => `<option ${tf.project === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
        <select data-tf="tag" aria-label="Tag"><option value="">All tags</option>${tags.map((p) => `<option ${tf.tag === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
        ${tf.project || tf.tag || tf.q ? '<button type="button" class="btn ghost small" data-act="tfClear">Clear</button>' : ''}</div>
      ${projCard}
      ${tab === 'today' ? F.rolloverBar(today) : ''}
      ${groups.length ? groups.map(([h, l]) => `<section class="box tgroup">${h ? `<h3>${esc(h)} <small class="muted">${l.length}</small></h3>` : ''}${l.map((t) => row(t, { late: h === 'Overdue', noProject: !!tf.project })).join('')}</section>`).join('')
        : `<section class="box"><p class="muted">${tab === 'today' ? (window.TelosCopy ? window.TelosCopy.empty.tasksToday : 'Nothing on your plate for today.') : tab === 'done' ? 'Finished tasks appear here.' : 'Nothing here.'}</p></section>`}
      ${tab === 'done' ? '<p class="muted small"><a href="#/archive">Older finished tasks and deleted items are in the Archive →</a></p>' : ''}
      <p class="muted small">Tips: press <kbd>n</kbd> to add a task from anywhere, <kbd>/</kbd> to search, <kbd>?</kbd> for all shortcuts. Drag a task onto a day in the Week view, or onto a time on the calendar.</p>`;
    return c.page(window.TelosCopy ? window.TelosCopy.label('tasks') : 'Tasks', 'One list for everything you need to do', body,
      '<button class="btn ghost" data-act="tplOpen">From template</button> <button class="btn ghost" data-act="tasksCsv">Export CSV</button> <button class="btn primary" data-act="taskNew">New task</button>');
  }
  ROUTES.tasks = viewTasks;
  ACTS.tfClear = () => { tf.project = tf.tag = tf.q = ''; c.render(); };
  document.addEventListener('change', (e) => { const k = e.target.dataset && e.target.dataset.tf; if (k) { tf[k] = e.target.value; c.render(); } });
  let tfTimer;
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'tfq') return;
    tf.q = e.target.value; clearTimeout(tfTimer);
    tfTimer = setTimeout(() => { c.render(); const i = $('#tfq'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 200);
  });
  ACTS.tasksCsv = () => {
    const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = [['title', 'status', 'priority', 'due', 'planned day', 'time', 'project', 'tags', 'repeat', 'notes', 'done on'].join(',')]
      .concat(T().map((t) => [t.title, t.status, t.priority, t.due, t.day, t.time, t.project, (t.tags || []).join(' '), P.recurLabel(t.recur), t.notes, t.doneAt].map(cell).join(',')));
    download(`lifeos-tasks-${iso0()}.csv`, rows.join('\n'), 'text/csv');
  };
  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: `${type || 'text/plain'};charset=utf-8` })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* auto-archive tasks finished more than 30 days ago (kept in the Archive, out of your lists) */
  (function autoArchive() {
    const cutoff = plus(iso0(), -30); let n = 0;
    T().forEach((t) => { if (t.status === 'done' && !t.archived && t.doneAt && t.doneAt < cutoff) { t.archived = true; n++; } });
    if (n) S.save(st());
  })();

  /* ============================================================ archive & trash ===== */
  function viewArchive() {
    const trash = (st().trash || []).slice().reverse();
    const arch = T().filter((t) => t.archived).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
    const closed = st().goals.filter((g) => g.status === 'done' || g.status === 'dropped');
    const body = `<p class="lead">Nothing you delete is gone right away. Deleted items stay here for 60 days, and finished work is kept. You can also press <kbd>Ctrl/⌘ Z</kbd> to undo the last change.</p>
      <section class="box"><h2>Recently deleted <span class="muted">· ${trash.length}</span>${trash.length ? '<button class="btn ghost small" data-act="trashEmpty" style="margin-left:auto">Empty</button>' : ''}</h2>
        ${trash.length ? `<ul class="checks compact">${trash.slice(0, 100).map((x) => `<li><span class="grow"><strong>${esc(x.label || '(item)')}</strong> <small class="muted">${esc(pathLabel(x.path))} · deleted ${fmt(x.at, { month: 'short', day: 'numeric' })}</small></span>
          <button class="btn ghost small" data-act="trashRestore" data-id="${x.id}">Restore</button><button class="x" data-act="trashPurge" data-id="${x.id}" aria-label="Delete forever" title="Delete forever">×</button></li>`).join('')}</ul>` : '<p class="muted">Nothing deleted recently.</p>'}</section>
      <section class="box"><h2>Finished tasks <span class="muted">· ${arch.length}</span></h2>
        ${arch.length ? `<ul class="checks compact">${arch.slice(0, 200).map((t) => `<li><span class="grow">${esc(t.title)} <small class="muted">${t.project ? `+${esc(t.project)} · ` : ''}done ${t.doneAt ? fmt(t.doneAt, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</small></span>
          <button class="btn ghost small" data-act="taskReopen" data-id="${t.id}">Reopen</button></li>`).join('')}</ul>` : '<p class="muted">Tasks finished more than 30 days ago move here automatically.</p>'}</section>
      <section class="box"><h2>Finished and dropped goals <span class="muted">· ${closed.length}</span></h2>
        ${closed.length ? `<ul class="checks compact">${closed.map((g) => `<li><span class="grow">${esc(g.title)} <small class="muted">${g.status === 'done' ? 'achieved' : 'dropped'}</small></span><button class="btn ghost small" data-act="goalReopen" data-id="${g.id}">Reopen</button></li>`).join('')}</ul>` : '<p class="muted">Goals you mark Done or Dropped on Roles &amp; goals are listed here.</p>'}</section>`;
    return c.page('Archive', 'Deleted items and finished work', body);
  }
  const pathLabel = (p) => (/^weeks\./.test(p) ? 'weekly plan' : /^months\./.test(p) ? 'monthly plan' : ({ tasks: 'task', goals: 'goal', roles: 'role', schedule: 'calendar item', big3: 'Big 3', inbox: 'inbox', bucket: 'bucket list', reading: 'reading list', shopping: 'shopping', journals: 'journal', memories: 'memory', workouts: 'workout', events: 'key date', projects: 'project', idealWeek: 'ideal week', wheel: 'wheel' }[p] || p));
  ROUTES.archive = viewArchive;
  ACTS.trashRestore = (el) => {
    const i = st().trash.findIndex((x) => x.id === el.dataset.id); if (i < 0) return;
    const [x] = st().trash.splice(i, 1);
    let list = c.get(x.path); if (!Array.isArray(list)) { S.setPath(st(), x.path, []); list = c.get(x.path); }
    if (!list.some((y) => y.id === x.item.id)) list.push(x.item);
    c.commit(); c.toast(`Restored “${(x.label || 'item').slice(0, 40)}”`);
  };
  ACTS.trashPurge = (el) => { st().trash = st().trash.filter((x) => x.id !== el.dataset.id); c.commit(); };
  ACTS.trashEmpty = () => { if (!confirm('Permanently delete everything in Recently deleted?')) return; st().trash = []; c.commit(); };
  ACTS.taskReopen = (el) => { const t = byId(el.dataset.id); if (t) { t.archived = false; t.status = 'next'; t.doneAt = ''; c.commit(); c.toast('Task reopened'); } };
  ACTS.goalReopen = (el) => { const g = st().goals.find((x) => x.id === el.dataset.id); if (g) { g.status = 'active'; c.commit(); c.toast('Goal reopened'); } };

  /* ================================================================= search ===== */
  const sd = document.createElement('dialog'); sd.id = 'searchDlg'; sd.className = 'search-dlg';
  sd.innerHTML = '<div class="s-box"><input id="sQ" type="search" autocomplete="off" placeholder="Search tasks, goals, notes, journal, lists…" aria-label="Search everything"><ul id="sRes" role="listbox"></ul><p class="muted small s-tip">↑↓ to move · Enter to open · Esc to close · try <b>task:</b> <b>goal:</b> <b>journal:</b></p></div>';
  document.body.appendChild(sd);
  let sIndex = [], sResults = [], sSel = 0;
  function openSearch(q) { sIndex = P.buildIndex(st()); sd.showModal(); const i = $('#sQ', sd); i.value = q || ''; i.focus(); i.select(); drawSearch(); }
  function drawSearch() {
    const q = $('#sQ', sd).value;
    sResults = q.trim() ? P.search(sIndex, q, 40) : P.buildIndex({ tasks: T().filter(isOpen).sort(sortTasks).slice(0, 6), goals: st().goals.filter((g) => g.status === 'active').slice(0, 4) }).map((x) => Object.assign(x, { score: 0 }));
    sSel = Math.min(sSel, Math.max(0, sResults.length - 1));
    const hi = (s) => { const w = q.trim().toLowerCase().split(/\s+/).filter(Boolean).filter((x) => !/:$/.test(x)); let out = esc(s); w.forEach((x) => { out = out.replace(new RegExp(`(${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>'); }); return out; };
    $('#sRes', sd).innerHTML = sResults.length ? sResults.map((r, i) => `<li role="option" class="${i === sSel ? 'sel' : ''}${r.done ? ' done' : ''}" data-i="${i}"><span class="s-type">${esc(r.type)}</span><span class="s-main"><strong>${hi(r.title)}</strong>${r.text ? `<small>${hi(P.snippet(r.text, q, 90))}</small>` : ''}</span></li>`).join('')
      : `<li class="s-empty muted">${q.trim() ? 'No matches.' : 'Start typing to search everything in Telos.'}</li>`;
    const sel = $('#sRes li.sel', sd); if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  function openResult(r) {
    if (!r) return;
    sd.close();
    if (r.task) { openTask(r.task); return; }
    const same = location.hash === r.go;
    location.hash = r.go; if (same) c.render();
    setTimeout(() => { const el = document.querySelector(`[data-bind*="@${r.id}"], [data-id="${r.id}"], [data-bind*=".${r.id}."]`); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); const box = el.closest('.goal, li, .box, tr') || el; box.classList.add('found'); setTimeout(() => box.classList.remove('found'), 2200); } }, 120);
  }
  sd.addEventListener('input', () => { sSel = 0; drawSearch(); });
  sd.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sSel = Math.min(sResults.length - 1, sSel + 1); drawSearch(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sSel = Math.max(0, sSel - 1); drawSearch(); }
    else if (e.key === 'Enter') { e.preventDefault(); openResult(sResults[sSel]); }
  });
  sd.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) openResult(sResults[Number(li.dataset.i)]); else if (e.target === sd) sd.close(); });
  ACTS.search = () => openSearch();

  /* ============================================================ quick add + help ===== */
  const qd = document.createElement('dialog'); qd.id = 'quickAddDlg'; qd.className = 'search-dlg';
  qd.innerHTML = '<form method="dialog" class="s-box"><label class="field">New task <input id="qaText" autocomplete="off" placeholder="Call dentist friday !high #health +Admin"></label><p id="qaPreview" class="muted small">Type naturally. Dates (friday, tomorrow, in 2 weeks), !high, #tags, +Project, every week…</p><div class="row end"><button type="button" class="btn ghost" id="qaFull">More options</button><button class="btn primary">Add task</button></div></form>';
  document.body.appendChild(qd);
  qd.addEventListener('input', (e) => {
    if (e.target.id !== 'qaText') return;
    const q = P.parseQuick(e.target.value, iso0()), bits = [];
    if (q.due) bits.push(`Due ${fmt(q.due)}`); if (q.priority) bits.push(`${PRI[q.priority]} priority`); if (q.recur) bits.push(P.recurLabel(q.recur)); if (q.project) bits.push(`+${q.project}`); q.tags.forEach((t) => bits.push(`#${t}`)); if (q.status !== 'next') bits.push(q.status);
    $('#qaPreview', qd).textContent = e.target.value.trim() ? `“${q.title || '…'}”${bits.length ? ` · ${bits.join(' · ')}` : ''}` : 'Type naturally. Dates (friday, tomorrow, in 2 weeks), !high, #tags, +Project, every week…';
  });
  qd.addEventListener('submit', (e) => { e.preventDefault(); const v = $('#qaText', qd).value.trim(); if (!v) return; qd.close(); addFromText(v); });
  qd.addEventListener('click', (e) => { if (e.target.id === 'qaFull') { const v = $('#qaText', qd).value.trim(); qd.close(); const q = P.parseQuick(v, iso0()); openTask(null, { title: q.title || v, due: q.due, priority: q.priority, tags: q.tags, project: q.project, status: q.status, recur: q.recur }); } else if (e.target === qd) qd.close(); });
  function openQuickAdd() { qd.showModal(); const i = $('#qaText', qd); i.value = ''; i.focus(); $('#qaPreview', qd).textContent = 'Type naturally. Dates (friday, tomorrow, in 2 weeks), !high, #tags, +Project, every week…'; }
  ACTS.quickTask = openQuickAdd;

  const hd = document.createElement('dialog'); hd.id = 'helpDlg';
  const KEYS = [['/ or Ctrl/⌘ K', 'Search everything'], ['n', 'Add a task (quick)'], ['Shift N', 'New task with all options'], ['g then t', 'Go to Today'], ['g then w', 'Go to Week'], ['g then c', 'Go to Calendar'], ['g then k', 'Go to Tasks'], ['g then g', 'Go to Goals'], ['g then m', 'Go to Month'], ['g then p', 'Go to Planning sessions'], ['g then r', 'Go to Review summary'], ['g then l', 'Go to Lists'], ['g then a', 'Go to Archive'], ['g then s', 'Go to Settings'], ['[  and  ]', 'Previous / next week, month or day'], ['Ctrl/⌘ Z', 'Undo last change'], ['Ctrl/⌘ Shift Z', 'Redo'], ['?', 'Show this list'], ['Esc', 'Close a dialog']];
  hd.innerHTML = `<form method="dialog"><h2>Keyboard shortcuts</h2><table class="keys"><tbody>${KEYS.map(([k, d]) => `<tr><td>${k.split(' ').map((x) => (/^(then|or|and)$/.test(x) ? ` ${x} ` : `<kbd>${x}</kbd>`)).join('')}</td><td>${d}</td></tr>`).join('')}</tbody></table><div class="row end"><button class="btn">Close</button></div></form>`;
  document.body.appendChild(hd);
  ACTS.shortcuts = () => hd.showModal();

  const GO = { t: '#/today', w: '#/week', c: '#/calendar', k: '#/tasks', g: '#/goals', m: '#/month', p: '#/session', r: '#/summary', l: '#/lists', a: '#/archive', s: '#/settings', i: '#/ideal', f: '#/foundation', y: '#/year' };
  let gPending = 0;
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase(), typing = /^(input|textarea|select)$/.test(tag) || e.target.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!sd.open) openSearch(); return; }
    if (typing || document.querySelector('dialog[open]')) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) c.redo(); else c.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); c.redo(); return; }
    if (mod || e.altKey) return;
    const k = e.key;
    if (gPending && Date.now() - gPending < 1400) { gPending = 0; const dest = GO[k.toLowerCase()]; if (dest) { e.preventDefault(); location.hash = dest; } return; }
    if (k === '/') { e.preventDefault(); openSearch(); }
    else if (k === 'n') { e.preventDefault(); openQuickAdd(); }
    else if (k === 'N') { e.preventDefault(); openTask(null, {}); }
    else if (k === 'g') { gPending = Date.now(); }
    else if (k === '?') { e.preventDefault(); hd.showModal(); }
    else if (k === '[' || k === ']') { const a = $(`a[aria-label^="${k === '[' ? 'Previous' : 'Next'}"]`); if (a) { e.preventDefault(); a.click(); location.hash = a.getAttribute('href'); } }
  });

  /* ========================================================= templates ===== */
  const td = document.createElement('dialog'); td.id = 'tplDlg'; td.className = 'wide';
  document.body.appendChild(td);
  let tplSel = null;
  const allTemplates = () => P.TEMPLATES.concat((st().templates || []).map((t) => Object.assign({ custom: true }, t)));
  function drawTpl() {
    const list = allTemplates(), cur = list.find((x) => x.id === tplSel);
    td.innerHTML = `<form method="dialog"><h2>Start from a template</h2>
      <div class="tpl-grid">${list.map((x) => `<button type="button" class="pick-card${x.id === tplSel ? ' on' : ''}" data-tpl="${x.id}"><strong>${esc(x.name)}</strong><small class="muted">${esc(x.desc || '')}</small><span class="pick-tag">${x.tasks.length} task${x.tasks.length === 1 ? '' : 's'}${x.custom ? ' · yours' : ''}</span></button>`).join('')}</div>
      ${cur ? `<section class="box tpl-form"><h3>${esc(cur.name)}</h3>
        <ul class="plain">${cur.tasks.map((x) => `<li>${esc(x.title)}${(x.subtasks || []).length ? ` <small class="muted">(${x.subtasks.length} steps)</small>` : ''}</li>`).join('')}</ul>
        <div class="row"><label class="grow">Project name <input id="tplProj" value="${esc(cur.project || cur.name)}"></label>
          <label>${cur.anchor === 'end' ? 'Date of the trip, event or deadline' : 'Start on'} <input type="date" id="tplDate" value="${cur.anchor === 'end' ? plus(iso0(), 45) : iso0()}"></label></div>
        ${cur.recur ? '<p class="muted small">This one repeats, so the next one appears when you finish it.</p>' : ''}
        <div class="row end">${cur.custom ? '<button type="button" class="btn ghost" data-tpl-del="1">Delete template</button>' : ''}<button type="button" class="btn primary" data-tpl-go="1">Add to my tasks</button></div></section>` : '<p class="muted">Pick a template to see what it adds.</p>'}
      <div class="row end"><button class="btn ghost">Close</button></div></form>`;
  }
  td.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tpl]'); if (b) { tplSel = b.dataset.tpl; drawTpl(); return; }
    if (e.target.closest('[data-tpl-del]')) { if (confirm('Delete this template?')) { st().templates = st().templates.filter((x) => x.id !== tplSel); tplSel = null; S.save(st()); drawTpl(); } return; }
    if (e.target.closest('[data-tpl-go]')) {
      const cur = allTemplates().find((x) => x.id === tplSel); if (!cur) return;
      const rows = P.expandTemplate(cur, $('#tplDate', td).value, $('#tplProj', td).value.trim());
      rows.forEach((r) => T().push(mkTask(Object.assign({}, r, { subtasks: r.subtasks.map((s) => ({ id: S.uid(), text: s.text, done: false })) }))));
      td.close(); tf.project = $('#tplProj', td) ? '' : ''; c.commit(); c.toast(`Added ${rows.length} task${rows.length === 1 ? '' : 's'} from “${cur.name}”`, { label: 'Undo', fn: c.undo });
      if (!/^#\/tasks/.test(location.hash)) location.hash = '#/tasks/next';
    }
  });
  ACTS.tplOpen = () => { tplSel = null; drawTpl(); td.showModal(); };
  ACTS.tplFromProject = (el) => {
    const project = el.dataset.project, list = T().filter((t) => t.project === project);
    if (!list.length) return;
    const name = prompt('Name this template', project); if (!name) return;
    const dues = list.map((t) => t.due).filter(Boolean).sort(), base = dues[0] || '';
    st().templates.push({ id: S.uid(), name: name.trim(), desc: `Saved from your “${project}” project`, anchor: 'start', project: name.trim(),
      tasks: list.map((t) => ({ title: t.title, offset: t.due && base ? U.daysBetween(U.parseISO(base), U.parseISO(t.due)) : 0, priority: t.priority, tags: (t.tags || []).slice(), subtasks: (t.subtasks || []).map((s) => s.text), notes: t.notes })) });
    c.commit(); c.toast('Template saved. Find it under “From template”.');
  };

  /* ============================================================ summaries ===== */
  const summ = { kind: 'week' };
  function viewSummary(a, b) {
    const kind = ['week', 'month', 'quarter', 'year'].includes(a) ? a : summ.kind;
    summ.kind = kind;
    const anchor = /^\d{4}-\d{2}-\d{2}$/.test(b || '') ? b : iso0();
    const per = P.period(kind, anchor, c.ws()), sm = P.summarize(st(), per.from, per.to);
    const openNow = T().filter((t) => isOpen(t) && t.status === 'next' && ((t.due && t.due >= per.from && t.due <= per.to) || (t.day && t.day >= per.from && t.day <= per.to)));
    const list = (rows, fmtRow) => (rows.length ? `<ul class="plain">${rows.map(fmtRow).join('')}</ul>` : '<p class="muted small">None yet.</p>');
    const ids = []; Object.entries(sm.byArea).forEach(([k, n]) => { for (let i = 0; i < n; i++) ids.push(k); });
    const tile = (l, v, s2) => `<div class="tile"><span>${l}</span><strong>${v}</strong><small>${s2}</small></div>`;
    const body = `<div class="chips sum-tabs">${['week', 'month', 'quarter', 'year'].map((k) => `<a class="chip${k === kind ? ' on' : ''}" href="#/summary/${k}/${anchor}">${k[0].toUpperCase() + k.slice(1)}</a>`).join('')}</div>
      <div class="tiles">${tile('Tasks finished', sm.done.tasks.length, 'in this period')}${tile('Milestones', sm.done.milestones.length + sm.done.objectives.length, 'reached')}${tile('Priorities', sm.done.actions.length + sm.done.big3.length, 'completed')}${tile('Workouts', sm.workouts.count, `${sm.workouts.minutes} min`)}</div>
      <div class="grid2">
        <section class="box"><h2>Tasks finished</h2>${list(sm.done.tasks, (t) => `<li>${esc(t.title)}${t.project ? ` <small class="muted">+${esc(t.project)}</small>` : ''} <small class="muted">${fmt(t.date, { month: 'short', day: 'numeric' })}</small></li>`)}</section>
        <section class="box"><h2>Milestones &amp; objectives</h2>${list([...sm.done.milestones, ...sm.done.objectives], (t) => `<li>${esc(t.title)} <small class="muted">${esc(t.goal)}</small></li>`)}</section>
        <section class="box"><h2>Priorities &amp; Big 3</h2>${list([...sm.done.actions, ...sm.done.big3], (t) => `<li>${esc(t.title)}${t.goal ? ` <small class="muted">${esc(t.goal)}</small>` : ''}</li>`)}</section>
        <section class="box"><h2>Goal progress</h2>${list(sm.moved, (g) => `<li>${esc(g.title)} <small class="muted">${g.from}% → ${g.to}%</small></li>`)}</section>
        <section class="box"><h2>Habits</h2>${list(sm.done.habits, (h) => `<li>${esc(h.title)} <small class="muted">${h.count} of about ${h.target}</small></li>`)}</section>
        <section class="box"><h2>Where the effort went</h2>${ids.length ? c.balanceStrip(ids) : '<p class="muted small">Finish some tasks and habits to see this.</p>'}
          <p class="muted small">Daily reviews done: ${sm.reviews} · Journal entries: ${sm.journals}</p></section>
      </div>
      <section class="box"><h2>Still open in this period</h2>${list(openNow.slice(0, 30), (t) => `<li>${esc(t.title)} <small class="muted">${esc(dueLabel(t))}</small></li>`)}</section>`;
    const prev = P.shiftPeriod(kind, anchor, -1, c.ws()), next = P.shiftPeriod(kind, anchor, 1, c.ws());
    const nav = `<a class="btn ghost" href="#/summary/${kind}/${prev}" aria-label="Previous period">←</a><a class="btn ghost" href="#/summary/${kind}/${iso0()}">Now</a><a class="btn ghost" href="#/summary/${kind}/${next}" aria-label="Next period">→</a>
      <button class="btn" data-act="sumCopy" data-kind="${kind}" data-anchor="${anchor}">Copy</button><button class="btn" data-act="sumDownload" data-kind="${kind}" data-anchor="${anchor}">Download .md</button><button class="btn" data-act="printPage">Print / PDF</button>`;
    return c.page('What I finished', per.label, body, nav);
  }
  const sumMd = (el) => { const per = P.period(el.dataset.kind, el.dataset.anchor, c.ws()); return { per, md: P.summaryMarkdown(P.summarize(st(), per.from, per.to), `What I finished: ${per.label}`) }; };
  ROUTES.summary = viewSummary;
  ACTS.sumCopy = (el) => c.showText(`Summary: ${sumMd(el).per.label}`, sumMd(el).md);
  ACTS.sumDownload = (el) => { const r = sumMd(el); download(`lifeos-summary-${r.per.from}.md`, r.md, 'text/markdown'); };
  ACTS.printPage = () => window.print();

  /* ======================================================== print layouts ===== */
  function printWeek(wk) {
    const start = U.parseISO(wk || U.weekKey(c.today(), c.ws())), key = U.toISO(start), w = st().weeks[key] || {};
    const days = Array.from({ length: 7 }, (_, i) => U.addDays(start, i));
    const dayHtml = (d) => {
      const iso = U.toISO(d), items = [];
      U.eventsOn(st().events, iso).forEach((e) => items.push(`<li class="ev">★ ${esc(e.text)}</li>`));
      st().schedule.filter((x) => x.date === iso).sort((a, b) => (a.time || '').localeCompare(b.time || '')).forEach((x) => items.push(`<li><b>${x.time ? esc(c.fmtTime(x.time)) : ''}</b> ${esc(x.text)}</li>`));
      st().workouts.filter((x) => x.date === iso).forEach((x) => items.push(`<li>🏃 ${esc(x.type)}</li>`));
      tasksOn(iso).forEach((t) => items.push(`<li class="box-item">☐ ${esc(t.title)}</li>`));
      [...(w.actions || []), ...(w.top3 || [])].filter((a) => a.day === iso).forEach((a) => items.push(`<li class="box-item">☐ ${esc(a.text)}</li>`));
      st().big3.filter((b) => b.date === iso).forEach((b) => items.push(`<li class="box-item"><b>★</b> ${esc(b.text)}</li>`));
      return `<section class="pday"><h3>${U.DAYS[d.getDay()]} <span>${fmt(iso, { month: 'short', day: 'numeric' })}</span></h3><ul>${items.join('')}</ul></section>`;
    };
    return `<div class="printbar print-hide"><a class="btn ghost" href="#/week/${key}">← Back</a><a class="btn ghost" href="#/print/week/${U.toISO(U.addDays(start, -7))}">←</a><a class="btn ghost" href="#/print/week/${U.toISO(U.addDays(start, 7))}">→</a><button class="btn primary" data-act="printPage">Print / Save as PDF</button><span class="muted small">Tip: choose Landscape and turn off “headers and footers”.</span></div>
      <article class="sheet"><h1>Week of ${fmt(key, { month: 'long', day: 'numeric', year: 'numeric' })}</h1>
        ${(w.top3 || []).length ? `<p class="ptop"><b>Top 3:</b> ${w.top3.map((x, i) => `${i + 1}. ${esc(x.text)}`).join('   ')}</p>` : ''}
        <div class="pweek">${days.map(dayHtml).join('')}</div>
        <div class="pfoot"><section><h3>Priorities</h3><ul>${(w.actions || []).filter((a) => !a.day).map((a) => `<li class="box-item">☐ ${esc(a.text)}</li>`).join('')}</ul></section>
          <section><h3>Notes</h3><div class="lines"></div></section></div></article>`;
  }
  function printMonth(mk) {
    mk = mk || U.monthKey(c.today());
    const grid = U.monthGrid(mk, c.ws()), m = st().months[mk] || {}, d0 = U.parseMonthKey(mk);
    const head = Array.from({ length: 7 }, (_, i) => U.DAYS[(i + c.ws()) % 7].slice(0, 3));
    const cell = (d) => {
      const iso = U.toISO(d), out = U.monthKey(d) !== mk, bits = [];
      U.eventsOn(st().events, iso).forEach((e) => bits.push(`<div>★ ${esc(e.text)}</div>`));
      st().schedule.filter((x) => x.date === iso).slice(0, 3).forEach((x) => bits.push(`<div>${x.time ? `${esc(c.fmtTime(x.time))} ` : ''}${esc(x.text)}</div>`));
      tasksOn(iso).slice(0, 3).forEach((t) => bits.push(`<div>☐ ${esc(t.title)}</div>`));
      return `<td class="${out ? 'out' : ''}"><b>${d.getDate()}</b>${bits.join('')}</td>`;
    };
    return `<div class="printbar print-hide"><a class="btn ghost" href="#/month/${mk}">← Back</a><a class="btn ghost" href="#/print/month/${U.monthKey(U.addMonths(d0, -1))}">←</a><a class="btn ghost" href="#/print/month/${U.monthKey(U.addMonths(d0, 1))}">→</a><button class="btn primary" data-act="printPage">Print / Save as PDF</button><span class="muted small">Tip: choose Landscape and turn off “headers and footers”.</span></div>
      <article class="sheet"><h1>${U.MONTHS[d0.getMonth()]} ${d0.getFullYear()}</h1>
        <table class="pmonth"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${grid.map((row) => `<tr>${row.map(cell).join('')}</tr>`).join('')}</tbody></table>
        <div class="pfoot"><section><h3>Monthly priorities</h3><ul>${(m.actions || []).map((a) => `<li class="box-item">☐ ${esc(a.text)}</li>`).join('')}</ul></section><section><h3>Notes</h3><div class="lines"></div></section></div></article>`;
  }
  function printDay(d) {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : iso0();
    const sched = st().schedule.filter((x) => x.date === iso).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const hours = Array.from({ length: 14 }, (_, i) => i + 6);
    return `<div class="printbar print-hide"><a class="btn ghost" href="#/today">← Back</a><a class="btn ghost" href="#/print/day/${plus(iso, -1)}">←</a><a class="btn ghost" href="#/print/day/${plus(iso, 1)}">→</a><button class="btn primary" data-act="printPage">Print / Save as PDF</button></div>
      <article class="sheet"><h1>${fmt(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h1>
        ${st().big3.filter((b) => b.date === iso).length ? `<p class="ptop"><b>Big 3:</b> ${st().big3.filter((b) => b.date === iso).map((b, i) => `${i + 1}. ${esc(b.text)}`).join('   ')}</p>` : ''}
        <div class="pday-cols"><section><h3>Schedule</h3><table class="phours">${hours.map((h) => `<tr><th>${esc(c.fmtTime(`${U.pad(h)}:00`))}</th><td>${sched.filter((x) => x.time && Number(x.time.slice(0, 2)) === h).map((x) => esc(x.text)).join(' · ')}</td></tr>`).join('')}</table></section>
          <section><h3>Tasks</h3><ul>${tasksOn(iso).map((t) => `<li class="box-item">☐ ${esc(t.title)}</li>`).join('')}${Array.from({ length: 6 }, () => '<li class="box-item">☐</li>').join('')}</ul><h3>Notes</h3><div class="lines"></div></section></div></article>`;
  }
  ROUTES.print = (kind, arg) => (kind === 'month' ? printMonth(arg) : kind === 'day' ? printDay(arg) : printWeek(arg));
  const origRender = c.render;
  void origRender;

  /* ============================================================= reminders ===== */
  const reminderKey = (t, at) => `r:${t.id}:${at}`;
  function reminderTime(t) {
    if (!t.remind || !isOpen(t)) return null;
    const d = t.day || t.due; if (!d) return null;
    let min;
    if (t.remind === 'morning') min = toMin(st().settings.remindAt || '08:30');
    else if (!t.time) min = toMin(st().settings.remindAt || '08:30');
    else if (t.remind === 'time') min = toMin(t.time);
    else min = toMin(t.time) - Number(t.remind);
    const base = U.parseISO(d); base.setHours(0, min, 0, 0);
    return base;
  }
  function permitted() { return typeof Notification !== 'undefined' && Notification.permission === 'granted' && st().settings.notificationsEnabled; }
  function notify(title, body, tag, url) {
    const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: url || '#/today' } };
    if (navigator.serviceWorker && navigator.serviceWorker.ready) navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, opts)).catch(() => { try { new Notification(title, opts); } catch (e) { /* unsupported */ } });
    else { try { new Notification(title, opts); } catch (e) { /* unsupported */ } }
  }
  function checkReminders() {
    if (!permitted() || st().settings.remindersOn === false) return;
    const now = Date.now(), fired = st().lastNotifications, today = iso0();
    let changed = false;
    T().forEach((t) => {
      const at = reminderTime(t); if (!at) return;
      const k = reminderKey(t, at.getTime());
      if (at.getTime() <= now && now - at.getTime() < 6 * 3600 * 1000 && !fired[k]) { fired[k] = now; changed = true; notify(t.title, `${dueLabel(t)}${t.project ? ` · +${t.project}` : ''}`, k, '#/tasks/today'); }
    });
    // morning digest of what is on the plate today
    const dk = `digest:${today}`, [h, m] = (st().settings.remindAt || '08:30').split(':').map(Number), dt = new Date(); dt.setHours(h, m, 0, 0);
    if (Date.now() >= dt.getTime() && Date.now() - dt.getTime() < 6 * 3600 * 1000 && !fired[dk]) {
      const n = tasksOn(today).length + lateTasks(today).length;
      fired[dk] = now; changed = true;
      if (n) notify(`${n} task${n === 1 ? '' : 's'} for today`, tasksOn(today).concat(lateTasks(today)).slice(0, 3).map((t) => t.title).join(' · '), dk, '#/tasks/today');
    }
    Object.keys(fired).forEach((k) => { if (/^(r:|digest:)/.test(k) && now - (Number(fired[k]) || 0) > 3 * 86400000) { delete fired[k]; changed = true; } });
    if (changed) S.save(st());
  }
  /* Give the service worker the next two days of reminders, so supporting browsers can fire them in the background. */
  function publishReminders() {
    if (!('caches' in window)) return;
    const list = [], limit = Date.now() + 2 * 86400000;
    T().forEach((t) => { const at = reminderTime(t); if (at && at.getTime() < limit && at.getTime() > Date.now() - 3600000) list.push({ key: reminderKey(t, at.getTime()), at: at.getTime(), title: t.title, body: dueLabel(t), url: '#/tasks/today' }); });
    caches.open('lifeos-reminders').then((ca) => ca.put('reminders.json', new Response(JSON.stringify({ enabled: permitted() && st().settings.remindersOn !== false, list }), { headers: { 'Content-Type': 'application/json' } }))).catch(() => {});
  }
  setInterval(() => { checkReminders(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkReminders(); });
  setTimeout(() => { checkReminders(); publishReminders(); }, 1500);
  setInterval(publishReminders, 5 * 60000);
  window.addEventListener('offline', () => c.toast('You are offline. Changes are saved on this device and sync later.'));
  window.addEventListener('online', () => c.toast('Back online'));

  /* settings card (reminders, offline, archive) */
  F.settingsExtra = () => {
    const s = st().settings, perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    return `<section class="box"><h2>Reminders &amp; offline</h2>
      <p class="muted">Telos works offline once it has loaded. Task reminders fire while Telos is open, or installed on your phone or computer and running in the background. They cannot wake an app that is fully closed (that needs a push service).</p>
      <p>Notifications: <strong>${perm === 'granted' && s.notificationsEnabled ? 'on' : perm === 'denied' ? 'blocked by the browser' : perm === 'unsupported' ? 'not supported here' : 'off'}</strong>
        ${perm !== 'unsupported' && perm !== 'denied' ? `<button type="button" class="btn ghost small" data-act="remindEnable">${perm === 'granted' && s.notificationsEnabled ? 'Send a test' : 'Turn on notifications'}</button>` : ''}</p>
      <div class="row"><label class="inline-check">${c.chk('settings.remindersOn', 'Task reminders')} Task reminders</label>
        <label>Morning digest and “morning of” time <input type="time" data-bind="settings.remindAt" value="${esc(s.remindAt || '08:30')}"></label></div>
      <p class="muted small"><a href="#/archive">Archive and recently deleted →</a> · <a href="#/summary">What I finished →</a> · <button type="button" class="linklike" data-act="shortcuts">Keyboard shortcuts</button></p></section>`;
  };
  ACTS.remindEnable = () => {
    if (typeof Notification === 'undefined') return;
    const go = () => { st().settings.notificationsEnabled = true; S.save(st()); notify('Telos reminders are on', 'You will see task reminders and a morning digest.', 'test', '#/tasks/today'); c.render(); };
    if (Notification.permission === 'granted') go(); else Notification.requestPermission().then((p) => { if (p === 'granted') go(); else c.toast('Notifications were not allowed'); });
  };

  /* service worker: offline shell and notification clicks */
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href).then((reg) => {
        const send = () => { const urls = performance.getEntriesByType('resource').map((r) => r.name).filter((u) => u.startsWith(location.origin) && !/\/api\//.test(u)); urls.push(location.href.split('#')[0]); if (reg.active) reg.active.postMessage({ type: 'cache', urls }); };
        navigator.serviceWorker.ready.then(send);
        if (reg.periodicSync) navigator.permissions.query({ name: 'periodic-background-sync' }).then((p) => { if (p.state === 'granted') reg.periodicSync.register('lifeos-reminders', { minInterval: 15 * 60 * 1000 }); }).catch(() => {});
      }).catch(() => {});
      navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'goto' && e.data.url) { location.hash = e.data.url; } });
    });
  }
};
