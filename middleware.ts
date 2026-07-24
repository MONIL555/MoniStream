import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const publicPaths = [
  '/login',
  '/register',
  '/forgot-password',
  '/api/auth',
  '/api/config',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow static assets, next build files, images, manifest, etc.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/images') ||
    pathname === '/favicon.ico' ||
    pathname === '/icon.png' ||
    pathname === '/manifest.ts' ||
    pathname === '/sw.ts' ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.json') || // e.g., manifest.json
    pathname.endsWith('.js') // e.g., service worker
  ) {
    return NextResponse.next();
  }

  const isPublicPath = publicPaths.some((p) => pathname.startsWith(p));
  
  const accessToken = request.cookies.get('access_token')?.value;
  const refreshToken = request.cookies.get('refresh_token')?.value;
  const isAuthenticated = !!(accessToken || refreshToken);

  // If path is not public and user is not authenticated, redirect/block
  if (!isAuthenticated && !isPublicPath) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // If authenticated and trying to access login/register, redirect to home
  if (isAuthenticated && (pathname === '/login' || pathname === '/register')) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
