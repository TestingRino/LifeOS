import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import authRoutes from './routes/auth.js';
import calendarRoutes from './routes/calendar.js';
import ocrRoutes from './routes/ocr.js';
import { requireAllowedUser, identify, isAllowed } from './middleware/requireUser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: `${__dirname}/.env` });

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/calendar', calendarRoutes);
// Photo import is limited to whitelisted Google accounts (OCR_ALLOWED_EMAILS). This lets the app ask up front.
app.get('/api/ocr/access', async (req, res) => {
  const who = await identify(req);
  if (who.error) return res.json({ allowed: false, signedIn: false, reason: who.error });
  res.json({ allowed: isAllowed(who.email), signedIn: true, email: who.email });
});
app.use('/api/ocr', requireAllowedUser, ocrRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Life.OS server running on port ${PORT}`);
    console.log(`  Google OAuth: ${process.env.GOOGLE_CLIENT_ID ? '✓' : '✗'}`);
    console.log(`  Claude API: ${process.env.ANTHROPIC_API_KEY ? '✓' : '✗'}`);
  });
}

export default app;
