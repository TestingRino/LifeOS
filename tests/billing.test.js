const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { start } = require('./helpers/fake-supabase.js');

process.env.VERCEL = '1'; process.env.ANTHROPIC_API_KEY = 'k'; process.env.OCR_ALLOWED_EMAILS = '';
process.env.STRIPE_SECRET_KEY = 'sk_test_x'; process.env.STRIPE_PRICE_PLUS = 'price_plus'; process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'; process.env.SITE_URL = 'https://site.example/app/#/x';

let sb, stripeSrv, stripeCalls, base, srv, ent, sec;
test.before(async () => {
  sb = await start(); stripeCalls = [];
  stripeSrv = http.createServer((req, res) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => { const body = Object.fromEntries(new URLSearchParams(Buffer.concat(c).toString())); stripeCalls.push({ path: req.url, auth: req.headers.authorization, body }); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ url: `https://stripe.test${req.url}` })); }); });
  await new Promise((r) => stripeSrv.listen(0, r));
  process.env.STRIPE_API_BASE = `http://127.0.0.1:${stripeSrv.address().port}`;
  process.env.SUPABASE_URL = sb.url; process.env.SUPABASE_ANON_KEY = sb.anonKey; process.env.SUPABASE_SERVICE_ROLE_KEY = sb.serviceKey;
  sb.sessions['eyJme.p.s'] = { id: '11111111-1111-1111-1111-111111111111', email: 'me@example.com' };
  const app = (await import('../server/app.js')).default;
  ent = await import('../server/lib/entitlements.js'); sec = await import('../server/middleware/security.js');
  srv = http.createServer(app); await new Promise((r) => srv.listen(0, r)); base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => { srv.close(); stripeSrv.close(); sb.close(); });

const hook = (event, { secret = 'whsec_test', t = Math.floor(Date.now() / 1000) } = {}) => {
  const raw = JSON.stringify(event), sig = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` }, body: raw });
};
const ocr = (token) => fetch(`${base}/api/ocr/analyze`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });

test('checkout needs a signed-in person and asks Stripe for a subscription session', async () => {
  assert.equal((await fetch(`${base}/api/billing/checkout`, { method: 'POST' })).status, 401);
  const r = await fetch(`${base}/api/billing/checkout`, { method: 'POST', headers: { Authorization: 'Bearer eyJme.p.s' } });
  assert.equal(r.status, 200); assert.match((await r.json()).url, /checkout\/sessions/);
  const c = stripeCalls.pop();
  assert.equal(c.auth, 'Bearer sk_test_x');
  assert.deepEqual([c.body.mode, c.body['line_items[0][price]'], c.body.client_reference_id, c.body.customer_email], ['subscription', 'price_plus', '11111111-1111-1111-1111-111111111111', 'me@example.com']);
  assert.equal(c.body.success_url, 'https://site.example/app/#/settings');          // the site URL's own hash is replaced
});

test('webhook rejects a bad signature, a stale timestamp and a wrong secret', async () => {
  const ev = { type: 'checkout.session.completed', data: { object: {} } };
  assert.equal((await hook(ev, { secret: 'nope' })).status, 400);
  assert.equal((await hook(ev, { t: Math.floor(Date.now() / 1000) - 3600 })).status, 400);
  assert.equal((await fetch(`${base}/api/billing/webhook`, { method: 'POST', body: '{}' })).status, 400);
});

test('subscribing grants the plus tier; renewals and cancellation follow through to photo import', async () => {
  sec._resetQuotas(); ent.clearCaches();
  assert.equal((await ocr('eyJme.p.s')).status, 403);                                          // free tier: no photo import
  const done = await hook({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', customer: 'cus_1', subscription: 'sub_1', customer_email: 'Me@Example.com', client_reference_id: '11111111-1111-1111-1111-111111111111' } } });
  assert.equal(done.status, 200);
  const row = () => sb.db.entitlements.find((e) => e.email === 'me@example.com');
  assert.deepEqual([row().tier, row().status, row().source, row().stripe_customer_id], ['plus', 'active', 'stripe', 'cus_1']);
  assert.equal((await ocr('eyJme.p.s')).status, 400);                                          // plus tier: allowed
  const end = Math.floor(Date.now() / 1000) + 30 * 86400;
  await hook({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: end } } });
  assert.equal(Date.parse(row().current_period_end) / 1000, end);
  await hook({ type: 'invoice.payment_failed', data: { object: { customer: 'cus_1' } } });
  assert.equal(row().status, 'past_due');
  await hook({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled' } } });
  assert.deepEqual([row().tier, row().status], ['free', 'canceled']);
  sec._resetQuotas(); ent.clearCaches();
  assert.equal((await ocr('eyJme.p.s')).status, 403);                                          // back to free
});

test('the portal opens for subscribers only', async () => {
  const call = () => fetch(`${base}/api/billing/portal`, { method: 'POST', headers: { Authorization: 'Bearer eyJme.p.s' } });
  const r = await call(); assert.equal(r.status, 200); assert.match((await r.json()).url, /billing_portal/);
  sb.db.entitlements.length = 0; ent.clearCaches();
  assert.equal((await call()).status, 404);
});
