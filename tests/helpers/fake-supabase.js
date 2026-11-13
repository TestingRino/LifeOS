/* A tiny in-memory stand-in for the parts of Supabase the server uses: Auth (user lookup, admin user list) and
   PostgREST (filters with eq., order, limit, upsert, patch, delete, one rpc). Good enough to test our logic. */
const http = require('node:http');

const KEYS = { entitlements: ['email'], app_settings: ['key'], usage_daily: ['email', 'day'], waitlist: ['id'], admins: ['user_id'], reminder_profiles: ['email'], push_subscriptions: ['endpoint'] };

function start({ serviceKey = 'service-key', anonKey = 'anon' } = {}) {
  const db = { entitlements: [], app_settings: [], usage_daily: [], waitlist: [], admins: [], reminder_profiles: [], push_subscriptions: [] };
  const sessions = {};                 // access token -> { id, email, confirmed }
  const authUsers = [];
  const calls = [];
  let seq = 0;
  const matches = (row, params) => [...params.entries()].every(([k, v]) => {
    if (['select', 'order', 'limit', 'on_conflict', 'offset'].includes(k)) return true;
    if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(row[k]));
    if (v.startsWith('gte.')) return String(row[k]) >= v.slice(4);
    return true;
  });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || 'null') : null;
      const send = (status, data) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(data === undefined ? '' : JSON.stringify(data)); };
      const token = (req.headers.authorization || '').replace(/^Bearer /i, '');
      calls.push(`${req.method} ${u.pathname}`);
      if (u.pathname === '/auth/v1/user') { const s = sessions[token]; return s ? send(200, { id: s.id, email: s.email, email_confirmed_at: s.confirmed === false ? null : '2026-01-01' }) : send(401, {}); }
      const isService = token === serviceKey && req.headers.apikey === serviceKey;
      if (!isService) return send(401, { message: 'service role required' });
      if (u.pathname === '/auth/v1/admin/users') return send(200, { users: authUsers.slice((Number(u.searchParams.get('page') || 1) - 1) * 200, Number(u.searchParams.get('page') || 1) * 200) });
      const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(u.pathname);
      if (rpc && rpc[1] === 'increment_usage') {
        const email = body.p_email.toLowerCase(); let row = db.usage_daily.find((r) => r.email === email && r.day === body.p_day);
        if (row) row.ocr_count += 1; else db.usage_daily.push({ email, day: body.p_day, ocr_count: 1 });
        return send(204);
      }
      const t = /^\/rest\/v1\/(\w+)$/.exec(u.pathname);
      if (!t || !db[t[1]]) return send(404, { message: 'no such table' });
      const rows = db[t[1]], pk = KEYS[t[1]];
      if (req.method === 'GET') {
        let out = rows.filter((r) => matches(r, u.searchParams));
        const order = u.searchParams.get('order'); if (order) { const [f, dir] = order.split('.'); out = out.slice().sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * (dir === 'desc' ? -1 : 1)); }
        const off = Number(u.searchParams.get('offset')) || 0; if (off) out = out.slice(off);
        const lim = Number(u.searchParams.get('limit')); if (lim) out = out.slice(0, lim);
        return send(200, out);
      }
      if (req.method === 'POST') {
        const list = Array.isArray(body) ? body : [body], merge = /merge-duplicates/.test(req.headers.prefer || ''), saved = [];
        list.forEach((item) => {
          const row = { ...item }; if (t[1] === 'waitlist' && !row.id) { row.id = `w${++seq}`; row.status = row.status || 'new'; row.created_at = new Date().toISOString(); }
          const i = rows.findIndex((r) => pk.every((k) => r[k] === row[k]));
          if (i >= 0 && merge) { rows[i] = { ...rows[i], ...row, updated_at: new Date().toISOString() }; saved.push(rows[i]); } else if (i < 0) { rows.push(row); saved.push(row); }
        });
        return send(201, saved);
      }
      if (req.method === 'PATCH') { const hit = rows.filter((r) => matches(r, u.searchParams)); hit.forEach((r) => Object.assign(r, body, { updated_at: new Date().toISOString() })); return send(200, hit); }
      if (req.method === 'DELETE') { const keep = rows.filter((r) => !matches(r, u.searchParams)); rows.length = 0; rows.push(...keep); return send(204); }
      return send(405, {});
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, db, sessions, authUsers, calls, serviceKey, anonKey,
    close: () => server.close(),
  })));
}
module.exports = { start };
