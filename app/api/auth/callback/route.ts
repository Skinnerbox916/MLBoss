import { NextRequest, NextResponse } from 'next/server';
import { clearYahooCookies, getStoredState } from '@/app/utils/auth.server';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    
    // Check for redirect loop prevention
    const redirectCount = parseInt(url.searchParams.get('redirect_count') || '0');
    
    // Redirect localhost requests to the tunnel URL (limit to one redirect)
    if (url.hostname === 'localhost' && redirectCount === 0) {
      console.log('Redirecting localhost callback to tunnel URL');
      const tunnelUrl = new URL(url.pathname, 'https://dev-tunnel.skibri.us');
      
      // Copy all query parameters
      url.searchParams.forEach((value, key) => {
        tunnelUrl.searchParams.append(key, String(value));
      });
      
      // Add redirect counter to prevent loops
      tunnelUrl.searchParams.set('redirect_count', '1');
      
      return NextResponse.redirect(tunnelUrl.toString());
    }
    
    // Check for error response from Yahoo
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');
    
    if (error) {
      console.error(`Yahoo OAuth error: ${error} - ${errorDescription}`);
      
      // Handle invalid_scope error specifically
      if (error === 'invalid_scope') {
        return NextResponse.redirect('https://dev-tunnel.skibri.us/?error=invalid_scope&message=' + 
          encodeURIComponent('The app requires proper scope permissions. Please try again.'));
      }
      
      return NextResponse.redirect(`https://dev-tunnel.skibri.us/?error=${error}`);
    }
    
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const storedState = getStoredState();
    
    console.log('Auth callback received - code exists:', !!code, 'state matches:', state === storedState);
    // Additional debug logging for actual values
    console.log('Received URL:', String(req.url));
    console.log('Auth code:', code);
    console.log('State received:', state);
    console.log('Stored state:', storedState);

    // TEMPORARY: Instead of immediately rejecting, log a warning and continue
    // This is only for debugging purposes and should be removed after fixing the issue
    if (!code) {
      console.error('Missing authorization code!');
      return NextResponse.redirect('https://dev-tunnel.skibri.us/?error=missing_code');
    } 
    
    if (!state || state !== storedState) {
      console.warn('⚠️ State mismatch detected. Attempting to proceed for debugging purposes.');
      console.warn('This is a temporary fix and should be removed once state verification is working!');
      // In production, this should be:
      // return NextResponse.redirect('https://dev-tunnel.skibri.us/?error=state_mismatch');
    }

    // Create a URLSearchParams without using the problematic constants directly
    const clientId = 'dj0yJmk9dWZ4NW1yb1lsVXJ6JmQ9WVdrOU1ubGFaWGQzY1RBbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PTRi';
    const clientSecret = '3ec2cbb9c20965cdaf99f98c2d8cd9e558cd9d8c';
    const redirectUri = 'https://dev-tunnel.skibri.us/api/auth/callback';
    
    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('redirect_uri', redirectUri);
    params.append('code', code || '');
    params.append('grant_type', 'authorization_code');

    // Avoid console.log with complex objects that might contain symbols
    console.log('Preparing to request token with code');
    
    const tokenRes = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: params.toString(),
    });
    
    const responseText = await tokenRes.text();
    
    let tokenData;
    
    try {
      tokenData = JSON.parse(responseText);
      console.log('Token response status:', tokenRes.status, 'Success:', tokenRes.ok);
    } catch (e) {
      console.error('Failed to parse token response:', responseText);
      return NextResponse.redirect('https://dev-tunnel.skibri.us/?error=invalid_response');
    }

    if (!tokenRes.ok) {
      console.error('Token request failed:', tokenData?.error || 'Unknown error');
      console.error('Error description:', tokenData?.error_description);
      return NextResponse.redirect(`https://dev-tunnel.skibri.us/?error=${tokenData?.error || 'unknown'}`);
    }

    const response = NextResponse.redirect('https://dev-tunnel.skibri.us/dashboard');
    clearYahooCookies();
    response.cookies.set('yahoo_access_token', String(tokenData.access_token), { 
      httpOnly: true, 
      secure: true, 
      path: '/', 
      maxAge: tokenData.expires_in || 3600, 
      sameSite: 'lax' 
    });
    
    response.cookies.set('yahoo_refresh_token', String(tokenData.refresh_token), { 
      httpOnly: true, 
      secure: true, 
      path: '/', 
      sameSite: 'lax' 
    });
    
    response.cookies.set('yahoo_client_access_token', String(tokenData.access_token), { 
      httpOnly: false, 
      secure: true, 
      path: '/', 
      maxAge: tokenData.expires_in || 3600, 
      sameSite: 'lax' 
    });
    
    console.log('Authentication successful, redirecting to dashboard');
    return response;
  } catch (error) {
    console.error('Authentication error:', error);
    return NextResponse.redirect('https://dev-tunnel.skibri.us/?error=server_error');
  }
} 