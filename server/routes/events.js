import express from 'express';
import axios from 'axios';

/* Anonymous product analytics. The app sends a handful of named milestones with a random install id.
   No names, emails, plan content or Google identity ever come through here. Events are written to the log
   and, if ANALYTICS_WEBHOOK_URL is set, forwarded there (PostHog, a Google Sheet webhook, etc.). */
export const EVENTS = ['landed', 'setup_started', 'setup_completed', 'big3_set', 'weekly_review_done', 'day7_return', 'signed_in', 'first_task', 'invite_requested'];
const router = express.Router();

router.post('/', express.json({ limit: '2kb' }), (req, res) => {
  const { e, id, v, planner } = req.body || {};
  if (!EVENTS.includes(e) || typeof id !== 'string' || !/^[\w-]{6,40}$/.test(id)) return res.status(400).json({ error: 'bad event' });
  const row = { event: e, install: id, version: String(v || '').slice(0, 20), at: new Date().toISOString() };
  if (e === 'invite_requested' && /^\w{1,20}$/.test(String(planner || ''))) row.planner = planner;      // which planner brand, never the email
  console.log(JSON.stringify({ analytics: row }));
  if (process.env.ANALYTICS_WEBHOOK_URL) axios.post(process.env.ANALYTICS_WEBHOOK_URL, row, { timeout: 3000 }).catch(() => {});
  res.status(204).end();
});

export default router;
