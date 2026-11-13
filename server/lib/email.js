import axios from 'axios';
import crypto from 'node:crypto';

/* Email through Resend (https://resend.com). Needs RESEND_API_KEY and DIGEST_FROM, a sender on a domain you verified. */
export const configured = () => !!(process.env.RESEND_API_KEY && process.env.DIGEST_FROM);

const defaultSender = async ({ to, subject, text, html }) => {
  await axios.post('https://api.resend.com/emails', { from: process.env.DIGEST_FROM, to: [to], subject, text, html }, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, timeout: 10000,
  });
};
let sender = defaultSender;
export const setSender = (fn) => { sender = fn || defaultSender; };
export async function sendEmail(msg) {
  try { await sender(msg); return { ok: true }; } catch (e) { return { ok: false, error: (e && e.message) || 'email failed' }; }
}

/* Unsubscribe links are signed so nobody can switch off someone else's digest. */
const secret = () => process.env.REMINDER_SECRET || process.env.CRON_SECRET || '';
export const canSign = () => !!secret();
export const sign = (email) => crypto.createHmac('sha256', secret()).update(String(email).toLowerCase()).digest('hex');
export function verify(email, token) {
  if (!secret() || typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return false;
  return crypto.timingSafeEqual(Buffer.from(sign(email), 'hex'), Buffer.from(token, 'hex'));
}
export const unsubscribeUrl = (apiBase, email) => `${apiBase.replace(/\/$/, '')}/api/reminders/unsubscribe?e=${encodeURIComponent(String(email).toLowerCase())}&t=${sign(email)}`;
