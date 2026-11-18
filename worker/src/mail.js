// Hands a pending link mail to Google Apps Script (the only mail sender) and records the outcome.
import { jstDate } from './rules.js';
import { markSent } from './db.js';

export function makeSendMail(env, db, now, fetchImpl = fetch, timeoutMs = 25000) {
  return async function sendMail({ email, url }) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(env.GAS_MAIL_URL, {
        method: 'POST',
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret: env.SYNC_SECRET, action: 'sendLink', email, url, expiresAt: env.EXPIRES_AT }),
      });
      const reply = JSON.parse(await res.text());
      if (reply && reply.ok === true && reply.sent === true) await markSent(db, email, jstDate(now()));
    } catch (err) {
      // Anything else leaves the row pending; the hourly resend picks it up.
      console.error('sendMail failed: ' + (err && err.message));
    } finally {
      clearTimeout(timer);
    }
  };
}
