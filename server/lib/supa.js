import axios from 'axios';

/* Server-side access to Supabase with the service-role key. This key can read and write everything, so it exists
   only in the server's environment (never in js/config.js, never sent to a browser). Every function here is used
   by an endpoint that has already checked who is asking. */
const base = () => String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const configured = () => !!(base() && key());
const headers = (extra) => ({ apikey: key(), Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json', ...(extra || {}) });

/* PostgREST call. query is an object of filters, e.g. { email: 'eq.a@b.co', select: '*', order: 'created_at.desc' }. */
export async function rest(table, { method = 'GET', query = {}, body, prefer } = {}) {
  const res = await axios({ method, url: `${base()}/rest/v1/${table}`, params: query, data: body, headers: headers(prefer ? { Prefer: prefer } : {}), timeout: 8000 });
  return res.data;
}
export async function rpc(name, args) {
  return (await axios.post(`${base()}/rest/v1/rpc/${name}`, args, { headers: headers(), timeout: 8000 })).data;
}
/* Everyone who has signed up, newest first (Supabase Auth admin API). */
export async function listUsers(max = 1000) {
  const out = [];
  for (let page = 1; out.length < max; page++) {
    const { data } = await axios.get(`${base()}/auth/v1/admin/users`, { params: { page, per_page: 200 }, headers: headers(), timeout: 8000 });
    const batch = data.users || [];
    out.push(...batch);
    if (batch.length < 200) break;
  }
  return out;
}
/* Who owns this Supabase session token? Returns { id, email, confirmed } or null. */
export async function userFromToken(token) {
  try {
    const { data } = await axios.get(`${base()}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY || key() }, timeout: 8000 });
    return data && data.email ? { id: data.id, email: String(data.email).toLowerCase(), confirmed: !!(data.email_confirmed_at || data.confirmed_at) } : null;
  } catch (e) { return null; }
}
