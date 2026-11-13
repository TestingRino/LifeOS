/* Pure logic for the morning digest and event reminders: no network, no clock of its own, so it is easy to test. */

export const validTz = (tz) => {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
};

/* The local calendar date and clock time ('YYYY-MM-DD', 'HH:MM') in a time zone at a moment. */
export function localParts(now, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(now)).reduce((o, p) => { o[p.type] = p.value; return o; }, {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` };
}

const clip = (t, n = 120) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, n);
const fmtTime = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); return m ? `${Number(m[1])}:${m[2]}` : ''; };

/* Names to show: the Big 3 first, then the rest of the tasks, without repeats. */
export function digestNames(day) {
  const seen = new Set(), out = [];
  [...((day && day.big3) || []), ...((day && day.tasks) || [])].forEach((t) => {
    const x = clip(t), k = x.toLowerCase();
    if (x && !seen.has(k)) { seen.add(k); out.push(x); }
  });
  return out;
}
/* The earliest timed event (untimed ones only if nothing has a time). */
export function firstUp(day) {
  const ev = ((day && day.events) || []).map((e) => ({ time: /^\d{1,2}:\d{2}$/.test(e.time || '') ? e.time.padStart(5, '0') : '', text: clip(e.text) })).filter((e) => e.text);
  if (!ev.length) return null;
  ev.sort((a, b) => (a.time || '99') < (b.time || '99') ? -1 : (a.time || '99') > (b.time || '99') ? 1 : 0);
  const e = ev[0];
  return e.time ? `${fmtTime(e.time)} ${e.text}` : e.text;
}

/* The push notification for one day, or null when there is nothing to say. */
export function buildDigest(day, { max = 3 } = {}) {
  const names = digestNames(day), up = firstUp(day);
  if (!names.length && !up) return null;
  const shown = names.slice(0, max), more = names.length - shown.length;
  let body = names.length ? `${names.length} ${names.length === 1 ? 'task' : 'tasks'} for today: ${shown.join(', ')}${more > 0 ? ` +${more} more` : ''}` : '';
  if (up) body += `${body ? '. ' : ''}First up: ${up}`;
  return { title: 'Telos · today', body, url: '#/today', tag: 'telos-digest' };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/* The email for one day. */
export function buildEmail(day, { appUrl = '', unsubscribeUrl = '' } = {}) {
  const big3 = [...new Set(((day && day.big3) || []).map((t) => clip(t)).filter(Boolean))].slice(0, 3);
  const rest = digestNames({ tasks: (day && day.tasks) || [] }).filter((t) => !big3.some((b) => b.toLowerCase() === t.toLowerCase())).slice(0, 12);
  const events = ((day && day.events) || []).map((e) => ({ time: fmtTime(e.time), text: clip(e.text) })).filter((e) => e.text).slice(0, 12);
  const subject = big3.length ? `Your Big 3 today: ${big3.join(', ')}`.slice(0, 120) : 'Your day with Telos';
  const text = [
    big3.length ? `Your Big 3 today:\n${big3.map((t, i) => `${i + 1}. ${t}`).join('\n')}` : '',
    rest.length ? `Also on your list:\n${rest.map((t) => `- ${t}`).join('\n')}` : '',
    events.length ? `On your calendar:\n${events.map((e) => `${e.time ? `${e.time}  ` : ''}${e.text}`).join('\n')}` : '',
    appUrl ? `Open Telos: ${appUrl}` : '',
    unsubscribeUrl ? `Stop these emails: ${unsubscribeUrl}` : '',
  ].filter(Boolean).join('\n\n');
  const list = (items) => `<ul style="padding-left:1.2em;margin:.3em 0 1em">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
  const html = `<div style="font-family:Georgia,serif;color:#2a2622;max-width:34rem;margin:0 auto;line-height:1.5">
<h2 style="font-weight:600;margin:0 0 .6em">Planning for what matters.</h2>
${big3.length ? `<p style="margin:0"><strong>Your Big 3 today</strong></p><ol style="padding-left:1.2em;margin:.3em 0 1em">${big3.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>` : ''}
${rest.length ? `<p style="margin:0"><strong>Also on your list</strong></p>${list(rest)}` : ''}
${events.length ? `<p style="margin:0"><strong>On your calendar</strong></p>${list(events.map((e) => `${e.time ? `${e.time}  ` : ''}${e.text}`))}` : ''}
${appUrl ? `<p><a href="${esc(appUrl)}">Open Telos</a></p>` : ''}
${unsubscribeUrl ? `<p style="font-size:12px;color:#6b6155"><a href="${esc(unsubscribeUrl)}" style="color:#6b6155">Stop these emails</a></p>` : ''}</div>`;
  return { subject, text, html };
}

/* Is this person's morning digest due? Their local time has reached digest_time and today's has not gone out. */
export function dueForDigest(profile, now) {
  if (!profile || !(profile.digest_push || profile.digest_email) || !validTz(profile.tz)) return { due: false, date: '' };
  const { date, time } = localParts(now, profile.tz);
  return { due: time >= (profile.digest_time || '08:30') && String(profile.last_digest || '').slice(0, 10) !== date, date };
}

/* Upcoming items to remind about now: from lead_min minutes before until 30 minutes after, once each. */
export function dueReminders(profile, now) {
  const lead = Number(profile && profile.lead_min) || 0;
  if (lead <= 0) return [];
  const sent = new Set((profile.sent || []).map(String));
  const t = new Date(now).getTime();
  return (((profile.snapshot || {}).upcoming) || []).filter((u) => {
    const at = Date.parse(u.at);
    return Number.isFinite(at) && !sent.has(String(u.id)) && t >= at - lead * 60000 && t < at + 30 * 60000;
  }).map((u) => ({ id: String(u.id), text: clip(u.text), minutes: Math.max(0, Math.round((Date.parse(u.at) - t) / 60000)) }));
}
export const reminderBody = (r) => (r.minutes <= 0 ? `${r.text} is starting now` : `${r.text} in ${r.minutes} minute${r.minutes === 1 ? '' : 's'}`);
