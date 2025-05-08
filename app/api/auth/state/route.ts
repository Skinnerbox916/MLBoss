import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    const { state } = data;
    
    if (!state) {
      return NextResponse.json({ error: 'No state provided' }, { status: 400 });
    }
    
    // Store state in a server-side cookie with settings that will persist across redirects
    const cookieStore = cookies();
    cookieStore.set('yahoo_state', state, { 
      httpOnly: true,
      secure: true, // Always use secure for OAuth flows
      path: '/',
      maxAge: 600, // 10 minutes
      sameSite: 'lax' // Important for OAuth redirects
    });
    
    console.log('Server-side state saved:', state);
    
    // Return the state in the response for confirmation
    return NextResponse.json({ success: true, state });
  } catch (error) {
    console.error('Error saving state:', error);
    return NextResponse.json({ error: 'Failed to save state' }, { status: 500 });
  }
} 