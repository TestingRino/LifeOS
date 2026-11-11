/* Life.OS — pure planning logic: life areas, recurrence, quick-add parsing, rollover, search,
   summaries and templates. No DOM; usable in the browser and in Node tests. */
(function (root) {
  'use strict';
  const U = typeof module !== 'undefined' && module.exports ? require('./util.js') : root.LifeUtil;

  /* ---------- one shared set of life areas (goals, balance view, Wheel of Life) ---------- */
  const LIFE = [
    { id: 'career', name: 'Career & Work', short: 'Career', hint: 'Work, calling, contribution, progress' },
    { id: 'finances', name: 'Finances', short: 'Finances', hint: 'Income, savings, debt, security' },
    { id: 'family', name: 'Family', short: 'Family', hint: 'Spouse, children, parents, close relationships' },
    { id: 'faith', name: 'Faith & Spirit', short: 'Faith', hint: 'Faith, purpose, inner peace, values' },
    { id: 'fitness', name: 'Fitness & Health', short: 'Fitness', hint: 'Exercise, sleep, nutrition, energy' },
    { id: 'mental', name: 'Mental & Emotional', short: 'Mental', hint: 'Rest, stress, therapy, attitude, joy' },
    { id: 'learning', name: 'Learning & Growth', short: 'Learning', hint: 'Skills, reading, curiosity, new challenges' },
    { id: 'community', name: 'Community & Service', short: 'Community', hint: 'Neighbors, volunteering, giving back' },
    { id: 'personal', name: 'Personal & Social', short: 'Personal', hint: 'Friends, fun, hobbies, creativity' },
    { id: 'home', name: 'Home & Environment', short: 'Home', hint: 'Your space, upkeep, order, admin' },
  ];
  const LIFE_IDS = LIFE.map((a) => a.id);
  const lifeName = (id) => (LIFE.find((a) => a.id === id) || { name: '' }).name;

  /* Older data used six planner areas (work, home, friends, projects, fun, health). Map them, using
     the role and title to pick the best of the ten. */
  const FAMILY_ROLES = ['Parent', 'Partner', 'Family', 'Caregiver', 'Grandparent'];
  function lifeArea(area, role, title, legacy) {
    if (!legacy && LIFE_IDS.includes(area)) return area;   // 'home' exists in both sets, so older data must pass legacy=true
    const t = String(title || ''), r = String(role || '');
    if (r === 'Person of faith' || /prayer|scripture|worship|faith|church|bible|small group|giving plan/i.test(t)) return 'faith';
    if (r === 'Money steward' || /budget|debt|saving|emergency fund|retire|\btax|invest|financ|money|insurance|estate/i.test(t)) return 'finances';
    if (r === 'Community member' || /volunteer|community|neighbo|\bcause\b|\bserve\b/i.test(t)) return 'community';
    if (/respite|break just for me|stress|therap|meditat|journal|grateful|gratitude|digital declutter|screens/i.test(t)) return 'mental';
    if (r === 'Creator') return 'personal';
    if (/mentor|job|internship|promotion|resume|career|network|customer|marketing|hire|delegat|deep work|work-life|boundary|revenue|systemiz|business|\blead/i.test(t) || r === 'Leader' || r === 'Business owner') return 'career';
    if (FAMILY_ROLES.includes(r) && !/health|checkup|strength|sleep/i.test(t)) return 'family';
    if (/family|kids|spouse|marriage|\bdad\b|\bmom\b|grandchild|date night|children/i.test(t)) return 'family';
    if (/course|learn|language|\bread|study|skill|class\b|degree|certif|term\b|graduate|\bnotes\b/i.test(t) || r === 'Student' || r === 'Learner') return /try something new/i.test(t) ? 'personal' : 'learning';
    if (/run\b|workout|strength|weight|stretch|walk|move\b|sleep|bed\b|water|health|checkup|cook|meal|mobility|exercise|10k|active|healthy/i.test(t) || r === 'Healthy person' || area === 'health') return 'fitness';
    if (/declutter|house|\bhome\b|tidy|organi[sz]e|downsize|chore|garden|clean|simplif|paperwork/i.test(t) || r === 'Household manager' || area === 'home') return 'home';
    if (r === 'Professional' || area === 'work') return 'career';
    return 'personal';
  }
  /* The six planner areas on the week/month pages (priority actions are grouped by these). */
  const PLANNER_OF = { career: 'work', finances: 'home', home: 'home', family: 'friends', community: 'friends', personal: 'fun', learning: 'projects', mental: 'health', fitness: 'health', faith: 'health' };
  const plannerArea = (life) => PLANNER_OF[life] || (['work', 'home', 'friends', 'projects', 'fun', 'health'].includes(life) ? life : 'work');
  /* Old Wheel of Life keys to the shared set. */
  const WHEEL_KEYS = { physical: 'fitness', mental: 'learning', spiritual: 'faith', family: 'family', career: 'career', financial: 'finances', social: 'community' };

  /* ---------- dates ---------- */
  const iso = U.toISO, parse = U.parseISO, plus = (s, n) => iso(U.addDays(parse(s), n));
  const clampDay = (y, m, d) => Math.min(d, new Date(y, m + 1, 0).getDate());

  /* ---------- recurrence ----------
     recur = { freq: 'daily'|'weekly'|'monthly'|'yearly', every: 1, dows: [0-6], dom: 1-31, mode: 'fixed'|'after', until: 'YYYY-MM-DD' }
     'fixed' keeps the calendar rhythm (the 1st, every Monday). 'after' counts from the day it was completed. */
  function nextDue(recur, baseISO, doneISO) {
    if (!recur || !recur.freq) return '';
    const every = Math.max(1, Number(recur.every) || 1);
    const from = recur.mode === 'after' && doneISO ? doneISO : (baseISO || doneISO);
    const base = parse(from);
    let out = '';
    if (recur.freq === 'daily') out = plus(from, every);
    else if (recur.freq === 'weekly') {
      const dows = (recur.dows && recur.dows.length ? recur.dows : [base.getDay()]).slice().sort();
      const wk0 = U.startOfWeek(base, 0);
      for (let i = 1; i <= 7 * every + 7 && !out; i++) {
        const d = U.addDays(base, i), wkIdx = Math.round(U.daysBetween(wk0, U.startOfWeek(d, 0)) / 7);
        if (dows.includes(d.getDay()) && wkIdx % every === 0) out = iso(d);
      }
      if (!out) out = plus(from, 7 * every);
    } else if (recur.freq === 'monthly') {
      const dom = Number(recur.dom) || base.getDate();
      let y = base.getFullYear(), m = base.getMonth();
      let cand = new Date(y, m, clampDay(y, m, dom));
      if (cand <= base) { m += every; y += Math.floor(m / 12); m %= 12; cand = new Date(y, m, clampDay(y, m, dom)); }
      out = iso(cand);
    } else if (recur.freq === 'yearly') {
      const y = base.getFullYear() + every;
      out = iso(new Date(y, base.getMonth(), clampDay(y, base.getMonth(), base.getDate())));
    }
    if (out && recur.until && out > recur.until) return '';
    return out;
  }
  function recurLabel(r) {
    if (!r || !r.freq) return '';
    const n = Math.max(1, Number(r.every) || 1), d = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    if (r.freq === 'daily') return n === 1 ? 'Every day' : `Every ${n} days`;
    if (r.freq === 'weekly') {
      const dw = (r.dows || []).slice().sort();
      if (dw.length === 5 && !dw.includes(0) && !dw.includes(6)) return 'Every weekday';
      return `${n === 1 ? 'Every' : `Every ${n} weeks:`} ${dw.length ? dw.map((x) => d[x]).join(', ') : 'week'}`;
    }
    if (r.freq === 'monthly') return `${n === 1 ? 'Monthly' : `Every ${n} months`}${r.dom ? ` on the ${ordinal(r.dom)}` : ''}`;
    return n === 1 ? 'Every year' : `Every ${n} years`;
  }
  const ordinal = (n) => { n = Number(n); const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

  /* ---------- quick add: "Call dentist friday !high #health +Admin every month" ---------- */
  const WD = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
  function nextWeekday(todayISO, dow, strictlyAfter) {
    const t = parse(todayISO); let n = (dow - t.getDay() + 7) % 7;
    if (n === 0 && strictlyAfter !== false) n = 7;
    return iso(U.addDays(t, n));
  }
  function parseQuick(text, todayISO) {
    let s = ` ${String(text || '')} `;
    const out = { title: '', due: '', priority: '', tags: [], project: '', status: 'next', recur: null };
    const take = (re, fn) => { s = s.replace(re, (...m) => { fn(m); return ' '; }); };
    take(/\s#([\w-]+)/g, (m) => out.tags.push(m[1].toLowerCase()));
    take(/\s!(high|h|3|med|medium|m|2|low|l|1)\b/gi, (m) => { const k = m[1].toLowerCase()[0]; out.priority = k === 'h' || k === '3' ? 'high' : k === 'l' || k === '1' ? 'low' : 'med'; });
    take(/\s\+"([^"]+)"/g, (m) => { out.project = m[1].trim(); });
    take(/\s\+([\w-]+)/g, (m) => { out.project = m[1]; });
    take(/\s@waiting\b/gi, () => { out.status = 'waiting'; });
    take(/\s(?:~someday|@someday)\b/gi, () => { out.status = 'someday'; });
    // repeat
    const rep = (r, due) => { out.recur = Object.assign({ every: 1, mode: 'fixed' }, r); if (due) out.due = due; };
    take(/\severy\s+weekday\b/i, () => rep({ freq: 'weekly', dows: [1, 2, 3, 4, 5] }));
    take(/\severy\s+(\d+)\s+(day|week|month|year)s?\b/i, (m) => rep({ freq: { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }[m[2].toLowerCase()], every: Number(m[1]) }));
    take(/\severy\s+(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i, (m) => rep({ freq: 'weekly', dows: [WD[m[1].toLowerCase()]] }, nextWeekday(todayISO, WD[m[1].toLowerCase()], false)));
    take(/\s(?:every\s+day|daily)\b/i, () => rep({ freq: 'daily' }));
    take(/\s(?:every\s+week|weekly)\b/i, () => rep({ freq: 'weekly' }));
    take(/\s(?:every\s+month|monthly)(?:\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?)?\b/i, (m) => rep(m[1] ? { freq: 'monthly', dom: Number(m[1]) } : { freq: 'monthly' }));
    take(/\s(?:every\s+year|yearly|annually)\b/i, () => rep({ freq: 'yearly' }));
    // dates
    const setDue = (d) => { out.due = d; };
    take(/\s(?:by|on|due|for)?\s*(\d{4}-\d{2}-\d{2})\b/i, (m) => setDue(m[1]));
    take(/\s(?:by|on|due|for)?\s*(\d{1,2})\/(\d{1,2})\b/i, (m) => { const t = parse(todayISO); let d = new Date(t.getFullYear(), Number(m[1]) - 1, Number(m[2])); if (iso(d) < todayISO) d = new Date(t.getFullYear() + 1, Number(m[1]) - 1, Number(m[2])); setDue(iso(d)); });
    take(/\sin\s+(\d+)\s+(day|week|month)s?\b/i, (m) => { const n = Number(m[1]); setDue(m[2].toLowerCase() === 'month' ? iso(new Date(parse(todayISO).getFullYear(), parse(todayISO).getMonth() + n, parse(todayISO).getDate())) : plus(todayISO, n * (m[2].toLowerCase() === 'week' ? 7 : 1))); });
    take(/\snext\s+week\b/i, () => setDue(nextWeekday(todayISO, 1)));
    take(/\s(?:by\s+|on\s+|due\s+)?(?:next\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i, (m) => setDue(nextWeekday(todayISO, WD[m[1].toLowerCase()])));
    take(/\s(?:by\s+|on\s+|due\s+)?(tomorrow|tmrw)\b/i, () => setDue(plus(todayISO, 1)));
    take(/\s(?:by\s+|on\s+|due\s+)?(today|tonight)\b/i, () => setDue(todayISO));
    if (out.recur && !out.due) out.due = todayISO;
    out.title = s.replace(/\s+/g, ' ').trim().replace(/\s+(?:by|on|due|for|every)$/i, '').trim();
    return out;
  }

  /* ---------- rollover ----------
     Moves what is undone to a new day. Recurring tasks (and habits, which are not tasks) never roll. */
  function rollable(t, todayISO) {
    if (!t || t.status === 'done' || t.archived || t.recur || t.status === 'waiting' || t.status === 'someday') return false;
    return !!((t.day && t.day <= todayISO) || (t.due && t.due <= todayISO));
  }
  function rollTasks(tasks, todayISO, targetISO) {
    let n = 0;
    tasks.forEach((t) => {
      if (!rollable(t, todayISO)) return;
      if (t.day && t.day > targetISO) return;
      if (t.due && t.due <= todayISO && !t.origDue) t.origDue = t.due;
      t.day = targetISO;
      if (t.due && t.due <= todayISO) t.due = targetISO;
      t.rolled = (t.rolled || 0) + 1;
      n++;
    });
    return n;
  }

  /* ---------- search ---------- */
  const strip = (x) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim();
  function buildIndex(st) {
    const out = [], add = (type, id, title, text, go, extra) => { title = strip(title); if (title || text) out.push(Object.assign({ type, id, title, text: strip(text), go }, extra || {})); };
    const goalGo = (g) => `#/goals/${g.cycleId || ''}`;
    (st.tasks || []).forEach((t) => add('Task', t.id, t.title, [t.notes, t.project, (t.tags || []).join(' '), t.waitingOn, (t.subtasks || []).map((x) => x.text).join(' ')].join(' '), `#/tasks`, { task: t.id, done: t.status === 'done' }));
    (st.goals || []).forEach((g) => {
      add(g.kind === 'habit' ? 'Habit' : 'Goal', g.id, g.title, [g.why, g.measure, lifeName(lifeArea(g.area, '', g.title))].join(' '), goalGo(g));
      (g.milestones || []).forEach((m) => add('Milestone', m.id, m.text, g.title, goalGo(g), { done: m.done }));
      (g.objectives || []).forEach((m) => add('Objective', m.id, m.text, g.title, goalGo(g), { done: m.done }));
      (g.routines || []).forEach((m) => add('Routine', m.id, m.text, g.title, goalGo(g)));
    });
    (st.roles || []).forEach((r) => add('Role', r.id, r.name, r.why, '#/goals'));
    (st.inbox || []).forEach((x) => add('Inbox', x.id, x.text, x.kind, '#/lists/inbox', { done: x.done }));
    Object.entries(st.weeks || {}).forEach(([wk, w]) => {
      (w.top3 || []).forEach((a) => add('Week top 3', a.id, a.text, '', `#/week/${wk}`, { done: a.done }));
      (w.actions || []).forEach((a) => add('Week action', a.id, a.text, '', `#/week/${wk}`, { done: a.done }));
      if (w.notes || w.gratitude || w.dreams) add('Week notes', wk, `Week of ${wk}`, [w.notes, w.gratitude, w.dreams].join(' '), `#/week/${wk}`);
    });
    Object.entries(st.months || {}).forEach(([mk, m]) => {
      (m.actions || []).forEach((a) => add('Month action', a.id, a.text, '', `#/month/${mk}`, { done: a.done }));
      if (m.notes || m.ideas || m.grateful) add('Month notes', mk, `Month ${mk}`, [m.notes, m.ideas, m.grateful, m.strengths].join(' '), `#/month/${mk}`);
    });
    (st.schedule || []).forEach((x) => add('Schedule', x.id, x.text, `${x.date} ${x.time || ''}`, `#/calendar/day:${x.date}`));
    (st.events || []).forEach((x) => add('Key date', x.id, x.text, x.start, '#/year'));
    (st.bucket || []).forEach((x) => add('Bucket list', x.id, x.text, x.details, '#/lists/bucket', { done: x.done }));
    (st.reading || []).forEach((x) => add('Reading', x.id, x.title, [x.by, x.genre, x.nutshell].join(' '), '#/lists/reading', { done: x.done }));
    (st.shopping || []).forEach((x) => add('Shopping', x.id, x.text, '', '#/lists/shopping', { done: x.done }));
    (st.projects || []).forEach((x) => add('Project', x.id, x.name, [x.notes, (x.steps || []).map((s) => s.text).join(' ')].join(' '), '#/lists/hobbies'));
    (st.journals || []).forEach((x) => add('Journal', x.id, `Journal ${x.date}`, [x.text, x.tags].join(' '), '#/lists/journal'));
    (st.memories || []).forEach((x) => add('Memory', x.id, `${x.kind === 'quote' ? 'Quote' : 'Memory'} ${x.date || ''}`, [x.who, x.text].join(' '), '#/lists/memories'));
    (st.workouts || []).forEach((x) => add('Workout', x.id, `${x.type || 'Workout'} ${x.date}`, x.details, `#/track/workouts`));
    const f = st.foundation || {};
    [['Purpose', f.mission], ['Vision', f.vision], ['Values', f.values], ['Eulogy', f.eulogy], ['Legacy', f.legacy]].forEach(([k, v]) => v && add('Foundation', k, k, v, '#/foundation'));
    return out;
  }
  function search(index, query, limit) {
    let q = String(query || '').toLowerCase().trim();
    let only = '';
    const m = /^([a-z ]+):\s*(.*)$/.exec(q);
    if (m && index.some((x) => x.type.toLowerCase() === m[1].trim())) { only = m[1].trim(); q = m[2]; }
    const words = q.split(/\s+/).filter(Boolean);
    if (!words.length && !only) return [];
    const res = [];
    index.forEach((x) => {
      if (only && x.type.toLowerCase() !== only) return;
      const title = x.title.toLowerCase(), text = x.text.toLowerCase();
      let score = 0;
      for (const w of words) {
        const ti = title.indexOf(w), xi = text.indexOf(w);
        if (ti < 0 && xi < 0) { score = -1; break; }
        score += ti === 0 ? 8 : ti > 0 ? (/\W/.test(title[ti - 1]) ? 6 : 4) : (/\W/.test(text[xi - 1] || ' ') ? 2 : 1);
      }
      if (score < 0) return;
      if (x.done) score -= 1;
      res.push(Object.assign({}, x, { score }));
    });
    res.sort((a, b) => b.score - a.score || a.title.length - b.title.length);
    return res.slice(0, limit || 40);
  }
  function snippet(text, query, len) {
    const w = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)[0];
    if (!text) return '';
    const i = w ? text.toLowerCase().indexOf(w) : -1, L = len || 90;
    if (i < 0) return text.slice(0, L) + (text.length > L ? '…' : '');
    const a = Math.max(0, i - 25);
    return (a ? '…' : '') + text.slice(a, a + L) + (a + L < text.length ? '…' : '');
  }

  /* ---------- periods & review summaries ---------- */
  function period(kind, anyISO, weekStart) {
    const d = parse(anyISO);
    let from, to, label;
    if (kind === 'week') { const s = U.startOfWeek(d, weekStart || 0); from = iso(s); to = iso(U.addDays(s, 6)); label = `Week of ${U.fmtDate(from, { month: 'short', day: 'numeric' })} – ${U.fmtDate(to, { month: 'short', day: 'numeric', year: 'numeric' })}`; }
    else if (kind === 'month') { from = iso(new Date(d.getFullYear(), d.getMonth(), 1)); to = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); label = `${U.MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
    else if (kind === 'quarter') { const q = Math.floor(d.getMonth() / 3); from = iso(new Date(d.getFullYear(), q * 3, 1)); to = iso(new Date(d.getFullYear(), q * 3 + 3, 0)); label = `Q${q + 1} ${d.getFullYear()}`; }
    else { from = `${d.getFullYear()}-01-01`; to = `${d.getFullYear()}-12-31`; label = String(d.getFullYear()); }
    return { kind, from, to, label };
  }
  function shiftPeriod(kind, anyISO, n, weekStart) {
    const d = parse(anyISO);
    if (kind === 'week') return iso(U.addDays(d, 7 * n));
    if (kind === 'month') return iso(new Date(d.getFullYear(), d.getMonth() + n, 1));
    if (kind === 'quarter') return iso(new Date(d.getFullYear(), d.getMonth() + 3 * n, 1));
    return iso(new Date(d.getFullYear() + n, 0, 1));
  }
  const inRange = (d, a, b) => !!d && d >= a && d <= b;
  function summarize(st, from, to) {
    const goalById = Object.fromEntries((st.goals || []).map((g) => [g.id, g]));
    const areaOf = (goalId, own) => lifeArea(own || (goalById[goalId] || {}).area, '', (goalById[goalId] || {}).title);
    const done = { tasks: [], milestones: [], objectives: [], actions: [], big3: [], workouts: [], habits: [] };
    (st.tasks || []).forEach((t) => { if (t.status === 'done' && inRange(t.doneAt, from, to)) done.tasks.push({ title: t.title, project: t.project || '', date: t.doneAt, area: t.area || areaOf(t.goalId) }); });
    (st.goals || []).forEach((g) => {
      (g.milestones || []).forEach((m) => { if (m.done && inRange(m.doneAt, from, to)) done.milestones.push({ title: m.text, goal: g.title, date: m.doneAt }); });
      (g.objectives || []).forEach((m) => { if (m.done && inRange(m.doneAt, from, to)) done.objectives.push({ title: m.text, goal: g.title, date: m.doneAt }); });
    });
    Object.values(st.weeks || {}).forEach((w) => [...(w.actions || []), ...(w.top3 || [])].forEach((a) => { if (a.done && inRange(a.doneAt, from, to)) done.actions.push({ title: a.text, goal: (goalById[a.goalId] || {}).title || '', date: a.doneAt }); }));
    Object.values(st.months || {}).forEach((m) => (m.actions || []).forEach((a) => { if (a.done && inRange(a.doneAt, from, to)) done.actions.push({ title: a.text, goal: (goalById[a.goalId] || {}).title || '', date: a.doneAt }); }));
    (st.big3 || []).forEach((b) => { if (b.done && inRange(b.date, from, to)) done.big3.push({ title: b.text, goal: (goalById[b.goalId] || {}).title || '', date: b.date }); });
    const wos = (st.workouts || []).filter((w) => w.done && inRange(w.date, from, to));
    const days = Math.max(1, U.daysBetween(parse(from), parse(to)) + 1);
    (st.goals || []).filter((g) => g.kind === 'habit').forEach((g) => {
      const n = Object.keys(g.log || {}).filter((d) => g.log[d] && inRange(d, from, to)).length;
      const target = Math.round((Number(g.perWeek) || 5) * days / 7);
      if (n || target) done.habits.push({ title: g.title, count: n, target });
    });
    const moved = (st.goals || []).filter((g) => g.kind !== 'habit').map((g) => {
      const h = (g.history || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
      const before = h.filter((x) => x.date < from).pop(), last = h.filter((x) => x.date <= to).pop();
      const a = before ? before.v : 0, b = last ? last.v : (Number(g.progress) || 0);
      return { title: g.title, from: a, to: b, status: g.status };
    }).filter((x) => x.to !== x.from);
    const byArea = {};
    const bump = (a) => { byArea[a] = (byArea[a] || 0) + 1; };
    done.tasks.forEach((t) => bump(t.area || 'personal'));
    const goalIds = new Set();
    (st.goals || []).forEach((g) => { (g.milestones || []).forEach((m) => { if (m.done && inRange(m.doneAt, from, to)) bump(lifeArea(g.area, '', g.title)); }); });
    done.habits.forEach((h) => { if (h.count) { const g = (st.goals || []).find((x) => x.title === h.title); bump(lifeArea(g && g.area, '', h.title)); } });
    void goalIds;
    const journals = (st.journals || []).filter((j) => inRange(j.date, from, to)).length;
    const reviews = Object.keys(st.reviews || {}).filter((d) => inRange(d, from, to) && st.reviews[d].purpose && st.reviews[d].goals && st.reviews[d].ideal).length;
    return { from, to, days, done, workouts: { count: wos.length, minutes: wos.reduce((s, w) => s + (Number(w.minutes) || 0), 0) }, moved, byArea, journals, reviews };
  }
  function summaryMarkdown(sm, label, extras) {
    const L = [`# ${label}`, ''];
    const sec = (title, rows) => { if (rows.length) { L.push(`## ${title}`, ...rows, ''); } };
    sec(`Tasks finished (${sm.done.tasks.length})`, sm.done.tasks.map((t) => `- [x] ${t.title}${t.project ? ` (${t.project})` : ''}`));
    sec(`Milestones reached (${sm.done.milestones.length})`, sm.done.milestones.map((t) => `- ${t.title} — ${t.goal}`));
    sec(`Objectives finished (${sm.done.objectives.length})`, sm.done.objectives.map((t) => `- ${t.title} — ${t.goal}`));
    sec(`Priorities completed (${sm.done.actions.length})`, sm.done.actions.map((t) => `- ${t.title}${t.goal ? ` — ${t.goal}` : ''}`));
    sec(`Big 3 completed (${sm.done.big3.length})`, sm.done.big3.map((t) => `- ${t.title}`));
    sec('Goal progress', sm.moved.map((g) => `- ${g.title}: ${g.from}% → ${g.to}%`));
    sec('Habits', sm.done.habits.map((h) => `- ${h.title}: ${h.count} of about ${h.target}`));
    if (sm.workouts.count) L.push(`## Workouts`, `- ${sm.workouts.count} done, ${sm.workouts.minutes} minutes`, '');
    if (sm.reviews || sm.journals) L.push('## Reflection', `- Daily reviews completed: ${sm.reviews}`, `- Journal entries: ${sm.journals}`, '');
    const areas = Object.entries(sm.byArea).sort((a, b) => b[1] - a[1]);
    if (areas.length) L.push('## Where the effort went', ...areas.map(([a, n]) => `- ${lifeName(a) || a}: ${n}`), '');
    (extras || []).forEach((x) => L.push(x, ''));
    if (L.length <= 3) L.push('Nothing finished in this period yet.');
    return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  /* ---------- templates ---------- */
  const t = (title, offset, extra) => Object.assign({ title, offset: offset || 0 }, extra || {});
  const TEMPLATES = [
    { id: 'tpl-weekly', name: 'Weekly review', desc: 'A repeating Friday checklist to close the week and set up the next.', anchor: 'start', project: 'Weekly review', recur: { freq: 'weekly', dows: [5], every: 1, mode: 'fixed' },
      tasks: [t('Weekly review', 0, { subtasks: ['Clear inbox and notes', 'Review the calendar for last week', 'Review the calendar for next week', 'Check progress on focus goals', 'Pick the top 3 for next week', 'Celebrate one win'] })] },
    { id: 'tpl-monthly', name: 'Monthly money review', desc: 'Bills, budget and savings check on the 1st of each month.', anchor: 'start', project: 'Finances', recur: { freq: 'monthly', dom: 1, every: 1, mode: 'fixed' },
      tasks: [t('Review budget and spending', 0, { subtasks: ['Categorize last month\'s spending', 'Compare to the budget', 'Move money to savings', 'Check upcoming bills'], priority: 'med', tags: ['money'] })] },
    { id: 'tpl-quarter', name: 'Quarterly planning prep', desc: 'Get ready for your quarterly planning session.', anchor: 'start', project: 'Quarterly planning',
      tasks: [t('Score the Wheel of Life', 0), t('Review last quarter\'s goals and wins', 1), t('Choose 3 or 4 focus goals', 2), t('Refresh the ideal week', 3), t('Block the next 3 months of key dates', 4)] },
    { id: 'tpl-trip', name: 'Trip checklist', desc: 'Planning and packing tasks counted back from your departure date.', anchor: 'end', project: 'Trip',
      tasks: [t('Book travel and lodging', -60, { priority: 'high' }), t('Check passports, IDs and visas', -45), t('Arrange time off and coverage', -30), t('Plan the itinerary and reservations', -21), t('Arrange pet or house care', -14), t('Hold mail and set thermostat', -2), t('Pack', -2, { subtasks: ['Clothing', 'Toiletries and medications', 'Chargers and adapters', 'Documents and tickets', 'Snacks for the trip'] }), t('Check in online and confirm transport', -1), t('Leave', 0)] },
    { id: 'tpl-project', name: 'Project plan', desc: 'A simple start-to-finish plan for any project.', anchor: 'end', project: 'Project',
      tasks: [t('Define the goal and what "done" looks like', -28, { priority: 'high' }), t('List the main steps and who is involved', -26), t('Gather what you need (budget, tools, info)', -21), t('Do the first big step', -14), t('Check progress and adjust the plan', -10), t('Finish the remaining steps', -3), t('Review, ship and celebrate', 0)] },
    { id: 'tpl-event', name: 'Plan a gathering', desc: 'Host a party or family gathering.', anchor: 'end', project: 'Gathering',
      tasks: [t('Pick the date and guest list', -28), t('Send invitations', -21), t('Plan the menu and drinks', -14), t('Shop for supplies', -3, { subtasks: ['Food', 'Drinks', 'Decorations', 'Paper goods'] }), t('Clean and set up', -1), t('Enjoy it', 0)] },
    { id: 'tpl-home', name: 'Seasonal home upkeep', desc: 'A checklist for the home and car at the change of season.', anchor: 'start', project: 'Home upkeep',
      tasks: [t('Test smoke and CO alarms', 0), t('Replace HVAC filters', 1), t('Check gutters and outdoor drains', 3), t('Service the car and check tires', 5), t('Review emergency kit', 7)] },
  ];
  /* tasks from a template; anchor 'start' counts forward from the date, 'end' counts back from it */
  function expandTemplate(tpl, dateISO, project) {
    return (tpl.tasks || []).map((x) => ({
      title: x.title, due: dateISO ? plus(dateISO, x.offset || 0) : '', priority: x.priority || '', tags: (x.tags || []).slice(),
      project: project || tpl.project || '', subtasks: (x.subtasks || []).map((s) => ({ text: typeof s === 'string' ? s : s.text, done: false })),
      recur: tpl.recur && x === tpl.tasks[0] ? Object.assign({}, tpl.recur) : null, notes: x.notes || '',
    }));
  }


  /* ---------- sync: merging two copies of a plan without resurrecting deletions ----------
     Every deleted item leaves a tombstone ({id: 'YYYY-MM-DD'}). A merge unions both copies (local wins when the
     same item exists on both sides), then removes anything either side has deleted. */
  const SKIP_KEYS = { trash: 1, tomb: 1, syncMeta: 1, gcalCalendars: 1, lastNotifications: 1 };
  function idsOf(st) {
    const set = new Set();
    const walk = (v) => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === 'object') { if (typeof v.id === 'string') set.add(v.id); for (const k in v) if (!SKIP_KEYS[k]) walk(v[k]); }
    };
    Object.keys(st || {}).forEach((k) => { if (!SKIP_KEYS[k]) walk(st[k]); });
    return set;
  }
  /* Compare ids before and after a change. Mutates tomb: gone ids are added, returned ids are removed. */
  function recordDeletions(tomb, prevIds, curIds, nowISO, keepDays) {
    if (prevIds) prevIds.forEach((id) => { if (!curIds.has(id)) tomb[id] = nowISO; });
    curIds.forEach((id) => { if (id in tomb) delete tomb[id]; });
    const cut = iso(U.addDays(parse(nowISO), -(keepDays || 120)));
    Object.keys(tomb).forEach((id) => { if (tomb[id] < cut) delete tomb[id]; });
    return tomb;
  }
  function mergeStates(a, b) {
    const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
    const withIds = (arr) => arr.every((x) => isObj(x) && 'id' in x);
    const merge = (x, y) => {
      if (Array.isArray(x) && Array.isArray(y)) {
        if (withIds(x) && withIds(y)) { const seen = new Set(x.map((i) => i.id)); return [...x, ...y.filter((i) => !seen.has(i.id))]; }
        return x.length ? x : y;
      }
      if (isObj(x) && isObj(y)) { const out = { ...y }; Object.keys(x).forEach((k) => { out[k] = k in y ? merge(x[k], y[k]) : x[k]; }); return out; }
      return x === undefined || x === '' || x === null ? y : x;
    };
    const tomb = Object.assign({}, (b && b.tomb) || {}, (a && a.tomb) || {});
    const out = merge(a, b);
    const prune = (v) => {
      if (Array.isArray(v)) return v.filter((x) => !(x && typeof x === 'object' && typeof x.id === 'string' && x.id in tomb)).map(prune);
      if (isObj(v)) { const o = {}; Object.keys(v).forEach((k) => { o[k] = SKIP_KEYS[k] ? v[k] : prune(v[k]); }); return o; }
      return v;
    };
    const pruned = prune(out);
    pruned.tomb = tomb;
    return pruned;
  }
  const api = { idsOf, recordDeletions, mergeStates, LIFE, LIFE_IDS, lifeName, lifeArea, plannerArea, WHEEL_KEYS, nextDue, recurLabel, ordinal, parseQuick, nextWeekday, rollable, rollTasks, buildIndex, search, snippet, period, shiftPeriod, summarize, summaryMarkdown, TEMPLATES, expandTemplate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LifePlan = api;
})(typeof window !== 'undefined' ? window : globalThis);
