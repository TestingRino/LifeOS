import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import authRoutes from './routes/auth.js';
import calendarRoutes from './routes/calendar.js';
import ocrRoutes from './routes/ocr.js';
import eventsRoutes from './routes/events.js';
import { corsOptions, securityHeaders, rateLimit } from './middleware/security.js';
import { requireAllowedUser, identify, isAllowed } from './middleware/requireUser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: `${__dirname}/.env` });

const app = express();
const PORT = process.env.PORT || 3001;

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(securityHeaders);
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));          // photos arrive as multipart (multer caps those), never as JSON

app.use('/api/auth', rateLimit({ windowMs: 60e3, max: 30 }), authRoutes);
app.use('/api/calendar', rateLimit({ windowMs: 60e3, max: 120 }), calendarRoutes);
app.use('/api/events', rateLimit({ windowMs: 60e3, max: 30 }), eventsRoutes);
// Photo import is limited to whitelisted Google accounts (OCR_ALLOWED_EMAILS). This lets the app ask up front.
app.get('/api/ocr/access', rateLimit({ windowMs: 60e3, max: 30 }), async (req, res) => {
  const who = await identify(req);
  if (who.error) return res.json({ allowed: false, signedIn: false, reason: who.error });
  res.json({ allowed: isAllowed(who.email), signedIn: true, email: who.email });
});
app.use('/api/ocr', rateLimit({ windowMs: 60e3, max: 20 }), requireAllowedUser, ocrRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Life.OS server running on port ${PORT}`);
    console.log(`  Google OAuth: ${process.env.GOOGLE_CLIENT_ID ? '✓' : '✗'}`);
    console.log(`  Claude API: ${process.env.ANTHROPIC_API_KEY ? '✓' : '✗'}`);
  });
}

export default app;
