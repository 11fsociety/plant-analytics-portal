import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  const isPublic = url.pathname === '/login' || url.pathname.startsWith('/api/auth');
  if (!locals.user && !isPublic) {
    const next = url.pathname + url.search;
    throw redirect(302, `/login?next=${encodeURIComponent(next)}`);
  }
  if (locals.user && url.pathname === '/login') {
    throw redirect(302, url.searchParams.get('next') || '/dashboard');
  }
  return { user: locals.user };
};
