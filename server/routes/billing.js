import express from 'express';
import crypto from 'node:crypto';
import axios from 'axios';
import { configured, rest, userFromToken } from '../lib/supa.js';
import { forgetEntitlement } from '../lib/entitlements.js';

/* Stripe subscriptions for the "plus" tier, using Stripe's hosted Checkout and Customer Portal pages
   (so there is no card form to build or secure). Stripe talks to /webhook; the webhook writes the person's
   entitlement, which is what photo import and the admin page read. REST calls, no SDK. */
const api = () => String(process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, '');
const enabled = () => !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PLUS && configured());
const siteUrl = () => String(process.env.SITE_URL || 'https://testingrino.github.io/LifeOS/').replace(/#.*$/, '');
const stripe = async (path, params) => (await axios.post(`${api()}${path}`, new URLSearchParams(params).toString(), { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 })).data;

/* ---- the webhook needs the raw request body to check Stripe's signature, so it has its own router ---- */
export function verifyStripeSignature(raw, header, secret, now = Date.now(), toleranceSec = 300) {
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=')).filter((p) => p.length === 2));
  if (!parts.t || !parts.v1 || !secret) return false;
  if (Math.abs(now / 1000 - Number(parts.t)) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(String(parts.v1));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const mapStatus = (s) => (['active', 'trialing'].includes(s) ? 'active' : ['past_due', 'unpaid'].includes(s) ? 'past_due' : 'canceled');
async function upsert(email, patch) {
  const out = await rest('entitlements', { method: 'POST', query: { on_conflict: 'email' }, body: { email, ...patch }, prefer: 'resolution=merge-duplicates,return=representation' });
  forgetEntitlement(email); return out;
}
async function findBy(column, value) { const [row] = await rest('entitlements', { query: { [column]: `eq.${value}`, select: '*', limit: 1 } }); return row || null; }

async function handleEvent(ev) {
  const o = ev.data && ev.data.object ? ev.data.object : {};
  if (ev.type === 'checkout.session.completed' && o.mode === 'subscription') {
    const email = String((o.customer_details && o.customer_details.email) || o.customer_email || '').trim().toLowerCase();
    if (!email) return;
    const uid = /^[0-9a-f-]{36}$/i.test(String(o.client_reference_id || '')) ? o.client_reference_id : undefined;
    await upsert(email, { tier: 'plus', status: 'active', source: 'stripe', stripe_customer_id: o.customer, stripe_subscription_id: o.subscription, ...(uid ? { user_id: uid } : {}) });
  } else if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(ev.type)) {
    const row = (await findBy('stripe_subscription_id', o.id)) || (await findBy('stripe_customer_id', o.customer));
    if (!row) return;
    const status = ev.type.endsWith('deleted') ? 'canceled' : mapStatus(o.status);
    await upsert(row.email, { status, tier: status === 'canceled' ? 'free' : 'plus', stripe_subscription_id: o.id, current_period_end: o.current_period_end ? new Date(o.current_period_end * 1000).toISOString() : null });
  } else if (ev.type === 'invoice.payment_failed') {
    const row = await findBy('stripe_customer_id', o.customer);
    if (row) await upsert(row.email, { status: 'past_due' });
  }
}
export const webhook = express.Router();
webhook.post('/', express.raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET, raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!configured() || !secret) return res.status(503).json({ error: 'Billing is not configured.' });
  if (!verifyStripeSignature(raw, req.headers['stripe-signature'], secret)) return res.status(400).json({ error: 'Bad signature.' });
  let ev; try { ev = JSON.parse(raw); } catch (e) { return res.status(400).json({ error: 'Bad body.' }); }
  try { await handleEvent(ev); res.json({ received: true }); } catch (e) { console.error('stripe webhook failed:', e.message); res.status(500).json({ error: 'Could not record that.' }); }   // Stripe retries on 5xx
});

/* ---- called by the app, signed in ---- */
const router = express.Router();
router.use(express.json({ limit: '4kb' }));
router.use(async (req, res, next) => {
  if (!enabled()) return res.status(503).json({ error: 'Billing is not set up yet.' });
  const m = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
  const who = m ? await userFromToken(m[1]) : null;
  if (!who || !who.confirmed) return res.status(401).json({ error: 'Please sign in to manage your plan.' });
  req.who = who; next();
});
router.post('/checkout', async (req, res) => {
  try {
    const row = await findBy('email', req.who.email);
    const params = { mode: 'subscription', 'line_items[0][price]': process.env.STRIPE_PRICE_PLUS, 'line_items[0][quantity]': '1', success_url: `${siteUrl()}#/settings`, cancel_url: `${siteUrl()}#/settings`, client_reference_id: req.who.id, allow_promotion_codes: 'true', 'subscription_data[metadata][email]': req.who.email };
    if (row && row.stripe_customer_id) params.customer = row.stripe_customer_id; else params.customer_email = req.who.email;
    res.json({ url: (await stripe('/v1/checkout/sessions', params)).url });
  } catch (e) { console.error('checkout failed:', e.response?.data?.error?.message || e.message); res.status(502).json({ error: 'Could not start checkout.' }); }
});
router.post('/portal', async (req, res) => {
  try {
    const row = await findBy('email', req.who.email);
    if (!row || !row.stripe_customer_id) return res.status(404).json({ error: 'No subscription to manage yet.' });
    res.json({ url: (await stripe('/v1/billing_portal/sessions', { customer: row.stripe_customer_id, return_url: `${siteUrl()}#/settings` })).url });
  } catch (e) { console.error('portal failed:', e.response?.data?.error?.message || e.message); res.status(502).json({ error: 'Could not open billing.' }); }
});
export default router;
