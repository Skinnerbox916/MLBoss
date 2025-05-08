import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    const { state } = data;
    
    if (!state) {
      return NextResponse.json({ error: 'No state provided' }, { status: 400 });
    }
    
    // Store state in a server-side cookie with less restrictive settings
    cookies().set('yahoo_state', state, { 
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // Only secure in production
      path: '/',
      maxAge: 600, // 10 minutes
      sameSite: 'lax'
    });
    
    console.log('Server-side state saved:', state);
    
    // Also set in the response for better persistence
    const response = NextResponse.json({ success: true });
    response.cookies.set('yahoo_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600
    });
    
    return response;
  } catch (error) {
    console.error('Error saving state:', error);
    return NextResponse.json({ error: 'Failed to save state' }, { status: 500 });
  }
} 