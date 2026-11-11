const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.VERCEL = '1';                      // import the app without letting it listen
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.OCR_ALLOWED_EMAILS = 'ok@example.com';
process.env.OCR_HOURLY_LIMIT = '2';

let base, srv, google, sec;
test.before(async () => {
  google = http.createServer((req, res) => {          // pretends to be Google's userinfo endpoint and Supabase's /auth/v1/user
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    if (req.url.startsWith('/auth/v1/user')) {
      res.setHeader('content-type', 'application/json');
      if (req.headers.apikey !== 'anon') { res.statusCode = 401; return res.end('{}'); }
      if (t.startsWith('eyJgood')) return res.end(JSON.stringify({ email: 'ok@example.com', email_confirmed_at: '2026-01-01' }));
      if (t.startsWith('eyJunconfirmed')) return res.end(JSON.stringify({ email: 'ok@example.com' }));
      res.statusCode = 401; return res.end('{}');
    }
    if (t === 'good') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ email: 'ok@example.com', email_verified: true })); }
    if (t === 'other') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ email: 'nope@example.com', email_verified: true })); }
    res.statusCode = 401; res.end('{}');
  });
  await new Promise((r) => google.listen(0, r));
  process.env.GOOGLE_USERINFO_URL = `http://127.0.0.1:${google.address().port}/userinfo`;
  process.env.SUPABASE_URL = `http://127.0.0.1:${google.address().port}`; process.env.SUPABASE_ANON_KEY = 'anon';
  const app = (await import('../server/app.js')).default;
  sec = await import('../server/middleware/security.js');
  srv = http.createServer(app); await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => { srv.close(); google.close(); });

test('CORS only allows the Life.OS site', async () => {
  const ok = await fetch(`${base}/health`, { headers: { Origin: 'https://testingrino.github.io' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://testingrino.github.io');
  const bad = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});
test('security headers are set and the server does not advertise Express', async () => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-powered-by'), null);
});
test('calendar routes need a bearer token and ignore tokens in the URL', async () => {
  assert.equal((await fetch(`${base}/api/calendar/list`)).status, 401);
  assert.equal((await fetch(`${base}/api/calendar/events?accessToken=abc&from=x&to=y`)).status, 401);
});
test('analytics accepts only known events with a random install id', async () => {
  const post = (body) => fetch(`${base}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ e: 'landed', id: 'abc123def456', v: '1' })).status, 204);
  assert.equal((await post({ e: 'read_everything', id: 'abc123def456' })).status, 400);
  assert.equal((await post({ e: 'landed', id: 'bad id!' })).status, 400);
});
test('photo import: anonymous 401, other accounts 403, approved accounts are rate limited per hour', async () => {
  const call = (token) => fetch(`${base}/api/ocr/analyze`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} });
  assert.equal((await call()).status, 401);
  assert.equal((await call('other')).status, 403);
  sec._resetQuotas();
  assert.equal((await call('good')).status, 400);     // allowed through to the handler (no image attached)
  assert.equal((await call('good')).status, 400);
  const third = await call('good');
  assert.equal(third.status, 429);
  assert.ok(third.headers.get('retry-after'));
});
test('rateLimit returns 429 after the limit and resets after the window', async () => {
  const limit = sec.rateLimit({ windowMs: 50, max: 2, key: () => 'k' });
  const run = () => { let status = 200; const res = { set() {}, status(c) { status = c; return this; }, json() {} }; let nexted = false; limit({}, res, () => { nexted = true; }); return nexted ? 200 : status; };
  assert.deepEqual([run(), run(), run()], [200, 200, 429]);
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(run(), 200);
});
test('OCR normalizer keeps only complete calendar events', async () => {
  const { normalizeByType } = await import('../server/lib/ocr-normalize.js');
  const r = normalizeByType('calendar', { events: [{ date: '2026-03-02', start: '09:00', end: '10:30', title: ' Standup ' }, { title: 'no date' }] });
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].mins, 90);
  assert.equal(r.events[0].text, 'Standup');
});

test('photo import accepts Supabase session tokens and requires a confirmed email', async () => {
  sec._resetQuotas();
  const call = (token) => fetch(`${base}/api/ocr/analyze`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await call('eyJgood.payload.sig')).status, 400);         // approved, reaches the handler
  assert.equal((await call('eyJunconfirmed.payload.sig')).status, 403);  // email not confirmed
  assert.equal((await call('eyJbad.payload.sig')).status, 401);
});
