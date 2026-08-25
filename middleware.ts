import { NextResponse, type NextRequest } from 'next/server';
import { verifySession } from './lib/auth';

const PUBLIC_PATHS = ['/login', '/api/auth', '/manifest.webmanifest', '/sw.js', '/favicon.ico'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }
  if (pathname.startsWith('/_next') || pathname.startsWith('/icons/') || /\.(png|svg|jpg|ico|css|js|json|webmanifest)$/i.test(pathname)) {
    return NextResponse.next();
  }
  const token = req.cookies.get('session')?.value;
  if (!(await verifySession(token))) {
    if (pathname.startsWith('/api/')) {
      return new NextResponse(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
