import '$lib/server/env-shim';
import type { Handle } from '@sveltejs/kit';
import { verifySession } from '$lib/server/auth';

// Fail loud at boot if a required secret is missing in production. Dev keeps
// the fallback so `npm run dev` still works without ceremony.
if (process.env.NODE_ENV === 'production') {
  const missing: string[] = [];
  if (!process.env.SESSION_SECRET) missing.push('SESSION_SECRET');
  if (!process.env.PORTAL_EMAIL) missing.push('PORTAL_EMAIL');
  if (!process.env.PORTAL_PASSWORD) missing.push('PORTAL_PASSWORD');
  if (!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_ID_V2_READ_WRITE_TOKEN)) {
    missing.push('BLOB_READ_WRITE_TOKEN (or BLOB_ID_V2_READ_WRITE_TOKEN)');
  }
  if (missing.length) {
    throw new Error(`Missing required env in production: ${missing.join(', ')}`);
  }
}

export const handle: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get('session');
  const session = await verifySession(token);
  event.locals.user = session ? { email: session.email } : null;
  return resolve(event);
};
