import * as webpush from 'web-push';

/* Web push sender. The VAPID key pair identifies this server to the browsers' push services.
   Generate one with `npx web-push generate-vapid-keys` (see DEPLOY.md). */
export const configured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const publicKey = () => process.env.VAPID_PUBLIC_KEY || null;

let ready = false;
const defaultSender = async (subscription, payload) => {
  if (!ready) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || process.env.SITE_URL || 'https://example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    ready = true;
  }
  await webpush.sendNotification(subscription, payload, { TTL: 3600, urgency: 'normal' });
};
let sender = defaultSender;
/* Tests swap the sender so nothing touches the network. Call with no argument to restore the real one. */
export const setSender = (fn) => { sender = fn || defaultSender; };

/* Send to one stored subscription row. Returns { ok } or { gone: true } when the browser says it is unsubscribed. */
export async function sendPush(row, payload) {
  try {
    await sender({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(payload));
    return { ok: true };
  } catch (e) {
    return e && (e.statusCode === 404 || e.statusCode === 410) ? { gone: true } : { ok: false, error: (e && e.message) || 'push failed' };
  }
}
