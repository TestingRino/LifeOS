const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { start } = require('./helpers/fake-supabase.js');

process.env.VERCEL = '1';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.OCR_ALLOWED_EMAILS = 'boot@example.com';
process.env.OCR_HOURLY_LIMIT = '3';
process.env.ADMIN_EMAILS = 'root@example.com';

let sb, base, srv, ent, sec;
test.before(async () => {
  sb = await start();
  process.env.SUPABASE_URL = sb.url; process.env.SUPABASE_ANON_KEY = sb.anonKey; process.env.SUPABASE_SERVICE_ROLE_KEY = sb.serviceKey;
  const ses = (token, email, id, confirmed) => { sb.sessions[token] = { id, email, confirmed }; };
  ses('eyJboot.p.s', 'boot@example.com', 'u0'); ses('eyJplus.p.s', 'plus@example.com', 'u1'); ses('eyJfree.p.s', 'free@example.com', 'u2'); ses('eyJroot.p.s', 'root@example.com', 'u9');
  ses('eyJsusp.p.s', 'susp@example.com', 'u3'); ses('eyJover.p.s', 'over@example.com', 'u4'); ses('eyJnone.p.s', 'nobody@example.com', 'u5');
  const app = (await import('../server/app.js')).default;
  ent = await import('../server/lib/entitlements.js'); sec = await import('../server/middleware/security.js');
  srv = http.createServer(app); await new Promise((r) => srv.listen(0, r)); base = `http://127.0.0.1:${srv.address().port}`;
  global.__ctx = { sb, base, ent, sec };
});
test.after(() => { srv.close(); sb.close(); });
const ocr = (token) => fetch(`${base}/api/ocr/analyze`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
const row = (o) => ({ tier: 'free', ocr: null, ocr_hourly: null, ocr_daily: null, status: 'active', source: 'admin', notes: '', ...o });

test('effectiveAccess: tier defaults, overrides, suspension, kill switch, lapsed subscriptions', () => {
  const S = { tiers: ent.DEFAULT_TIERS, flags: ent.DEFAULT_FLAGS };
  assert.equal(ent.effectiveAccess(null, S).allowed, false);
  assert.equal(ent.effectiveAccess(row({ tier: 'plus' }), S).allowed, true);
  assert.equal(ent.effectiveAccess(row({ tier: 'plus', ocr: false }), S).allowed, false);                 // override beats the tier
  assert.equal(ent.effectiveAccess(row({ tier: 'free', ocr: true, ocr_daily: 5 }), S).daily, 5);           // approved with a custom limit
  assert.equal(ent.effectiveAccess(row({ tier: 'plus', status: 'suspended' }), S).allowed, false);
  assert.equal(ent.effectiveAccess(row({ tier: 'plus' }), { ...S, flags: { ocr_enabled: false } }).allowed, false);
  const lapsed = row({ tier: 'plus', source: 'stripe', current_period_end: new Date(Date.now() - 10 * 86400000).toISOString() });
  assert.equal(ent.effectiveAccess(lapsed, S).allowed, false);                                              // unpaid for more than the grace period
  assert.equal(ent.effectiveAccess({ ...lapsed, current_period_end: new Date(Date.now() - 86400000).toISOString() }, S).allowed, true);
  assert.equal(ent.effectiveAccess(null, S, { envListed: true }).allowed, true);                            // the environment list still works
});

test('photo import follows entitlements: environment list, plus tier, approvals, suspension', async () => {
  sec._resetQuotas(); ent.clearCaches();
  sb.db.entitlements.push(row({ email: 'plus@example.com', tier: 'plus' }), row({ email: 'susp@example.com', tier: 'plus', status: 'suspended' }), row({ email: 'over@example.com', tier: 'free', ocr: true, ocr_hourly: 1 }), row({ email: 'free@example.com' }));
  assert.equal((await ocr('eyJboot.p.s')).status, 400);                // env list: allowed (400 = reached the handler, no image)
  assert.equal((await ocr('eyJplus.p.s')).status, 400);                // plus tier
  assert.equal((await ocr('eyJfree.p.s')).status, 403);               // free tier, not approved
  assert.equal((await ocr('eyJnone.p.s')).status, 403);               // no row at all
  const sus = await ocr('eyJsusp.p.s'); assert.equal(sus.status, 403); assert.match((await sus.json()).error, /paused/i);
  assert.equal((await ocr('eyJover.p.s')).status, 400);                // approved with a limit of 1 per hour...
  assert.equal((await ocr('eyJover.p.s')).status, 429);                // ...so the second is refused
});

test('usage is counted per person per day', async () => {
  await new Promise((r) => setTimeout(r, 150));
  const day = new Date().toISOString().slice(0, 10);
  assert.ok(sb.db.usage_daily.find((u) => u.email === 'plus@example.com' && u.day === day && u.ocr_count >= 1));
  assert.ok(sb.db.usage_daily.find((u) => u.email === 'over@example.com' && u.ocr_count === 1));       // only the call that was let through
});

test('the global kill switch pauses photo import for everyone, including the environment list', async () => {
  sb.db.app_settings.push({ key: 'flags', value: { ocr_enabled: false } }); ent.clearCaches(); sec._resetQuotas();
  assert.equal((await ocr('eyJboot.p.s')).status, 403);
  sb.db.app_settings.length = 0; ent.clearCaches(); sec._resetQuotas();
  assert.equal((await ocr('eyJboot.p.s')).status, 400);
});

test('access check reports tier and reason so the app can offer the right button', async () => {
  ent.clearCaches();
  const get = async (t) => (await fetch(`${base}/api/ocr/access`, { headers: { Authorization: `Bearer ${t}` } })).json();
  const a = await get('eyJplus.p.s'); assert.deepEqual([a.allowed, a.tier], [true, 'plus']);
  const f = await get('eyJfree.p.s'); assert.deepEqual([f.allowed, f.reason], [false, 'request']);
});

const adm = (path, token, opts = {}) => fetch(`${base}/api/admin${path}`, { ...opts, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });

test('admin API: anonymous 401, signed-in non-admin 403, env admin and admins-table admin allowed', async () => {
  assert.equal((await fetch(`${base}/api/admin/overview`)).status, 401);
  assert.equal((await adm('/overview', 'eyJplus.p.s')).status, 403);
  assert.equal((await adm('/me', 'eyJroot.p.s')).status, 200);                                  // ADMIN_EMAILS bootstrap
  sb.db.admins.push({ user_id: 'u2' });                                                          // free@example.com becomes an admin in the table
  assert.equal((await adm('/me', 'eyJfree.p.s')).status, 200);
  sb.db.admins.length = 0;
  assert.equal((await adm('/me', 'eyJfree.p.s')).status, 403);
});

test('admin overview combines accounts, entitlements, waitlist and usage', async () => {
  const d = new Date().toISOString();
  sb.authUsers.push({ id: 'u1', email: 'plus@example.com', created_at: d, last_sign_in_at: d, app_metadata: { provider: 'google' } }, { id: 'u2', email: 'free@example.com', created_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email' } });
  sb.db.waitlist.push({ id: 'w1', email: 'newbie@example.com', planner: 'panda', other: '', source: 'landing', status: 'new', created_at: d }, { id: 'w2', email: 'free@example.com', planner: 'other', other: 'Dot grid', source: 'today', status: 'new', created_at: d });
  const r = await (await adm('/overview', 'eyJroot.p.s')).json();
  assert.equal(r.totals.users, 2); assert.equal(r.totals.waitlist_new, 2); assert.equal(r.totals.paid, 1);
  const plus = r.people.find((p) => p.email === 'plus@example.com');
  assert.deepEqual([plus.tier, plus.photo_import, plus.provider], ['plus', true, 'google']);
  assert.ok(plus.usage_7d >= 1);
  assert.ok(r.people.some((p) => p.email === 'susp@example.com' && p.no_account));                // entitlement without an account is still listed
  assert.deepEqual(r.planners.map((p) => p.planner).sort(), ['other: Dot grid', 'panda']);
  assert.equal(r.waitlist.find((w) => w.id === 'w2').has_account, true);
  assert.ok(r.settings.tiers.plus.ocr_daily >= 1 && r.env.ocr_allowed_emails === 1);
});

test('approving a waitlist entry grants photo import without a redeploy, and revoking removes it', async () => {
  ent.clearCaches(); sec._resetQuotas();
  sb.sessions['eyJnew.p.s'] = { id: 'u7', email: 'newbie@example.com' };
  assert.equal((await ocr('eyJnew.p.s')).status, 403);
  const ok = await adm('/waitlist/w1', 'eyJroot.p.s', { method: 'POST', body: { action: 'approve' } });
  assert.equal(ok.status, 200);
  assert.equal(sb.db.waitlist.find((w) => w.id === 'w1').status, 'approved');
  assert.deepEqual([sb.db.entitlements.find((e) => e.email === 'newbie@example.com').ocr, sb.db.entitlements.find((e) => e.email === 'newbie@example.com').source], [true, 'waitlist']);
  assert.equal((await ocr('eyJnew.p.s')).status, 400);                                          // now allowed
  const rev = await adm('/entitlement', 'eyJroot.p.s', { method: 'POST', body: { email: 'newbie@example.com', ocr: false } });
  assert.equal(rev.status, 200);
  assert.equal((await ocr('eyJnew.p.s')).status, 403);                                          // revoked immediately
  assert.equal((await adm('/waitlist/nope', 'eyJroot.p.s', { method: 'POST', body: { action: 'approve' } })).status, 404);
});

test('admin edits are validated: tiers, limits and statuses', async () => {
  const post = (body) => adm('/entitlement', 'eyJroot.p.s', { method: 'POST', body });
  assert.equal((await post({ email: 'bad' })).status, 400);
  assert.equal((await post({ email: 'x@y.co', tier: 'gold' })).status, 400);
  assert.equal((await post({ email: 'x@y.co', ocr_daily: -3 })).status, 400);
  assert.equal((await post({ email: 'x@y.co', status: 'weird' })).status, 400);
  const good = await post({ email: 'X@Y.co', tier: 'plus', ocr_hourly: 5, ocr_daily: '15', notes: 'beta tester' });
  assert.equal(good.status, 200);
  assert.deepEqual([sb.db.entitlements.find((e) => e.email === 'x@y.co').tier, sb.db.entitlements.find((e) => e.email === 'x@y.co').ocr_daily], ['plus', 15]);
});

test('admin settings change tier limits and the kill switch for everyone', async () => {
  const put = (body) => adm('/settings', 'eyJroot.p.s', { method: 'PUT', body });
  assert.equal((await put({ tiers: { free: { ocr: false }, plus: {} } })).status, 400);
  const tiers = { free: { ocr: true, ocr_hourly: 2, ocr_daily: 4 }, plus: { ocr: true, ocr_hourly: 30, ocr_daily: 90 } };
  assert.equal((await put({ tiers, flags: { ocr_enabled: true, waitlist_open: true } })).status, 200);
  sec._resetQuotas();
  assert.equal((await ocr('eyJfree.p.s')).status, 400);                                          // free tier now includes photo import
  assert.equal((await put({ flags: { ocr_enabled: false, waitlist_open: true } })).status, 200);
  assert.equal((await ocr('eyJfree.p.s')).status, 403);
  assert.equal((await put({ flags: { ocr_enabled: 'nope', waitlist_open: true } })).status, 400);
});
