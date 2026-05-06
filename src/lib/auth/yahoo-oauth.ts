interface YahooTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  xoauth_yahoo_guid?: string;
  id_token?: string;
}

export interface YahooUserInfo {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  locale?: string;
  email?: string;
  email_verified?: boolean;
  birthdate?: string;
  profile_images?: {
    image32?: string;
    image64?: string;
    image128?: string;
    image192?: string;
  };
  picture?: string;
  preferred_username?: string;
  nickname?: string;
  gender?: string;
  middle_name?: string;
}

interface YahooErrorResponse {
  error: string;
  error_description?: string;
}

export class YahooOAuth {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private authorizationUrl = 'https://api.login.yahoo.com/oauth2/request_auth';
  private tokenUrl = 'https://api.login.yahoo.com/oauth2/get_token';
  private userInfoUrl = 'https://api.login.yahoo.com/openid/v1/userinfo';

  constructor() {
    const clientId = process.env.YAHOO_CLIENT_ID;
    const clientSecret = process.env.YAHOO_CLIENT_SECRET;
    const baseUrl = process.env.APP_URL || 'https://dev-tunnel.skibri.us';

    if (!clientId || !clientSecret) {
      throw new Error('YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET environment variables must be set');
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = `${baseUrl}/api/auth/callback/yahoo`;
  }

  /**
   * Generate authorization URL for Yahoo OAuth 2.0
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid fspt-w',
      state: state,
      nonce: this.generateNonce(),
      language: 'en-us'
    });

    const authUrl = `${this.authorizationUrl}?${params.toString()}`;
    
    return authUrl;
  }

  /**
   * Exchange authorization code for access tokens
   */
  async getAccessToken(code: string): Promise<YahooTokenResponse> {
    try {
      const bodyParams = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: this.redirectUri
      });
      
      const response = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${this.getBasicAuthHeader()}`
        },
        body: bodyParams
      });

      if (!response.ok) {
        let errorData: YahooErrorResponse;
        try {
          errorData = await response.json();
        } catch {
          throw new Error(`Yahoo OAuth error: HTTP ${response.status} - ${response.statusText}`);
        }
        console.error('Yahoo OAuth token exchange error:', {
          status: response.status,
          error: errorData.error,
          description: errorData.error_description
        });
        throw new Error(`Yahoo OAuth error: ${errorData.error} - ${errorData.error_description || 'Unknown error'}`);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to exchange authorization code: ${error.message}`);
      }
      throw new Error('Failed to exchange authorization code: Unknown error');
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<YahooTokenResponse> {
    try {
      const response = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${this.getBasicAuthHeader()}`
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          redirect_uri: this.redirectUri
        })
      });

      if (!response.ok) {
        const errorData: YahooErrorResponse = await response.json();
        throw new Error(`Yahoo OAuth refresh error: ${errorData.error} - ${errorData.error_description || 'Unknown error'}`);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to refresh access token: ${error.message}`);
      }
      throw new Error('Failed to refresh access token: Unknown error');
    }
  }

  /**
   * Get user profile information using access token
   */
  async getUserInfo(accessToken: string): Promise<YahooUserInfo> {
    try {
      const response = await fetch(this.userInfoUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Access token expired or invalid');
        }
        if (response.status === 429) {
          throw new Error('Rate limit exceeded for Yahoo UserInfo API');
        }
        
        let errorMessage = `Yahoo UserInfo API error: ${response.status}`;
        try {
          const errorData: YahooErrorResponse = await response.json();
          errorMessage += ` - ${errorData.error}: ${errorData.error_description || 'Unknown error'}`;
        } catch {
          // If error response is not JSON, use status text
          errorMessage += ` - ${response.statusText}`;
        }
        
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to get user info: ${error.message}`);
      }
      throw new Error('Failed to get user info: Unknown error');
    }
  }

  /**
   * Decode ID Token (JWT) to extract user information
   * Note: This is a basic decode without signature verification
   * For production, you should verify the signature using Yahoo's public keys
   */
  decodeIdToken(idToken: string): Record<string, unknown> {
    try {
      // Split the JWT into its three parts
      const parts = idToken.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid ID token format');
      }

      // Decode the payload (second part)
      const payload = parts[1];
      // Add padding if necessary
      const paddedPayload = payload + '='.repeat((4 - payload.length % 4) % 4);
      const decodedPayload = Buffer.from(paddedPayload, 'base64').toString('utf8');
      
      return JSON.parse(decodedPayload);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to decode ID token: ${error.message}`);
      }
      throw new Error('Failed to decode ID token: Unknown error');
    }
  }

  /**
   * Generate Basic Auth header for client credentials
   */
  private getBasicAuthHeader(): string {
    const credentials = `${this.clientId}:${this.clientSecret}`;
    return Buffer.from(credentials).toString('base64');
  }

  /**
   * Generate a random nonce for security
   */
  private generateNonce(): string {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }
} 