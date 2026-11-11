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
    case 'reflections':
          suggestions.push({ route: 'journal', label: 'Save as journal entry', data: { text: `Progress: ${data.progress}\nTo improve: ${data.improve}\nMemories: ${data.memories}` } });
      break;
    default:
      suggestions.push({ route: 'journal', label: 'Save as journal entry', data: { text: JSON.stringify(data) } });
  }

  return suggestions;
}

export { normalizeByType, getRoutingSuggestions };
export default { normalizeByType, getRoutingSuggestions };
