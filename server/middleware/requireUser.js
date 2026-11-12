import axios from 'axios';
import { decide, envAllowList, inEnvList } from '../lib/entitlements.js';

/* Identifies the caller by asking Google who owns their access token, then checks the owner's
   whitelist (OCR_ALLOWED_EMAILS, comma separated). Fails closed: no whitelist means no access. */
const USERINFO_URL = () => process.env.GOOGLE_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo';
const TTL = 5 * 60 * 1000;
const cache = new Map();   // token -> { email, exp }

export const allowList = envAllowList;
export const isAllowed = inEnvList;      // the environment list only; full decisions (tiers, overrides) are in lib/entitlements.js

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

const REQUEST_MSG = 'Photo import is by invitation. Request an invite in the app and we will email you when it is ready.';
export async function requireAllowedUser(req, res, next) {
  const who = await identify(req);
  if (who.error) return res.status(who.status).json({ error: who.error });
  const d = await decide(who.email);
  if (!d.allowed) return res.status(403).json({ error: d.reason && d.reason !== 'request' ? d.reason : REQUEST_MSG, tier: d.tier });
  req.user = { email: who.email, tier: d.tier, limits: { hourly: d.hourly, daily: d.daily } };
  next();
}
