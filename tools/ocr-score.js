/* Scores what the photo reader returned against what a person says is on the page.
   Pure functions, no network: used by tools/ocr-eval.js and unit tested. */
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => new Set(norm(s).split(' ').filter(Boolean));
function similarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.size && !B.size) return 1;
  let inter = 0; A.forEach((w) => { if (B.has(w)) inter++; });
  return (2 * inter) / (A.size + B.size);        // Dice: forgiving when the reader adds or drops a word
}
const mins = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/* What counts as "an item" for each kind of page. */
function items(type, data) {
  const d = data || {};
  switch (type) {
    case 'goals': return [...(d.roles || []).map((r) => ({ kind: 'role', text: r.name })), ...(d.goals || []).map((g) => ({ kind: 'goal', text: g.title }))];
    case 'calendar': return (d.events || []).map((e) => ({ kind: 'event', text: e.text || e.title, date: e.date, time: e.time || e.start || '' }));
    case 'workouts': return (d.workouts || []).map((w) => ({ kind: 'workout', text: w.type, date: w.date }));
    case 'habits': return (d.habits || []).map((h) => ({ kind: 'habit', text: h.name }));
    case 'events': return (d.events || []).map((e) => ({ kind: 'date', text: e.text, date: e.date }));
    case 'schedule': return (d.entries || []).map((e) => ({ kind: 'entry', text: e.text, date: e.date, time: e.time }));
    case 'reading': return (d.items || []).map((x) => ({ kind: 'book', text: x.title }));
    case 'projects': return (d.projects || []).map((p) => ({ kind: 'project', text: p.name }));
    case 'weights': return (d.weights || []).map((w) => ({ kind: 'weight', text: String(w.value), date: w.date }));
    default: return (d.items || []).map((x) => ({ kind: 'item', text: x.text }));   // shopping, bucket
  }
}
function same(a, b, threshold) {
  if (a.kind !== b.kind) return false;
  if (a.date && b.date && a.date !== b.date) return false;
  if (a.time && b.time && mins(a.time) != null && mins(b.time) != null && Math.abs(mins(a.time) - mins(b.time)) > 15) return false;
  return similarity(a.text, b.text) >= (threshold || 0.6);
}
/* Greedy one-to-one matching of expected items to read items. */
function score(type, expected, actual, threshold) {
  const exp = items(type, expected), got = items(type, actual), used = new Set(), missed = [];
  let tp = 0;
  exp.forEach((e) => {
    const i = got.findIndex((g, k) => !used.has(k) && same(e, g, threshold));
    if (i >= 0) { used.add(i); tp++; } else missed.push(e);
  });
  const extra = got.filter((_, k) => !used.has(k));
  const precision = got.length ? tp / got.length : (exp.length ? 0 : 1), recall = exp.length ? tp / exp.length : 1;
  return { expected: exp.length, read: got.length, matched: tp, precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, missed, extra };
}
module.exports = { norm, similarity, items, score };
