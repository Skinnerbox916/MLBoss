'use client';

import { getAccessToken } from '../lib/client/auth';
import { YahooApiOptions } from '../lib/shared/types';
import { 
  API_TIMEOUT, 
  processYahooResponse, 
  YAHOO_ENDPOINTS,
  extractMlbGameId,
  extractTeamKey
} from './yahoo-api-utils';

/**
 * Fetch data from Yahoo API (client-side version)
 * @param endpoint API endpoint URL
 * @param options API options
 * @returns Response data object
 */
export async function fetchYahooApi<T>(
  endpoint: string,
  options: YahooApiOptions = {}
): Promise<T> {
  // Get access token
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  // Fetch fresh data
  console.log(`Yahoo API: Fetching ${endpoint}`);
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(options.timeout || API_TIMEOUT),
  });

  return processYahooResponse<T>(response);
}

/**
 * Get MLB game ID from Yahoo API
 * @returns MLB game ID
 */
export async function getYahooMlbGameId(): Promise<string> {
  const gameData = await fetchYahooApi<any>(YAHOO_ENDPOINTS.MLB_GAME, { 
    category: 'static',
    ttl: 24 * 60 * 60
  });
  
  return extractMlbGameId(gameData);
}

/**
 * Get user's team key
 * @param gameId Yahoo MLB game ID
 * @returns Team key
 */
export async function getYahooTeamKey(gameId: string): Promise<string> {
  const teamData = await fetchYahooApi<any>(YAHOO_ENDPOINTS.USER_TEAMS(gameId), {
    category: 'daily',
    ttl: 60 * 60
  });
  
  return extractTeamKey(teamData);
} 