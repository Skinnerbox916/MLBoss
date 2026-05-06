import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function POST() {
  try {
    const baseUrl = process.env.APP_URL || 'https://dev-tunnel.skibri.us';
    const session = await getSession();
    
    // Destroy the session
    session.destroy();
    
    // Redirect to home page
    return NextResponse.redirect(new URL('/', baseUrl));
  } catch (error) {
    console.error('Logout error:', error);
    const baseUrl = process.env.APP_URL || 'https://dev-tunnel.skibri.us';
    return NextResponse.redirect(new URL('/auth/error?error=logout_failed', baseUrl));
  }
}

// Reject other HTTP methods for security
export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST for logout.' },
    { status: 405 }
  );
} 