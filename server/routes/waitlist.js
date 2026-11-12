import express from 'express';
import axios from 'axios';
import { PLANNERS } from '../lib/planner-hints.js';
import { getSettings } from '../lib/entitlements.js';

/* Photo import waitlist. Stores nothing itself: each request is written to the log as one JSON line and, if
   WAITLIST_WEBHOOK_URL is set (a Google Sheet script, Zapier, Slack, PostHog...), forwarded there.
   The planner choice tells us which layouts to tune first. */
const router = express.Router();
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

router.post('/', express.json({ limit: '4kb' }), async (req, res) => {
  if ((await getSettings()).flags.waitlist_open === false) return res.status(403).json({ error: 'The waitlist is closed right now. Please check back soon.' });
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const planner = Object.prototype.hasOwnProperty.call(PLANNERS, b.planner) ? b.planner : '';
  if (!EMAIL.test(email) || email.length > 254) return res.status(400).json({ error: 'Please enter a valid email address.' });
  const row = {
    email, planner, other: planner === 'other' ? String(b.other || '').replace(/\s+/g, ' ').trim().slice(0, 60) : '',
    source: String(b.source || '').replace(/[^\w-]/g, '').slice(0, 20), at: new Date().toISOString(),
  };
  console.log(JSON.stringify({ waitlist: row }));
  if (process.env.WAITLIST_WEBHOOK_URL) axios.post(process.env.WAITLIST_WEBHOOK_URL, row, { timeout: 4000 }).catch(() => {});
  res.status(204).end();
});

export default router;
