import { parseString } from 'xml2js';

export const API_TIMEOUT = 5000;

/**
 * Parse Yahoo XML response
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
 * Process Yahoo API response based on content type
 */
export async function processYahooResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Token expired or invalid');
    }
    const text = await response.text();
    throw new Error(`Yahoo API error (${response.status}): ${text}`);
  }

  const contentType = response.headers.get('content-type') || '';
  
  if (contentType.includes('xml')) {
    const text = await response.text();
    return parseYahooXml<T>(text);
  }
  
  return response.json() as Promise<T>;
}

/**
 * Common Yahoo API endpoints
 */
export const YAHOO_ENDPOINTS = {
  MLB_GAME: 'https://fantasysports.yahooapis.com/fantasy/v2/game/mlb',
  USER_TEAMS: (gameId: string) => 
    `https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=${gameId}/teams`,
  PLAYER_STATS: (playerKey: string, date: string) =>
    `https://fantasysports.yahooapis.com/fantasy/v2/player/${playerKey}/stats;type=date;date=${date}`
} as const;

/**
 * Extract MLB game ID from Yahoo API response
 */
export function extractMlbGameId(data: any): string {
  const gameId = data?.fantasy_content?.game?.[0]?.game_id?.[0];
  if (!gameId) {
    throw new Error('Could not find MLB game ID');
  }
  return gameId;
}

/**
 * Extract team key from Yahoo API response
 */
export function extractTeamKey(data: any): string {
  const teamKey = data?.fantasy_content?.users?.[0]?.user?.[0]?.games?.[0]?.game?.[0]?.teams?.[0]?.team?.[0]?.team_key?.[0];
  if (!teamKey) {
    throw new Error('Could not find team key');
  }
  return teamKey;
}

/**
 * Extract player game info from Yahoo API response
 */
export function extractPlayerGameInfo(data: any): {
  has_game_today: boolean;
  game_start_time: string | null;
  data_source: string;
} {
  const hasGame = data?.fantasy_content?.player?.[0]?.stats?.[0]?.stats?.[0]?.stat?.[0]?.value?.[0] !== '0';
  
  return {
    has_game_today: hasGame,
    game_start_time: null, // Yahoo API doesn't provide game time
    data_source: 'yahoo'
  };
} 