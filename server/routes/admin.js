import express from 'express';
import { configured, rest, listUsers, userFromToken } from '../lib/supa.js';
import { getSettings, effectiveAccess, inEnvList, clearCaches, forgetEntitlement, DEFAULT_TIERS, DEFAULT_FLAGS } from '../lib/entitlements.js';

/* The admin API behind the in-app admin page. Every route first proves the caller is an admin:
   a valid Supabase session whose account is in ADMIN_EMAILS (bootstrap) or the admins table. */
const router = express.Router();
const adminEmails = () => String(process.env.ADMIN_EMAILS || '').split(/[,\s;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const TIERS = ['free', 'plus'], STATUSES = ['active', 'suspended', 'canceled', 'past_due'];

export async function requireAdmin(req, res, next) {
  if (!configured()) return res.status(503).json({ error: 'Accounts are not configured on the server (SUPABASE_SERVICE_ROLE_KEY).' });
  const m = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
  if (!m) return res.status(401).json({ error: 'Sign in first.' });
  const who = await userFromToken(m[1]);
  if (!who || !who.confirmed) return res.status(401).json({ error: 'Please sign in again.' });
  let admin = adminEmails().includes(who.email);
  if (!admin) { try { admin = (await rest('admins', { query: { user_id: `eq.${who.id}`, select: 'user_id', limit: 1 } })).length > 0; } catch (e) { admin = false; } }
  if (!admin) return res.status(403).json({ error: 'Not an admin.' });
  req.admin = who;
  next();
}
router.use(requireAdmin);
router.use(express.json({ limit: '16kb' }));

router.get('/me', (req, res) => res.json({ admin: true, email: req.admin.email }));

router.get('/overview', async (req, res) => {
  try {
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const [users, ents, wl, usage, settings] = await Promise.all([
      listUsers(), rest('entitlements', { query: { select: '*' } }), rest('waitlist', { query: { select: '*', order: 'created_at.desc', limit: 500 } }),
      rest('usage_daily', { query: { select: '*', day: `gte.${day(7)}` } }), getSettings(),
    ]);
    const entBy = new Map(ents.map((e) => [e.email, e])), today = day(0);
    const use = new Map();
    usage.forEach((u) => { const o = use.get(u.email) || { today: 0, week: 0 }; o.week += u.ocr_count; if (u.day === today) o.today += u.ocr_count; use.set(u.email, o); });
    const accessOf = (email) => effectiveAccess(entBy.get(email) || null, settings, { envListed: inEnvList(email) });
    const seen = new Set();
    const people = users.map((u) => {
      const email = String(u.email || '').toLowerCase(); seen.add(email);
      const e = entBy.get(email) || null, a = accessOf(email), us = use.get(email) || { today: 0, week: 0 };
      return { email, user_id: u.id, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at || '', provider: (u.app_metadata && u.app_metadata.provider) || '',
        tier: e ? e.tier : 'free', status: e ? e.status : 'active', ocr_override: e ? e.ocr : null, ocr_hourly: e ? e.ocr_hourly : null, ocr_daily: e ? e.ocr_daily : null, source: e ? e.source : '', notes: e ? e.notes : '',
        stripe: !!(e && e.stripe_customer_id), photo_import: a.allowed, via_env: !!inEnvList(email), usage_today: us.today, usage_7d: us.week };
    });
    ents.filter((e) => !seen.has(e.email)).forEach((e) => {       // approved or paid, but no account yet
      const a = accessOf(e.email), us = use.get(e.email) || { today: 0, week: 0 };
      people.push({ email: e.email, user_id: e.user_id || '', created_at: e.created_at, last_sign_in_at: '', provider: '', tier: e.tier, status: e.status, ocr_override: e.ocr, ocr_hourly: e.ocr_hourly, ocr_daily: e.ocr_daily, source: e.source, notes: e.notes, stripe: !!e.stripe_customer_id, photo_import: a.allowed, via_env: !!inEnvList(e.email), usage_today: us.today, usage_7d: us.week, no_account: true });
    });
    people.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const accounts = new Set(people.filter((p) => !p.no_account).map((p) => p.email));
    const waitlist = wl.map((w) => ({ id: w.id, email: w.email, planner: w.planner, other: w.other, source: w.source, status: w.status || 'new', created_at: w.created_at, has_account: accounts.has(String(w.email).toLowerCase()) }));
    const counts = {};
    waitlist.forEach((w) => { const k = w.planner === 'other' && w.other ? `other: ${w.other}` : w.planner || 'unspecified'; counts[k] = (counts[k] || 0) + 1; });
    const planners = Object.entries(counts).map(([planner, count]) => ({ planner, count })).sort((a, b) => b.count - a.count);
    res.json({
      totals: { users: users.length, new_7d: users.filter((u) => String(u.created_at) >= `${day(7)}`).length, paid: ents.filter((e) => e.tier === 'plus' && e.status === 'active').length,
        waitlist_new: waitlist.filter((w) => w.status === 'new').length, waitlist_total: waitlist.length, photo_import_today: usage.filter((u) => u.day === today).reduce((a, u) => a + u.ocr_count, 0), photo_import_7d: usage.reduce((a, u) => a + u.ocr_count, 0) },
      people, waitlist, planners, settings, env: { ocr_allowed_emails: inEnvList('*') ? 'everyone' : process.env.OCR_ALLOWED_EMAILS ? String(process.env.OCR_ALLOWED_EMAILS).split(/[,\s;]+/).filter(Boolean).length : 0, hourly: Number(process.env.OCR_HOURLY_LIMIT) || 20, daily: Number(process.env.OCR_DAILY_LIMIT) || 60 },
    });
  } catch (e) { console.error('admin overview failed:', e.message); res.status(502).json({ error: 'Could not load data from Supabase.' }); }
});

const int = (v) => (v === '' || v === null || v === undefined ? null : Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 100000 ? Number(v) : NaN);
async function saveEntitlement(email, patch, extra) {
  const row = { email, ...patch, ...(extra || {}) };
  const out = await rest('entitlements', { method: 'POST', query: { on_conflict: 'email' }, body: row, prefer: 'resolution=merge-duplicates,return=representation' });
  forgetEntitlement(email);
  return Array.isArray(out) ? out[0] : out;
}
router.post('/entitlement', async (req, res) => {
  const b = req.body || {}, email = String(b.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'A valid email is required.' });
  const patch = {};
  if ('tier' in b) { if (!TIERS.includes(b.tier)) return res.status(400).json({ error: 'Unknown tier.' }); patch.tier = b.tier; }
  if ('status' in b) { if (!STATUSES.includes(b.status)) return res.status(400).json({ error: 'Unknown status.' }); patch.status = b.status; }
  if ('ocr' in b) { if (b.ocr !== null && typeof b.ocr !== 'boolean') return res.status(400).json({ error: 'ocr must be true, false or null.' }); patch.ocr = b.ocr; }
  for (const k of ['ocr_hourly', 'ocr_daily']) if (k in b) { const n = int(b[k]); if (Number.isNaN(n)) return res.status(400).json({ error: `${k} must be a whole number.` }); patch[k] = n; }
  if ('notes' in b) patch.notes = String(b.notes || '').slice(0, 500);
  try { res.json({ entitlement: await saveEntitlement(email, patch, { source: 'admin' }) }); } catch (e) { console.error(e.message); res.status(502).json({ error: 'Could not save.' }); }
});

router.post('/waitlist/:id', async (req, res) => {
  const action = (req.body || {}).action, tier = (req.body || {}).tier || 'free';
  if (!['approve', 'decline', 'reset'].includes(action) || !TIERS.includes(tier)) return res.status(400).json({ error: 'Bad request.' });
  try {
    const [w] = await rest('waitlist', { query: { id: `eq.${req.params.id}`, select: '*', limit: 1 } });
    if (!w) return res.status(404).json({ error: 'Not on the waitlist.' });
    const status = action === 'approve' ? 'approved' : action === 'decline' ? 'declined' : 'new';
    await rest('waitlist', { method: 'PATCH', query: { id: `eq.${w.id}` }, body: { status, decided_at: new Date().toISOString() }, prefer: 'return=representation' });
    let entitlement = null;
    if (action === 'approve') entitlement = await saveEntitlement(String(w.email).toLowerCase(), { ocr: true, tier }, { source: 'waitlist' });
    if (action === 'decline') { const [e] = await rest('entitlements', { query: { email: `eq.${String(w.email).toLowerCase()}`, select: '*', limit: 1 } }); if (e && e.source === 'waitlist') entitlement = await saveEntitlement(e.email, { ocr: null }); }
    res.json({ status, entitlement, email: w.email });
  } catch (e) { console.error(e.message); res.status(502).json({ error: 'Could not update.' }); }
});

router.put('/settings', async (req, res) => {
  const b = req.body || {}, out = {};
  if (b.tiers) {
    const t = {};
    for (const name of TIERS) {
      const x = (b.tiers || {})[name] || {}, h = int(x.ocr_hourly), d = int(x.ocr_daily);
      if (Number.isNaN(h) || Number.isNaN(d) || h === null || d === null || typeof x.ocr !== 'boolean') return res.status(400).json({ error: 'Each tier needs ocr (true/false) and whole-number hourly and daily limits.' });
      t[name] = { ocr: x.ocr, ocr_hourly: h, ocr_daily: d };
    }
    out.tiers = t;
  }
  if (b.flags) { const f = {}; for (const k of Object.keys(DEFAULT_FLAGS)) { if (typeof (b.flags || {})[k] !== 'boolean') return res.status(400).json({ error: `flag ${k} must be true or false.` }); f[k] = b.flags[k]; } out.flags = f; }
  if (!Object.keys(out).length) return res.status(400).json({ error: 'Nothing to change.' });
  try {
    for (const [key, value] of Object.entries(out)) await rest('app_settings', { method: 'POST', query: { on_conflict: 'key' }, body: { key, value }, prefer: 'resolution=merge-duplicates' });
    clearCaches(); res.json({ settings: await getSettings() });
  } catch (e) { console.error(e.message); res.status(502).json({ error: 'Could not save settings.' }); }
});

export { DEFAULT_TIERS };
export default router;
