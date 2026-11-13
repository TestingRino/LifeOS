const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { start } = require('./helpers/fake-supabase.js');

process.env.VERCEL = '1';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.VAPID_PUBLIC_KEY = 'pub'; process.env.VAPID_PRIVATE_KEY = 'priv';
process.env.RESEND_API_KEY = 'rk'; process.env.DIGEST_FROM = 'Telos <d@example.com>';
process.env.CRON_SECRET = 'cron-secret'; process.env.SITE_URL = 'https://app.example/';

let sb, base, srv, D, push, mail, R;
const sent = { push: [], email: [] };
test.before(async () => {
  sb = await start();
  process.env.SUPABASE_URL = sb.url; process.env.SUPABASE_ANON_KEY = sb.anonKey; process.env.SUPABASE_SERVICE_ROLE_KEY = sb.serviceKey;
  sb.sessions['eyJann.p.s'] = { id: 'u1', email: 'ann@example.com' }; sb.sessions['eyJbob.p.s'] = { id: 'u2', email: 'bob@example.com' };
  const app = (await import('../server/app.js')).default;
  D = await import('../server/lib/digest.js'); push = await import('../server/lib/push.js'); mail = await import('../server/lib/email.js'); R = await import('../server/lib/reminders.js');
  push.setSender(async (sub, payload) => {
    if (/gone/.test(sub.endpoint)) { const e = new Error('gone'); e.statusCode = 410; throw e; }
    sent.push.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
  });
  mail.setSender(async (m) => { sent.email.push(m); });
  srv = http.createServer(app); await new Promise((r) => srv.listen(0, r)); base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => { srv.close(); sb.close(); push.setSender(); mail.setSender(); });
const api = (path, { token, method = 'GET', body, headers } = {}) => fetch(`${base}/api/reminders${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined });
const cron = (headers, method = 'POST') => fetch(`${base}/api/cron/digest`, { method, headers });
const reset = () => { sent.push.length = 0; sent.email.length = 0; };
const sub = (n) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } });

test('digest text: Big 3 first, no repeats, three names then +N more, first event', () => {
  const day = { big3: ['Finish the proposal', 'Call Dad'], tasks: ['call dad', 'Pay rent', 'Book dentist', 'Water plants'], events: [{ time: '14:00', text: 'Dentist' }, { time: '09:30', text: 'Team standup' }] };
  assert.equal(D.buildDigest(day).body, '5 tasks for today: Finish the proposal, Call Dad, Pay rent +2 more. First up: 9:30 Team standup');
  assert.equal(D.buildDigest({ big3: ['One thing'] }).body, '1 task for today: One thing');
  assert.equal(D.buildDigest({ events: [{ time: '', text: 'Retreat' }] }).body, 'First up: Retreat');
  assert.equal(D.buildDigest({ big3: [], tasks: [], events: [] }), null);
  const e = D.buildEmail(day, { appUrl: 'https://a/', unsubscribeUrl: 'https://u/?x=1&y=2' });
  assert.match(e.subject, /^Your Big 3 today: Finish the proposal, Call Dad/); assert.match(e.text, /Stop these emails: https:\/\/u/); assert.match(e.html, /x=1&amp;y=2/);
});

test('local date and time follow the time zone, including across the date line', () => {
  const now = Date.parse('2026-11-12T19:45:00Z');
  assert.deepEqual(D.localParts(now, 'Pacific/Auckland'), { date: '2026-11-13', time: '08:45' });
  assert.deepEqual(D.localParts(now, 'America/Los_Angeles'), { date: '2026-11-12', time: '11:45' });
  assert.equal(D.validTz('Mars/Base'), false); assert.equal(D.validTz('Europe/Paris'), true);
  const p = { tz: 'Pacific/Auckland', digest_time: '08:30', digest_push: true, last_digest: null };
  assert.deepEqual(D.dueForDigest(p, now), { due: true, date: '2026-11-13' });
  assert.equal(D.dueForDigest({ ...p, tz: 'America/Los_Angeles' }, now).date, '2026-11-12');          // same moment, an earlier local date
});
test('dueForDigest: not before the time, not twice, not without a channel', () => {
  const p = { tz: 'America/Los_Angeles', digest_time: '08:30', digest_push: true, last_digest: null };
  assert.equal(D.dueForDigest(p, Date.parse('2026-11-12T16:00:00Z')).due, false);                       // 08:00 local
  assert.equal(D.dueForDigest(p, Date.parse('2026-11-12T16:40:00Z')).due, true);                        // 08:40 local
  assert.equal(D.dueForDigest({ ...p, last_digest: '2026-11-12' }, Date.parse('2026-11-12T20:00:00Z')).due, false);
  assert.equal(D.dueForDigest({ ...p, last_digest: '2026-11-11' }, Date.parse('2026-11-12T20:00:00Z')).due, true);
  assert.equal(D.dueForDigest({ ...p, digest_push: false }, Date.parse('2026-11-12T20:00:00Z')).due, false);
});

test('reminder window: lead time before to 30 minutes after, once each', () => {
  const at = '2026-11-12T17:00:00Z', p = { lead_min: 10, sent: [], snapshot: { upcoming: [{ id: 'a', at, text: 'Team standup' }] } };
  assert.equal(D.dueReminders(p, Date.parse('2026-11-12T16:49:00Z')).length, 0);
  const r = D.dueReminders(p, Date.parse('2026-11-12T16:50:00Z'));
  assert.equal(r.length, 1); assert.equal(D.reminderBody(r[0]), 'Team standup in 10 minutes');
  assert.equal(D.dueReminders(p, Date.parse('2026-11-12T17:29:00Z')).length, 1);
  assert.equal(D.dueReminders(p, Date.parse('2026-11-12T17:30:00Z')).length, 0);
  assert.equal(D.dueReminders({ ...p, sent: ['a'] }, Date.parse('2026-11-12T16:55:00Z')).length, 0);
  assert.equal(D.dueReminders({ ...p, lead_min: 0 }, Date.parse('2026-11-12T16:55:00Z')).length, 0);
});

test('every reminders route needs a signed-in person', async () => {
  assert.equal((await api('/config')).status, 401);
  assert.equal((await api('/profile', { method: 'PUT', body: {} })).status, 401);
  assert.equal((await api('/push/subscribe', { method: 'POST', body: { subscription: sub(1) } })).status, 401);
  assert.equal((await api('/test', { method: 'POST' })).status, 401);
});

test('config, profile validation, truncation and sent-list pruning', async () => {
  const cfg = await (await api('/config', { token: 'eyJann.p.s' })).json();
  assert.deepEqual({ push: cfg.push, publicKey: cfg.publicKey, email: cfg.email, profile: cfg.profile }, { push: true, publicKey: 'pub', email: true, profile: null });
  const good = { tz: 'America/New_York', digestTime: '08:30', digestPush: true, digestEmail: false, leadMin: 10, snapshot: { days: {}, upcoming: [] } };
  for (const bad of [{ tz: 'Nope/Zone' }, { digestTime: '8:30' }, { digestTime: '24:00' }, { leadMin: 121 }, { leadMin: 1.5 }, { leadMin: -1 }]) assert.equal((await api('/profile', { token: 'eyJann.p.s', method: 'PUT', body: { ...good, ...bad } })).status, 400, JSON.stringify(bad));
  const days = {}; for (let d = 10; d < 17; d++) days[`2026-11-${d}`] = { big3: Array.from({ length: 30 }, (_, i) => 'x'.repeat(150) + i), tasks: [], events: [{ time: '9:5', text: 'ok' }] };
  const up = Array.from({ length: 80 }, (_, i) => ({ id: `e${i}`, at: '2026-11-12T17:00:00Z', text: 'Standup' }));
  const res = await api('/profile', { token: 'eyJann.p.s', method: 'PUT', body: { ...good, snapshot: { days, upcoming: up.slice(0, 80) } } });
  assert.equal(res.status, 200);
  const row = sb.db.reminder_profiles.find((r) => r.email === 'ann@example.com');
  assert.equal(Object.keys(row.snapshot.days).length, 4); assert.equal(row.snapshot.days['2026-11-10'].big3.length, 15); assert.equal(row.snapshot.days['2026-11-10'].big3[0].length, 120);
  assert.equal(row.snapshot.days['2026-11-10'].events[0].time, ''); assert.equal(row.snapshot.upcoming.length, 60);
  row.sent = ['e1', 'e70'];                                                                                  // e70 will no longer be upcoming
  await api('/profile', { token: 'eyJann.p.s', method: 'PUT', body: { ...good, snapshot: { days: {}, upcoming: up.slice(0, 5) } } });
  assert.deepEqual(sb.db.reminder_profiles.find((r) => r.email === 'ann@example.com').sent, ['e1']);
  assert.equal((await api('/profile', { token: 'eyJann.p.s', method: 'PUT', body: { ...good, snapshot: { days: { '2026-11-12': { big3: ['y'.repeat(70000)] } } } } })).status, 413);
  assert.equal((await (await api('/config', { token: 'eyJann.p.s' })).json()).profile.digestTime, '08:30');
});

test('subscribe validates, upserts, limits devices; unsubscribe only removes your own', async () => {
  const post = (token, subscription) => api('/push/subscribe', { token, method: 'POST', body: { subscription } });
  assert.equal((await post('eyJann.p.s', { endpoint: 'http://insecure.example/x', keys: { p256dh: 'a', auth: 'b' } })).status, 400);
  assert.equal((await post('eyJann.p.s', { endpoint: 'https://push.example/z' })).status, 400);
  assert.equal((await post('eyJann.p.s', sub(1))).status, 200); assert.equal((await post('eyJann.p.s', sub(1))).status, 200);
  assert.equal(sb.db.push_subscriptions.filter((s) => s.endpoint === sub(1).endpoint).length, 1);
  for (let i = 2; i <= 10; i++) await post('eyJann.p.s', sub(i));
  assert.equal((await post('eyJann.p.s', sub(11))).status, 400);
  await api('/push/unsubscribe', { token: 'eyJbob.p.s', method: 'POST', body: { endpoint: sub(1).endpoint } });
  assert.equal(sb.db.push_subscriptions.some((s) => s.endpoint === sub(1).endpoint), true);              // someone else cannot remove it
  await api('/push/unsubscribe', { token: 'eyJann.p.s', method: 'POST', body: { endpoint: sub(1).endpoint } });
  assert.equal(sb.db.push_subscriptions.some((s) => s.endpoint === sub(1).endpoint), false);
  sb.db.push_subscriptions.length = 0;
});

test('cron is authorised by secret: 401 when wrong or missing, 503 when unset, GET and POST work', async () => {
  assert.equal((await cron({})).status, 401);
  assert.equal((await cron({ Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await cron({ 'x-cron-secret': 'wrong' })).status, 401);
  assert.equal((await cron({ Authorization: 'Bearer cron-secret' })).status, 200);
  assert.equal((await cron({ 'x-cron-secret': 'cron-secret' }, 'GET')).status, 200);
  const keep = process.env.CRON_SECRET; delete process.env.CRON_SECRET;
  assert.equal((await cron({ Authorization: 'Bearer anything' })).status, 503);
  process.env.CRON_SECRET = keep;
});

test('cron sends the digest once per local day by push and email, and records it', async () => {
  reset(); sb.db.reminder_profiles.length = 0; sb.db.push_subscriptions.length = 0;
  const now = Date.parse('2026-11-12T20:00:00Z');                                                              // 12:00 in Los Angeles
  sb.db.reminder_profiles.push({ email: 'ann@example.com', tz: 'America/Los_Angeles', digest_time: '08:30', digest_push: true, digest_email: true, lead_min: 0, sent: [], last_digest: null,
    snapshot: { days: { '2026-11-12': { big3: ['Finish the proposal', 'Call Dad'], tasks: ['Pay rent'], events: [{ time: '09:30', text: 'Team standup' }] } }, upcoming: [] } });
  sb.db.push_subscriptions.push({ endpoint: sub(1).endpoint, email: 'ann@example.com', p256dh: 'p', auth: 'a' });
  const c = await R.runCron({ now, apiBase: 'https://api.example' });
  assert.equal(c.digestsPush, 1); assert.equal(c.digestsEmail, 1);
  assert.equal(sent.push[0].payload.body, '3 tasks for today: Finish the proposal, Call Dad, Pay rent. First up: 9:30 Team standup');
  assert.equal(sent.push[0].payload.title, 'Telos · today');
  assert.equal(sent.email[0].to, 'ann@example.com'); assert.match(sent.email[0].text, /api\.example\/api\/reminders\/unsubscribe\?e=ann%40example\.com&t=[0-9a-f]{64}/);
  assert.equal(sb.db.reminder_profiles[0].last_digest, '2026-11-12');
  reset(); await R.runCron({ now: now + 600000, apiBase: 'https://api.example' });
  assert.equal(sent.push.length + sent.email.length, 0);                                                      // idempotent
});

test('digest waits for a deliverable channel, and a day with nothing planned sends nothing but is marked', async () => {
  reset(); sb.db.reminder_profiles.length = 0; sb.db.push_subscriptions.length = 0;
  const now = Date.parse('2026-11-12T20:00:00Z');
  sb.db.reminder_profiles.push({ email: 'bob@example.com', tz: 'America/Los_Angeles', digest_time: '08:30', digest_push: true, digest_email: false, lead_min: 0, sent: [], last_digest: null, snapshot: { days: { '2026-11-12': { big3: ['A'] } } } });
  let c = await R.runCron({ now, apiBase: 'https://api.example' });
  assert.equal(c.skipped, 1); assert.equal(sb.db.reminder_profiles[0].last_digest, null);                       // push on but no device yet: not marked
  sb.db.push_subscriptions.push({ endpoint: sub(2).endpoint, email: 'bob@example.com', p256dh: 'p', auth: 'a' });
  sb.db.reminder_profiles[0].snapshot = { days: {} };
  await R.runCron({ now, apiBase: 'https://api.example' });
  assert.equal(sent.push.length, 0); assert.equal(sb.db.reminder_profiles[0].last_digest, '2026-11-12');
});

test('event reminders go out once, are remembered, and dead subscriptions are removed', async () => {
  reset(); sb.db.reminder_profiles.length = 0; sb.db.push_subscriptions.length = 0;
  sb.db.reminder_profiles.push({ email: 'ann@example.com', tz: 'UTC', digest_time: '08:30', digest_push: false, digest_email: false, lead_min: 10, sent: [], last_digest: null,
    snapshot: { days: {}, upcoming: [{ id: 'ev1', at: '2026-11-12T17:00:00Z', text: 'Team standup' }, { id: 'ev2', at: '2026-11-12T19:00:00Z', text: 'Later' }] } });
  sb.db.push_subscriptions.push({ endpoint: sub(1).endpoint, email: 'ann@example.com', p256dh: 'p', auth: 'a' }, { endpoint: 'https://push.example/gone', email: 'ann@example.com', p256dh: 'p', auth: 'a' });
  const now = Date.parse('2026-11-12T16:50:00Z');
  const c = await R.runCron({ now, apiBase: 'https://api.example' });
  assert.equal(c.reminders, 1); assert.equal(c.subsRemoved, 1);
  assert.equal(sent.push.length, 1); assert.equal(sent.push[0].payload.body, 'Team standup in 10 minutes');
  assert.deepEqual(sb.db.reminder_profiles[0].sent, ['ev1']);
  assert.equal(sb.db.push_subscriptions.some((s) => /gone/.test(s.endpoint)), false);
  reset(); await R.runCron({ now: now + 120000, apiBase: 'https://api.example' });
  assert.equal(sent.push.length, 0);
});

test('one failing profile does not stop the rest', async () => {
  reset(); sb.db.reminder_profiles.length = 0; sb.db.push_subscriptions.length = 0;
  const base = { tz: 'UTC', digest_time: '00:00', digest_push: true, digest_email: false, lead_min: 0, sent: [], last_digest: null };
  sb.db.reminder_profiles.push({ ...base, email: 'a@example.com', tz: 'Bad/Zone', snapshot: {} }, { ...base, email: 'b@example.com', snapshot: { days: { '2026-11-12': { big3: ['Go'] } } } });
  sb.db.push_subscriptions.push({ endpoint: sub(3).endpoint, email: 'b@example.com', p256dh: 'p', auth: 'a' });
  await R.runCron({ now: Date.parse('2026-11-12T10:00:00Z'), apiBase: 'https://api.example' });
  assert.equal(sent.push.length, 1);
});

test('unsubscribe link: valid signature turns the email digest off, bad or missing ones do not', async () => {
  sb.db.reminder_profiles.length = 0;
  sb.db.reminder_profiles.push({ email: 'ann@example.com', digest_email: true, digest_push: false, lead_min: 0, tz: 'UTC', digest_time: '08:30', snapshot: {}, sent: [] });
  const tok = mail.sign('ann@example.com');
  assert.equal((await fetch(`${base}/api/reminders/unsubscribe?e=ann%40example.com&t=${'0'.repeat(64)}`)).status, 400);
  assert.equal((await fetch(`${base}/api/reminders/unsubscribe?e=ann%40example.com&t=short`)).status, 400);
  assert.equal((await fetch(`${base}/api/reminders/unsubscribe?e=bob%40example.com&t=${tok}`)).status, 400);     // a token only works for its own address
  assert.equal(sb.db.reminder_profiles[0].digest_email, true);
  assert.equal((await fetch(`${base}/api/reminders/unsubscribe?e=ann%40example.com&t=${tok}`)).status, 200);
  assert.equal(sb.db.reminder_profiles[0].digest_email, false);
});

test('test endpoint sends a push to every device and reports it', async () => {
  reset(); sb.db.push_subscriptions.length = 0;
  sb.db.push_subscriptions.push({ endpoint: sub(5).endpoint, email: 'ann@example.com', p256dh: 'p', auth: 'a' }, { endpoint: sub(6).endpoint, email: 'bob@example.com', p256dh: 'p', auth: 'a' });
  const r = await (await api('/test', { token: 'eyJann.p.s', method: 'POST' })).json();
  assert.equal(r.push, 1); assert.equal(r.email, false);                                                      // ann's email digest is now off
  assert.equal(sent.push[0].endpoint, sub(5).endpoint);
});
