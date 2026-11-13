import express from 'express';
import crypto from 'node:crypto';
import { identify } from '../middleware/requireUser.js';
import { configured } from '../lib/supa.js';
import { rest } from '../lib/supa.js';
import * as push from '../lib/push.js';
import * as mail from '../lib/email.js';
import { buildDigest, buildEmail } from '../lib/digest.js';
import { sanitizeProfile, toApiProfile, getProfile, saveProfile, subsFor, pushAll, runCron, MAX_SUBS } from '../lib/reminders.js';

/* Push subscriptions, reminder settings and the scheduled digest. Everything is keyed by the signed-in person's email. */
const router = express.Router();
export const cronRouter = express.Router();

async function who(req, res, next) {
  if (!configured()) return res.status(503).json({ error: 'Reminders need the server to be connected to Supabase (see DEPLOY.md).' });
  const w = await identify(req);
  if (w.error) return res.status(w.status).json({ error: w.error });
  req.email = w.email; next();
}
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.warn('reminders error:', e.message); res.status(500).json({ error: 'Something went wrong. Please try again.' }); });
const apiBaseOf = (req) => process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`;

router.get('/config', who, wrap(async (req, res) => {
  res.json({ push: push.configured(), publicKey: push.configured() ? push.publicKey() : null, email: mail.configured() && mail.canSign(), profile: toApiProfile(await getProfile(req.email)) });
}));

router.put('/profile', who, wrap(async (req, res) => {
  const r = sanitizeProfile(req.body, await getProfile(req.email));
  if (r.error) return res.status(r.status || 400).json({ error: r.error });
  await saveProfile(req.email, r.value);
  res.json({ ok: true });
}));

router.post('/push/subscribe', who, wrap(async (req, res) => {
  const s = (req.body || {}).subscription || {};
  let ok = typeof s.endpoint === 'string' && s.endpoint.length <= 1000 && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string' && s.keys.p256dh.length < 200 && s.keys.auth.length < 100;
  try { ok = ok && new URL(s.endpoint).protocol === 'https:'; } catch (e) { ok = false; }
  if (!ok) return res.status(400).json({ error: 'That push subscription is not valid.' });
  const mine = await subsFor(req.email);
  if (mine.length >= MAX_SUBS && !mine.some((x) => x.endpoint === s.endpoint)) return res.status(400).json({ error: 'This account already has the most devices it can have. Turn reminders off on one first.' });
  await rest('push_subscriptions', { method: 'POST', query: { on_conflict: 'endpoint' }, body: { endpoint: s.endpoint, email: req.email, p256dh: s.keys.p256dh, auth: s.keys.auth, user_agent: String(req.headers['user-agent'] || '').slice(0, 200) }, prefer: 'resolution=merge-duplicates,return=minimal' });
  res.json({ ok: true });
}));

router.post('/push/unsubscribe', who, wrap(async (req, res) => {
  const endpoint = String((req.body || {}).endpoint || '');
  if (!endpoint) return res.status(400).json({ error: 'Send the endpoint to remove.' });
  await rest('push_subscriptions', { method: 'DELETE', query: { endpoint: `eq.${endpoint}`, email: `eq.${req.email}` } });
  res.json({ ok: true });
}));

router.post('/test', who, wrap(async (req, res) => {
  const out = { push: 0, email: false };
  const counts = { subsRemoved: 0 };
  if (push.configured()) out.push = await pushAll(await subsFor(req.email), { title: 'Telos', body: 'Reminders are on. This is what they will look like.', url: '#/today', tag: 'telos-test' }, counts);
  const p = await getProfile(req.email);
  if (p && p.digest_email && mail.configured() && mail.canSign()) {
    const day = { big3: ['Your most important thing'], tasks: [], events: [] };
    out.email = (await mail.sendEmail({ to: req.email, ...buildEmail(day, { appUrl: process.env.SITE_URL || '', unsubscribeUrl: mail.unsubscribeUrl(apiBaseOf(req), req.email) }) })).ok;
  }
  res.json(out);
}));

/* Public: the link at the bottom of every email. */
router.get('/unsubscribe', wrap(async (req, res) => {
  const email = String(req.query.e || '').toLowerCase();
  res.type('html');
  if (!email || !mail.verify(email, String(req.query.t || ''))) return res.status(400).send('<p style="font-family:Georgia,serif">This link is not valid.</p>');
  if (configured()) await rest('reminder_profiles', { method: 'PATCH', query: { email: `eq.${email}` }, body: { digest_email: false } });
  res.send('<p style="font-family:Georgia,serif">You will not get the morning email any more. You can turn it back on in Telos, under Settings.</p>');
}));

/* Scheduled: GET (Vercel Cron) or POST (anything else) with the CRON_SECRET. */
const authCron = (req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET is not set.' });
  const given = (/^Bearer (.+)$/i.exec(req.headers.authorization || '') || [])[1] || req.headers['x-cron-secret'] || '';
  const a = crypto.createHash('sha256').update(String(given)).digest(), b = crypto.createHash('sha256').update(secret).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Not authorised.' });
  next();
};
const runIt = wrap(async (req, res) => {
  if (!configured()) return res.status(503).json({ error: 'Supabase is not configured.' });
  res.json(await runCron({ apiBase: apiBaseOf(req) }));
});
cronRouter.get('/digest', authCron, runIt);
cronRouter.post('/digest', authCron, runIt);

export default router;
