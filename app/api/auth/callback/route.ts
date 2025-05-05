import { NextRequest, NextResponse } from 'next/server';

const YAHOO_CLIENT_ID = 'dj0yJmk9eUFSWTNWZW9GWFFVJmQ9WVdrOWRYVkVaazF3TWswbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PTk5';
const YAHOO_CLIENT_SECRET = '5dba8ae54c5ff474f54f511047ef48fab1084a35';
const YAHOO_REDIRECT_URI = 'https://e657-45-29-68-219.ngrok-free.app/api/auth/callback';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return NextResponse.json({ error: 'No code provided' }, { status: 400 });
  }

  // Exchange code for access token
  const params = new URLSearchParams();
  params.append('client_id', YAHOO_CLIENT_ID);
  params.append('client_secret', YAHOO_CLIENT_SECRET);
  params.append('redirect_uri', YAHOO_REDIRECT_URI);
  params.append('code', code);
  params.append('grant_type', 'authorization_code');

  const tokenRes = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${YAHOO_CLIENT_ID}:${YAHOO_CLIENT_SECRET}`).toString('base64'),
    },
    body: params.toString(),
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok) {
    return NextResponse.json({ error: 'Failed to get token', details: tokenData }, { status: 400 });
  }

  // Set tokens in HTTP-only cookies
  const response = NextResponse.redirect('https://e657-45-29-68-219.ngrok-free.app/dashboard');
  response.cookies.set('yahoo_access_token', tokenData.access_token, {
    httpOnly: true,
    secure: true,
    path: '/',
    maxAge: tokenData.expires_in || 3600,
    sameSite: 'lax',
  });
  response.cookies.set('yahoo_refresh_token', tokenData.refresh_token, {
    httpOnly: true,
    secure: true,
    path: '/',
    sameSite: 'lax',
  });

  return response;
} 