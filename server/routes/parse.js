export function parseOCRResult(ocrData, type = 'auto') {
  if (type === 'auto') {
    return {
      detected: ocrData.type,
      parsed: ocrData.data,
      confidence: 'high',
      suggestions: getRoutingSuggestions(ocrData.type, ocrData.data),
    };
  }

  const parsed = normalizeByType(type, ocrData);
  return {
    type,
    parsed,
    suggestions: getRoutingSuggestions(type, parsed),
  };
}

function normalizeByType(type, data) {
  switch (type) {
    case 'schedule':
      return { entries: (data.entries || []).map(e => ({
        date: e.date,
        time: e.time || '',
        text: e.text,
      })) };
    case 'goals':
      return { goals: (data.goals || []).map(g => ({
        title: g.title,
        why: g.why || '',
        target: g.target || '',
        area: g.area || 'work',
      })) };
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
    case 'schedule':
      suggestions.push({ route: 'schedule', label: 'Add to this week\'s schedule', data: data.entries });
      suggestions.push({ route: 'calendar', label: 'Create Google Calendar events', data: data.entries });
      break;
    case 'goals':
      suggestions.push({ route: 'goals', label: 'Add to Roles & Goals', data: data.goals });
      suggestions.push({ route: 'journal', label: 'Add as journal entry', data: { text: JSON.stringify(data.goals, null, 2) } });
      break;
    case 'workouts':
      suggestions.push({ route: 'workouts', label: 'Log workouts in Track', data: data.workouts });
      break;
    case 'weights':
      suggestions.push({ route: 'weights', label: 'Log weights in Track', data: data.weights });
      break;
    case 'habits':
      suggestions.push({ route: 'habits', label: 'Add to Week habits', data: data.habits });
      break;
    case 'shopping':
      suggestions.push({ route: 'shopping', label: 'Add to Shopping list', data: data.items });
      break;
    case 'journal':
      suggestions.push({ route: 'journal', label: 'Save as journal entry', data: { text: data.text } });
      break;
    case 'bucket':
      suggestions.push({ route: 'bucket', label: 'Add to Bucket List', data: data.items });
      break;
    case 'reading':
      suggestions.push({ route: 'reading', label: 'Add to Reading list', data: data.items });
      break;
    case 'projects':
      suggestions.push({ route: 'projects', label: 'Create Projects', data: data.projects });
      break;
    case 'events':
      suggestions.push({ route: 'events', label: 'Add Key Dates', data: data.events });
      suggestions.push({ route: 'calendar', label: 'Create Google Calendar events', data: data.events });
      break;
    case 'reflections':
      suggestions.push({ route: 'reflection', label: 'Save month/week reflection', data });
      suggestions.push({ route: 'journal', label: 'Save as journal entry', data: { text: `Progress: ${data.progress}\nTo improve: ${data.improve}\nMemories: ${data.memories}` } });
      break;
    default:
      suggestions.push({ route: 'journal', label: 'Save as journal entry', data: { text: JSON.stringify(data) } });
  }

  return suggestions;
}

export default { parseOCRResult, normalizeByType, getRoutingSuggestions };
