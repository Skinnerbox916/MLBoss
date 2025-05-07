import { NextRequest, NextResponse } from 'next/server';
import { YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, YAHOO_REDIRECT_URI } from '@/app/utils/auth';
import { clearYahooCookies, getStoredState } from '@/app/utils/auth.server';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state || state !== getStoredState()) {
    return NextResponse.redirect('/');
  }

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

  if (!tokenRes.ok) {
    return NextResponse.redirect('/');
  }

  const tokenData = await tokenRes.json();
  const response = NextResponse.redirect('https://mlboss.skibri.us/dashboard');
  clearYahooCookies();
  response.cookies.set('yahoo_access_token', tokenData.access_token, { httpOnly: true, secure: true, path: '/', maxAge: tokenData.expires_in || 3600, sameSite: 'lax' });
  response.cookies.set('yahoo_refresh_token', tokenData.refresh_token, { httpOnly: true, secure: true, path: '/', sameSite: 'lax' });
  response.cookies.set('yahoo_client_access_token', tokenData.access_token, { httpOnly: false, secure: true, path: '/', maxAge: tokenData.expires_in || 3600, sameSite: 'lax' });
  return response;
} 