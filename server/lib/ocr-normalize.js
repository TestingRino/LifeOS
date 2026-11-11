/* Cleans and routes what the vision model read from a photo. Pure functions, no I/O. */
function normalizeByType(type, data) {
  switch (type) {
    case 'calendar': {
      const mins = (a, b) => { const m = (t) => { const x = /^(\d{1,2}):(\d{2})/.exec(t || ''); return x ? Number(x[1]) * 60 + Number(x[2]) : null; }; const d = m(b) - m(a); return m(a) != null && m(b) != null && d > 0 ? d : ''; };
      return { events: (data.events || []).filter(e => e && e.date && e.title).map(e => ({
        date: e.date, text: String(e.title).trim(), allDay: !!e.allDay, endDate: e.endDate || '',
        time: e.allDay ? '' : (/^\d{1,2}:\d{2}/.test(e.start || '') ? String(e.start).slice(0, 5).padStart(5, '0') : ''),
        mins: e.allDay ? '' : mins(e.start, e.end), approx: !!e.approx || (!e.allDay && !e.start),
      })) };
    }
    case 'schedule':
      return { entries: (data.entries || []).map(e => ({
        date: e.date,
        time: e.time || '',
        text: e.text,
      })) };
    case 'goals':
      return {
        roles: (data.roles || []).map(r => ({ name: r.name, why: r.why || '', monthly: r.monthly || '', weekly: r.weekly || '', daily: r.daily || '' })),
        goals: (data.goals || []).map(g => ({
          title: g.title,
          why: g.why || '',
          target: g.target || '',
          area: g.area || 'work',
          role: g.role || '',
          cadence: ['daily', 'weekly', 'monthly'].includes(g.cadence) ? g.cadence : 'once',
        })),
      };
    case 'workouts':
      return { workouts: (data.workouts || []).map(w => ({
        date: w.date,
        type: w.type,
        minutes: w.minutes || '',
        details: w.details || '',
      })) };
    case 'weights':
      return { weights: (data.weights || []).map(w => ({
        date: w.date,
        value: parseFloat(w.value) || w.value,
      })) };
    case 'habits':
      return { habits: (data.habits || []).map(h => ({
        name: h.name,
        target: h.target || 5,
      })) };
    case 'shopping':
      return { items: (data.items || []).map(i => ({ text: i.text || i })) };
    case 'journal':
      return { text: data.text || '' };
    case 'bucket':
      return { items: (data.items || []).map(i => ({
        text: i.text,
        budget: i.budget || '',
        target: i.target || '',
      })) };
    case 'reading':
      return { items: (data.items || []).map(i => ({
        title: i.title,
        by: i.by || '',
        genre: i.genre || '',
      })) };
    case 'projects':
      return { projects: (data.projects || []).map(p => ({
        name: p.name,
        steps: (p.steps || []).map(s => ({ text: s.text || s })),
      })) };
    case 'events':
      return { events: (data.events || []).map(e => ({
        date: e.date,
        text: e.text,
        yearly: e.yearly || false,
      })) };
    case 'page':
      return normalizePage(data);
    case 'reflections':
      return {
        progress: data.progress || '',
        improve: data.improve || '',
        memories: data.memories || '',
      };
    default:
      return data;
  }
}


/* ---------- planner pages (daily, weekly, monthly, rapid log, habit grid) ---------- */
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const textOf = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? v.text : '');
const clean = (v, n = 300) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const isoOr = (v) => (ISO.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) ? String(v) : '');
const hhmm = (v) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(v || '')); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };
const minsBetween = (a, b) => { const x = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)); return a && b && x(b) > x(a) ? x(b) - x(a) : ''; };
const truthy = (v) => v === true || /^(true|yes|done|checked|x|✓|✔)$/i.test(String(v || ''));
const LAYOUTS = ['daily', 'weekly', 'monthly', 'rapidlog', 'habits', 'other'];

/* One shape for every planner page: priorities, schedule, tasks, notes, gratitude, habit days.
   Bullet-journal lines are routed by their symbol (event -> schedule, note -> notes, priority -> priorities). */
function normalizePage(data) {
  const d = data || {};
  const pageDate = isoOr(d.date);
  const out = { layout: LAYOUTS.includes(d.layout) ? d.layout : 'other', planner: clean(d.planner, 60), date: pageDate, priorities: [], schedule: [], tasks: [], notes: [], habits: [] };
  const seen = new Set(), once = (k) => { if (seen.has(k)) return false; seen.add(k); return true; };
  (Array.isArray(d.priorities) ? d.priorities : []).slice(0, 60).forEach((p) => {
    const text = clean(textOf(p)); if (!text) return;
    const date = isoOr(p.date) || pageDate;
    if (once(`p|${date}|${text.toLowerCase()}`)) out.priorities.push({ text, done: truthy(p.done), code: clean(p.code, 4).toUpperCase(), date });
  });
  (Array.isArray(d.schedule) ? d.schedule : []).slice(0, 200).forEach((e) => {
    const text = clean(textOf(e)); if (!text) return;
    const date = isoOr(e.date) || pageDate, start = e.allDay ? '' : hhmm(e.start), end = e.allDay ? '' : hhmm(e.end);
    if (once(`s|${date}|${start}|${text.toLowerCase()}`)) out.schedule.push({ date, time: start, mins: minsBetween(start, end), text, allDay: !!e.allDay || !start, approx: !!e.approx || !start });
  });
  (Array.isArray(d.tasks) ? d.tasks : []).slice(0, 300).forEach((t) => {
    const text = clean(textOf(t)); if (!text) return;
    const date = isoOr(t.date) || pageDate, kind = String(t.kind || 'task').toLowerCase();
    if (kind === 'event' || kind === 'scheduled') { if (once(`s|${date}||${text.toLowerCase()}`)) out.schedule.push({ date, time: '', mins: '', text, allDay: true, approx: true }); return; }
    if (kind === 'note' || kind === 'inspiration') { out.notes.push({ date, text }); return; }
    if (kind === 'priority') { if (once(`p|${date}|${text.toLowerCase()}`)) out.priorities.push({ text, done: false, code: '', date }); return; }
    if (once(`t|${date}|${text.toLowerCase()}`)) out.tasks.push({ text, done: kind === 'done' || truthy(t.done), date, migrated: kind === 'migrated' });
  });
  (Array.isArray(d.notes) ? d.notes : []).slice(0, 60).forEach((n) => { const text = clean(textOf(n), 2000); if (text) out.notes.push({ date: isoOr(n.date) || pageDate, text }); });
  const grat = (Array.isArray(d.gratitude) ? d.gratitude : []).map((g) => clean(textOf(g))).filter(Boolean).slice(0, 12);
  if (grat.length) out.notes.push({ date: pageDate, text: `Grateful for: ${grat.join('; ')}` });
  (Array.isArray(d.habits) ? d.habits : []).slice(0, 40).forEach((h) => {
    const name = clean(h && h.name, 80); if (!name) return;
    out.habits.push({ name, days: [...new Set((Array.isArray(h.days) ? h.days : []).map(isoOr).filter(Boolean))].sort() });
  });
  return out;
}

function getRoutingSuggestions(type, data) {
  const suggestions = [];

  switch (type) {
    case 'calendar':
      suggestions.push({ route: 'calendar', label: 'Review and add to my calendar', data });
      break;
    case 'schedule':
      suggestions.push({ route: 'schedule', label: 'Add to this week\'s schedule', data });
      suggestions.push({ route: 'calendar', label: 'Create Google Calendar events', data });
      break;
    case 'goals':
      suggestions.push({ route: 'goals', label: 'Add to Roles & Goals', data });
      suggestions.push({ route: 'journal', label: 'Add as journal entry', data: { text: JSON.stringify(data.goals, null, 2) } });
      break;
    case 'workouts':
      suggestions.push({ route: 'workouts', label: 'Log workouts in Track', data });
      break;
    case 'weights':
      suggestions.push({ route: 'weights', label: 'Log weights in Track', data });
      break;
    case 'habits':
      suggestions.push({ route: 'habits', label: 'Add to Week habits', data });
      break;
    case 'shopping':
      suggestions.push({ route: 'shopping', label: 'Add to Shopping list', data });
      break;
    case 'journal':
      suggestions.push({ route: 'journal', label: 'Save as journal entry', data: { text: data.text } });
      break;
    case 'bucket':
      suggestions.push({ route: 'bucket', label: 'Add to Bucket List', data });
      break;
    case 'reading':
      suggestions.push({ route: 'reading', label: 'Add to Reading list', data });
      break;
    case 'projects':
      suggestions.push({ route: 'projects', label: 'Create Projects', data });
      break;
    case 'events':
      suggestions.push({ route: 'events', label: 'Add Key Dates', data });
      suggestions.push({ route: 'calendar', label: 'Create Google Calendar events', data });
      break;
    case 'page':
      suggestions.push({ route: 'page', label: 'Review and add this planner page', data });
      break;
    case 'reflections':
          suggestions.push({ route: 'journal', label: 'Save as journal entry', data: { text: `Progress: ${data.progress}\nTo improve: ${data.improve}\nMemories: ${data.memories}` } });
      break;
    default:
      suggestions.push({ route: 'journal', label: 'Save as journal entry', data: { text: JSON.stringify(data) } });
  }

  return suggestions;
}

export { normalizeByType, normalizePage, getRoutingSuggestions };
export default { normalizeByType, normalizePage, getRoutingSuggestions };
