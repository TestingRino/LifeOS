import { rest } from './supa.js';
import { validTz, dueForDigest, dueReminders, buildDigest, buildEmail, reminderBody } from './digest.js';
import * as push from './push.js';
import * as mail from './email.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/, DAY = /^\d{4}-\d{2}-\d{2}$/;
const clip = (t, n = 120) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, n);
const list = (a, f) => (Array.isArray(a) ? a : []).slice(0, 15).map(f).filter(Boolean);
export const MAX_BODY = 64 * 1024, MAX_SUBS = 10;

/* Validates and trims what the app uploads. Returns { error } or { value } (columns of reminder_profiles). */
export function sanitizeProfile(b, prev) {
  if (!b || typeof b !== 'object') return { error: 'Send a JSON body.' };
  if (JSON.stringify(b).length > MAX_BODY) return { error: 'That is too large.', status: 413 };
  if (!validTz(b.tz)) return { error: 'Unknown time zone.' };
  if (!HHMM.test(String(b.digestTime || ''))) return { error: 'digestTime must look like 08:30.' };
  const lead = Number(b.leadMin);
  if (!Number.isInteger(lead) || lead < 0 || lead > 120) return { error: 'leadMin must be a whole number from 0 to 120.' };
  const snap = b.snapshot && typeof b.snapshot === 'object' ? b.snapshot : {};
  const days = {};
  Object.keys(snap.days && typeof snap.days === 'object' ? snap.days : {}).filter((k) => DAY.test(k)).sort().slice(0, 4).forEach((k) => {
    const d = snap.days[k] || {};
    days[k] = {
      big3: list(d.big3, (t) => clip(t)), tasks: list(d.tasks, (t) => clip(t)),
      events: list(d.events, (e) => (e && clip(e.text) ? { time: HHMM.test(String(e.time || '')) ? e.time : '', text: clip(e.text) } : null)),
    };
  });
  const upcoming = (Array.isArray(snap.upcoming) ? snap.upcoming : []).slice(0, 60)
    .map((u) => (u && u.id != null && clip(u.text) && Number.isFinite(Date.parse(u.at)) ? { id: clip(u.id, 64), at: new Date(u.at).toISOString(), text: clip(u.text) } : null)).filter(Boolean);
  const ids = new Set(upcoming.map((u) => u.id));
  const sent = ((prev && prev.sent) || []).map(String).filter((id) => ids.has(id));
  return { value: { tz: b.tz, digest_time: b.digestTime, digest_push: !!b.digestPush, digest_email: !!b.digestEmail, lead_min: lead, snapshot: { days, upcoming }, sent } };
}
export const toApiProfile = (r) => (r ? { tz: r.tz, digestTime: r.digest_time, digestPush: !!r.digest_push, digestEmail: !!r.digest_email, leadMin: r.lead_min } : null);

export async function getProfile(email) {
  const [row = null] = await rest('reminder_profiles', { query: { email: `eq.${email}`, select: '*', limit: 1 } });
  return row;
}
export const saveProfile = (email, value) => rest('reminder_profiles', { method: 'POST', query: { on_conflict: 'email' }, body: { email, ...value, updated_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates,return=minimal' });
export const subsFor = (email) => rest('push_subscriptions', { query: { email: `eq.${email}`, select: '*' } });
export const dropSub = (endpoint) => rest('push_subscriptions', { method: 'DELETE', query: { endpoint: `eq.${endpoint}` } });

/* Sends one payload to every subscription of a person. Dead subscriptions are removed. */
export async function pushAll(subs, payload, counts) {
  let ok = 0;
  for (const s of subs) {
    const r = await push.sendPush(s, payload);
    if (r.ok) ok += 1;
    else if (r.gone) { await dropSub(s.endpoint).catch(() => {}); if (counts) counts.subsRemoved += 1; }
  }
  return ok;
}

/* One pass of the scheduler: morning digests that have come due, then event reminders. Safe to run as often as you like:
   a digest goes out once per local day and each reminder once. Delivery is as precise as how often this is triggered. */
export async function runCron({ now = new Date(), apiBase = '', appUrl = process.env.SITE_URL || '' } = {}) {
  const counts = { profiles: 0, digestsPush: 0, digestsEmail: 0, reminders: 0, skipped: 0, errors: 0, subsRemoved: 0 };
  const subsBy = new Map();
  for (let off = 0; ; off += 500) {
    const page = await rest('push_subscriptions', { query: { select: '*', order: 'endpoint.asc', limit: 500, offset: off } });
    page.forEach((s) => { if (!subsBy.has(s.email)) subsBy.set(s.email, []); subsBy.get(s.email).push(s); });
    if (page.length < 500) break;
  }
  const profiles = [];
  for (let off = 0; ; off += 200) {
    const page = await rest('reminder_profiles', { query: { select: '*', order: 'email.asc', limit: 200, offset: off, or: '(digest_push.eq.true,digest_email.eq.true,lead_min.gt.0)' } });
    profiles.push(...page);
    if (page.length < 200) break;
  }
  const emailOk = mail.configured() && mail.canSign() && !!apiBase;
  const one = async (p) => {
    counts.profiles += 1;
    const subs = subsBy.get(p.email) || [], patch = {};
    const dd = dueForDigest(p, now);
    if (dd.due) {
      const canPush = !!p.digest_push && push.configured() && subs.length > 0, canMail = !!p.digest_email && emailOk;
      if (!canPush && !canMail) counts.skipped += 1;          // nowhere to deliver yet: leave it, so it goes out once a channel works
      else {
        const day = ((p.snapshot || {}).days || {})[dd.date], note = buildDigest(day);
        if (!note) patch.last_digest = dd.date;               // nothing planned: nothing to send, and do not look again today
        else {
          let delivered = 0;
          if (canPush && await pushAll(subs, note, counts) > 0) { counts.digestsPush += 1; delivered += 1; }
          if (canMail) {
            const r = await mail.sendEmail({ to: p.email, ...buildEmail(day, { appUrl, unsubscribeUrl: mail.unsubscribeUrl(apiBase, p.email) }) });
            if (r.ok) { counts.digestsEmail += 1; delivered += 1; }
          }
          if (delivered) patch.last_digest = dd.date; else counts.errors += 1;
        }
      }
    }
    if (push.configured() && subs.length) {
      const due = dueReminders(p, now), sent = [...(p.sent || [])];
      for (const r of due) {
        const n = await pushAll(subs, { title: 'Telos', body: reminderBody(r), url: '#/today', tag: `telos-${r.id}` }, counts);
        if (n > 0) { sent.push(r.id); counts.reminders += 1; }
      }
      if (sent.length !== (p.sent || []).length) patch.sent = sent;
    }
    if (Object.keys(patch).length) await rest('reminder_profiles', { method: 'PATCH', query: { email: `eq.${p.email}` }, body: patch });
  };
  for (let i = 0; i < profiles.length; i += 5) {
    await Promise.all(profiles.slice(i, i + 5).map((p) => one(p).catch((e) => { counts.errors += 1; console.warn('reminder failed for one profile:', e.message); })));
  }
  return counts;
}
