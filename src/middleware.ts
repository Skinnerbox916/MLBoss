import { NextResponse, NextRequest } from 'next/server';
import { getIronSession } from 'iron-session';
import { sessionOptions, SessionData } from '@/lib/session';

export async function middleware(request: NextRequest) {
  // Get the pathname from the request
  const { pathname } = request.nextUrl;
  
  // Define protected routes
  const protectedRoutes = [
    '/dashboard',
    '/admin',
    '/matchup',
    '/lineup',
    '/roster',
    '/league',
    '/api/fantasy'
  ];
  
  // Check if the current path matches any protected route
  const isProtectedRoute = protectedRoutes.some(route => 
    pathname.startsWith(route)
  );
  
  // If it's not a protected route, continue without authentication check
  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  try {
    // Get the session using iron-session
    // In middleware, we need to use the request/response objects directly
    const response = NextResponse.next();
    const session = await getIronSession<SessionData>(
      request,
      response,
      sessionOptions
    );

    // Check if user is authenticated
    if (!session.user || !session.user.id) {
      // User is not authenticated, redirect to sign-in page
      const signInUrl = new URL('/', request.url);
      
      // Add the original URL as a redirect parameter for post-login redirect
      signInUrl.searchParams.set('redirect', pathname);
      
      return NextResponse.redirect(signInUrl);
    }

    // Check if the access token is expired
    const now = Date.now();
    if (session.user.expiresAt && now >= session.user.expiresAt) {
      // Token is expired, redirect to sign-in for re-authentication
      const signInUrl = new URL('/', request.url);
      signInUrl.searchParams.set('redirect', pathname);
      signInUrl.searchParams.set('reason', 'expired');
      
      return NextResponse.redirect(signInUrl);
    }

    // User is authenticated and token is valid, allow the request to continue
    return response;
    
  } catch (error) {
    // If there's an error reading the session, treat as unauthenticated
    console.error('Middleware session error:', error);
    
    const signInUrl = new URL('/', request.url);
    signInUrl.searchParams.set('redirect', pathname);
    signInUrl.searchParams.set('reason', 'error');
    
    return NextResponse.redirect(signInUrl);
  }
}

// Configure which paths the middleware should run on
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (authentication routes)
     * - api/ping (health check)
     * - api/test-redis (test routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!api/auth|api/ping|api/test-redis|_next/static|_next/image|favicon.ico|public).*)',
  ],
}; 