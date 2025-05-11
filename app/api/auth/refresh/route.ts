import { NextRequest, NextResponse } from 'next/server';
import { getRefreshToken, clearYahooCookies } from '../../../utils/auth.server';

export async function POST(req: NextRequest) {
  const refreshToken = getRefreshToken();
  
  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token available' }, { status: 401 });
  }

  // Exchange refresh token for new access token using hard-coded values
  const clientId = 'dj0yJmk9dWZ4NW1yb1lsVXJ6JmQ9WVdrOU1ubGFaWGQzY1RBbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PTRi';
  const clientSecret = '3ec2cbb9c20965cdaf99f98c2d8cd9e558cd9d8c';
  
  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('refresh_token', refreshToken);
  params.append('grant_type', 'refresh_token');

  try {
    const tokenRes = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
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
    response.cookies.set('yahoo_access_token', String(tokenData.access_token), {
      httpOnly: true,
      secure: true,
      path: '/',
      maxAge: tokenData.expires_in || 3600,
      sameSite: 'lax',
    });
    response.cookies.set('yahoo_refresh_token', String(tokenData.refresh_token), {
      httpOnly: true,
      secure: true,
      path: '/',
      sameSite: 'lax',
    });

    return response;
  } catch (error) {
    console.error('Error refreshing token:', error);
    clearYahooCookies();
    return NextResponse.json({ error: 'Failed to refresh token' }, { status: 500 });
  }
}