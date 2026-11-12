import { configured, rest, rpc } from './supa.js';

/* Who may use photo import, and how much. Decision order:
   1. OCR_ALLOWED_EMAILS in the environment (the original list; `*` = everyone signed in): always allowed.
   2. The person's entitlement row (tier + per-person overrides) and the global settings the admin page edits.
   Without a service-role key only rule 1 exists, exactly as before. */
export const DEFAULT_TIERS = { free: { ocr: false, ocr_hourly: 0, ocr_daily: 0 }, plus: { ocr: true, ocr_hourly: 20, ocr_daily: 60 } };
export const DEFAULT_FLAGS = { ocr_enabled: true, waitlist_open: true };
const TTL = 60 * 1000;
let settingsCache = null, settingsAt = 0;
const entCache = new Map();

export const envAllowList = () => String(process.env.OCR_ALLOWED_EMAILS || '').split(/[,\s;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
export const inEnvList = (email) => { const l = envAllowList(); return l.includes('*') || l.includes(String(email || '').toLowerCase()); };
export const clearCaches = () => { settingsCache = null; settingsAt = 0; entCache.clear(); };

export async function getSettings() {
  if (settingsCache && Date.now() - settingsAt < TTL) return settingsCache;
  let tiers = DEFAULT_TIERS, flags = DEFAULT_FLAGS;
  if (configured()) {
    try {
      const rows = await rest('app_settings', { query: { select: 'key,value' } });
      rows.forEach((r) => { if (r.key === 'tiers') tiers = { ...DEFAULT_TIERS, ...r.value }; if (r.key === 'flags') flags = { ...DEFAULT_FLAGS, ...r.value }; });
    } catch (e) { console.warn('settings unavailable, using defaults:', e.message); }
  }
  settingsCache = { tiers, flags }; settingsAt = Date.now();
  return settingsCache;
}
export async function getEntitlement(email) {
  if (!configured()) return null;
  const k = String(email || '').toLowerCase(), hit = entCache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.row;
  let row = null;
  try { [row = null] = await rest('entitlements', { query: { email: `eq.${k}`, select: '*', limit: 1 } }); } catch (e) { console.warn('entitlement lookup failed:', e.message); return null; }
  if (entCache.size > 2000) entCache.clear();
  entCache.set(k, { row, at: Date.now() });
  return row;
}
export const forgetEntitlement = (email) => entCache.delete(String(email || '').toLowerCase());

/* Pure: what is this person allowed to do right now? */
export function effectiveAccess(ent, settings, { envListed = false, now = Date.now() } = {}) {
  const s = settings || { tiers: DEFAULT_TIERS, flags: DEFAULT_FLAGS };
  const fallback = { hourly: Number(process.env.OCR_HOURLY_LIMIT) || 20, daily: Number(process.env.OCR_DAILY_LIMIT) || 60 };
  if (s.flags.ocr_enabled === false) return { allowed: false, reason: 'Photo import is paused for everyone right now. Please try again later.', tier: ent ? ent.tier : 'free', ...fallback };
  const tier = ent ? ent.tier : 'free', t = s.tiers[tier] || s.tiers.free || DEFAULT_TIERS.free;
  if (ent && ent.status === 'suspended') return { allowed: false, reason: 'This account has been paused. Contact support.', tier, ...fallback };
  if (envListed) return { allowed: true, tier, hourly: ent && ent.ocr_hourly != null ? ent.ocr_hourly : fallback.hourly, daily: ent && ent.ocr_daily != null ? ent.ocr_daily : fallback.daily, via: 'env' };
  if (!ent) return { allowed: false, tier: 'free', reason: 'request', hourly: 0, daily: 0 };
  const expired = ent.current_period_end && Date.parse(ent.current_period_end) < now - 3 * 86400000;      // 3 days of grace after a missed renewal
  const lapsed = ent.source === 'stripe' && (ent.status === 'canceled' || expired);
  const allowed = ent.ocr != null ? !!ent.ocr : !!t.ocr && !lapsed;
  return { allowed, tier, hourly: ent.ocr_hourly != null ? ent.ocr_hourly : t.ocr_hourly, daily: ent.ocr_daily != null ? ent.ocr_daily : t.ocr_daily, reason: allowed ? '' : 'request', via: 'entitlement' };
}
export async function decide(email) {
  const [ent, settings] = await Promise.all([getEntitlement(email), getSettings()]);
  return effectiveAccess(ent, settings, { envListed: inEnvList(email) });
}
export function recordUsage(email) {      // fire and forget: counting must never slow or break a request
  if (!configured()) return;
  rpc('increment_usage', { p_email: String(email).toLowerCase(), p_day: new Date().toISOString().slice(0, 10) }).catch((e) => console.warn('usage not recorded:', e.message));
}
