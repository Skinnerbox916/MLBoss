import { parseString } from 'xml2js';
import { getAccessToken } from '../lib/client/auth';
import { YahooApiOptions } from '../lib/shared/types';

const API_TIMEOUT = 5000;

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

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Token expired or invalid');
    }
    const text = await response.text();
    throw new Error(`Yahoo API error (${response.status}): ${text}`);
  }

  // For XML responses, parse and convert to JSON
  const contentType = response.headers.get('content-type') || '';
  let responseData: T;

  if (contentType.includes('xml')) {
    const text = await response.text();
    responseData = await parseYahooXml<T>(text);
  } else {
    responseData = await response.json() as T;
  }

  return responseData;
}

/**
 * Parse Yahoo XML response
 * @param xmlText XML response text
 * @returns Parsed object
 */
export async function parseYahooXml<T>(xmlText: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    parseString(xmlText, (err: Error | null, result: T) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Get MLB game ID from Yahoo API
 * @returns MLB game ID
 */
export async function getYahooMlbGameId(): Promise<string> {
  const gameUrl = 'https://fantasysports.yahooapis.com/fantasy/v2/game/mlb';
  const gameData = await fetchYahooApi<any>(gameUrl, { 
    category: 'static',
    ttl: 24 * 60 * 60
  });
  
  const gameId = gameData?.fantasy_content?.game?.[0]?.game_id?.[0];
  if (!gameId) {
    throw new Error('Could not find MLB game ID');
  }
  
  return gameId;
}

/**
 * Get user's team key
 * @param gameId Yahoo MLB game ID
 * @returns Team key
 */
export async function getYahooTeamKey(gameId: string): Promise<string> {
  const teamUrl = `https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=${gameId}/teams`;
  const teamData = await fetchYahooApi<any>(teamUrl, {
    category: 'daily',
    ttl: 60 * 60
  });
  
  const teamKey = teamData?.fantasy_content?.users?.[0]?.user?.[0]?.games?.[0]?.game?.[0]?.teams?.[0]?.team?.[0]?.team_key?.[0];
  if (!teamKey) {
    throw new Error('Could not find team key');
  }
  
  return teamKey;
} 