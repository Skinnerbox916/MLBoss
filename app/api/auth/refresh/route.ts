import { NextRequest, NextResponse } from 'next/server';
import { YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, getRefreshToken, clearYahooCookies } from '../../../utils/auth';

export async function POST(req: NextRequest) {
  const refreshToken = getRefreshToken();
  
  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token available' }, { status: 401 });
  }

  // Exchange refresh token for new access token
  const params = new URLSearchParams();
  params.append('client_id', YAHOO_CLIENT_ID);
  params.append('client_secret', YAHOO_CLIENT_SECRET);
  params.append('refresh_token', refreshToken);
  params.append('grant_type', 'refresh_token');

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
    // If refresh token is invalid, clear all cookies
    clearYahooCookies();
    return NextResponse.json({ error: 'Failed to refresh token' }, { status: 401 });
  }

  // Clear existing cookies before setting new ones
  clearYahooCookies();

  // Set new tokens in HTTP-only cookies
  const response = NextResponse.json({ success: true });
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