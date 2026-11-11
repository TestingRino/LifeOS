import axios from 'axios';

/* Identifies the caller by asking Google who owns their access token, then checks the owner's
   whitelist (OCR_ALLOWED_EMAILS, comma separated). Fails closed: no whitelist means no access. */
const USERINFO_URL = () => process.env.GOOGLE_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo';
const TTL = 5 * 60 * 1000;
const cache = new Map();   // token -> { email, exp }

export const allowList = () => String(process.env.OCR_ALLOWED_EMAILS || '').split(/[,\s;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
export const isAllowed = (email) => { const list = allowList(); return list.includes('*') || list.includes(String(email || '').toLowerCase()); };

export async function identify(req) {
  const m = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
  if (!m) return { status: 401, error: 'Sign in with Google to use photo import.' };
  const token = m[1], hit = cache.get(token);
  if (hit && hit.exp > Date.now()) return { email: hit.email };
  try {
    // A Supabase session token (accounts mode) is checked with Supabase; anything else is a Google access token.
    const supa = process.env.SUPABASE_URL && /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(token);
    const { data } = supa
      ? await axios.get(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY || '' }, timeout: 8000 })
      : await axios.get(USERINFO_URL(), { headers: { Authorization: `Bearer ${token}` }, timeout: 8000 });
    const verified = supa ? !!(data.email_confirmed_at || data.confirmed_at) : data.email_verified !== false;
    if (!data.email || !verified) return { status: 403, error: 'Your account has no verified email address.' };
    if (cache.size > 500) cache.clear();
    const email = String(data.email).toLowerCase();
    cache.set(token, { email, exp: Date.now() + TTL });
    return { email };
  } catch (err) {
    const status = err.response?.status;
    return status === 401 || status === 403
      ? { status: 401, error: 'Please sign in with Google again.' }
      : { status: 503, error: 'Could not verify your Google account right now. Try again in a moment.' };
  }
}

export async function requireAllowedUser(req, res, next) {
  const who = await identify(req);
  if (who.error) return res.status(who.status).json({ error: who.error });
  if (!isAllowed(who.email)) {
    if (!allowList().length) console.warn('OCR_ALLOWED_EMAILS is not set, so photo import is closed to everyone.');
    return res.status(403).json({ error: `Photo import is limited to approved accounts. Ask the owner to add ${who.email}.` });
  }
  req.user = { email: who.email };
  next();
}
