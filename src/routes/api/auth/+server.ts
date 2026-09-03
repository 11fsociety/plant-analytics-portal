import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkCredentials, signSession } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, cookies }) => {
  const body = await request.json().catch(() => ({}));
  const { email, password } = (body || {}) as { email?: string; password?: string };
  if (!email || !password || !checkCredentials(email, password)) {
    return json({ error: 'Invalid credentials' }, { status: 401 });
  }
  const token = await signSession(email);
  cookies.set('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 30 * 24 * 3600,
  });
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ cookies }) => {
  cookies.delete('session', { path: '/' });
  return json({ ok: true });
};
