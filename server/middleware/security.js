import { recordUsage } from '../lib/entitlements.js';

/* Browser and abuse protections for the Telos backend.
   Limits are kept in memory. On a serverless host each warm instance counts separately, so treat them as a
   brake on accidents and casual abuse; put a shared store (Upstash, Vercel KV) behind them before a public launch. */

const DEFAULT_ORIGINS = ['https://testingrino.github.io', 'http://localhost:8080', 'http://localhost:8099', 'http://127.0.0.1:8080'];
export const allowedOrigins = () => (process.env.ALLOWED_ORIGINS ? String(process.env.ALLOWED_ORIGINS).split(/[,\s]+/).filter(Boolean) : DEFAULT_ORIGINS);

/* cors() options: only the Telos site (and local development) may call this API from a browser. */
export const corsOptions = {
  origin(origin, cb) { cb(null, !origin || allowedOrigins().includes(origin)); },
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600,
};

export function securityHeaders(req, res, next) {
  res.removeHeader('X-Powered-By');
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });
  next();
}

const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();

/* Fixed-window counter. key(req) returns what to count; over the limit gets a 429 with Retry-After. */
export function rateLimit({ windowMs, max, key = clientIp, message = 'Too many requests. Please slow down.' }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now(), k = key(req), h = hits.get(k);
    if (hits.size > 5000) for (const [kk, v] of hits) if (v.reset <= now) hits.delete(kk);
    if (!h || h.reset <= now) { hits.set(k, { n: 1, reset: now + windowMs }); return next(); }
    if (++h.n > max) { res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000))); return res.status(429).json({ error: message }); }
    next();
  };
}

/* Photo reading costs real money: cap each signed-in user per hour and per day (OCR_HOURLY_LIMIT, OCR_DAILY_LIMIT). */
const hourly = new Map(), daily = new Map();
export function ocrQuota(req, res, next) {
  const who = req.user?.email || clientIp(req), now = Date.now();
  const bump = (map, windowMs, max) => {
    const h = map.get(who);
    if (!h || h.reset <= now) { map.set(who, { n: 1, reset: now + windowMs }); return true; }
    h.n += 1; return h.n <= max;
  };
  const lim = req.user && req.user.limits ? req.user.limits : null;      // per-person limits from the entitlement, else the global ones
  const maxH = lim && Number.isFinite(lim.hourly) ? lim.hourly : Number(process.env.OCR_HOURLY_LIMIT) || 20, maxD = lim && Number.isFinite(lim.daily) ? lim.daily : Number(process.env.OCR_DAILY_LIMIT) || 60;
  const hOk = bump(hourly, 3600e3, maxH), dOk = bump(daily, 86400e3, maxD);
  if (hOk && dOk) { if (req.user && req.user.email) recordUsage(req.user.email); return next(); }
  res.set('Retry-After', String(hOk ? 3600 : 600));
  res.status(429).json({ error: `You have reached the photo import limit (${maxH} per hour, ${maxD} per day). Try again later.` });
}
export const _resetQuotas = () => { hourly.clear(); daily.clear(); };
