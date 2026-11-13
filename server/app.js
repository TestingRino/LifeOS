import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import authRoutes from './routes/auth.js';
import calendarRoutes from './routes/calendar.js';
import ocrRoutes from './routes/ocr.js';
import eventsRoutes from './routes/events.js';
import waitlistRoutes from './routes/waitlist.js';
import adminRoutes from './routes/admin.js';
import remindersRoutes, { cronRouter } from './routes/reminders.js';
import billingRoutes, { webhook as stripeWebhook } from './routes/billing.js';
import { corsOptions, securityHeaders, rateLimit } from './middleware/security.js';
import { requireAllowedUser, identify } from './middleware/requireUser.js';
import { decide } from './lib/entitlements.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: `${__dirname}/.env` });

const app = express();
const PORT = process.env.PORT || 3001;

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(securityHeaders);
app.use(cors(corsOptions));
app.use('/api/billing/webhook', stripeWebhook);          // needs the raw body, so it is mounted before the JSON parser
app.use(express.json({ limit: '1mb' }));          // photos arrive as multipart (multer caps those), never as JSON

app.use('/api/auth', rateLimit({ windowMs: 60e3, max: 30 }), authRoutes);
app.use('/api/calendar', rateLimit({ windowMs: 60e3, max: 120 }), calendarRoutes);
app.use('/api/events', rateLimit({ windowMs: 60e3, max: 30 }), eventsRoutes);
app.use('/api/billing', rateLimit({ windowMs: 60e3, max: 20 }), billingRoutes);
app.use('/api/admin', rateLimit({ windowMs: 60e3, max: 60 }), adminRoutes);
app.use('/api/reminders', rateLimit({ windowMs: 60e3, max: 60 }), remindersRoutes);
app.use('/api/cron', cronRouter);       // called by a scheduler, not a browser: protected by CRON_SECRET, not an IP rate limit
app.use('/api/waitlist', rateLimit({ windowMs: 60e3, max: 5, message: 'Too many requests. Please try again in a minute.' }), waitlistRoutes);
// Photo import is limited to whitelisted Google accounts (OCR_ALLOWED_EMAILS). This lets the app ask up front.
app.get('/api/ocr/access', rateLimit({ windowMs: 60e3, max: 30 }), async (req, res) => {
  const who = await identify(req);
  if (who.error) return res.json({ allowed: false, signedIn: false, reason: who.error });
  const d = await decide(who.email);
  res.json({ allowed: d.allowed, signedIn: true, email: who.email, tier: d.tier, reason: d.allowed ? '' : d.reason === 'request' ? 'request' : d.reason });
});
app.use('/api/ocr', rateLimit({ windowMs: 60e3, max: 20 }), requireAllowedUser, ocrRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Telos server running on port ${PORT}`);
    console.log(`  Google OAuth: ${process.env.GOOGLE_CLIENT_ID ? '✓' : '✗'}`);
    console.log(`  Claude API: ${process.env.ANTHROPIC_API_KEY ? '✓' : '✗'}`);
  });
}

export default app;
