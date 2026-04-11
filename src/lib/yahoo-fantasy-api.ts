import { YahooOAuth } from '@/lib/yahoo-oauth';
import { redisUtils } from '@/lib/redis';
import { getSession } from '@/lib/session';

interface YahooFantasyAPIError {
  error: string;
  description?: string;
  status?: number;
}

export interface League {
  league_key: string;
  league_id: string;
  name: string;
  url: string;
  logo_url?: string;
  draft_status: string;
  num_teams: number;
  edit_key: number;
  weekly_deadline?: string;
  league_update_timestamp?: string;
  scoring_type: string;
  league_type: string;
  renew?: string;
  renewed?: string;
  iris_group_chat_id?: string;
  allow_add_to_dl_extra_pos?: number;
  is_pro_league?: string;
  is_cash_league?: string;
  current_week?: string;
  start_week?: string;
  start_date?: string;
  end_week?: string;
  end_date?: string;
  is_finished?: number;
}

export interface Manager {
  manager_id: string;
  nickname?: string;
  guid: string;
  is_commissioner?: string;
  is_current_login?: string;
  email?: string;
  image_url?: string;
}

export interface Team {
  team_key: string;
  team_id: string;
  name: string;
  is_owned_by_current_login?: number;
  url: string;
  team_logos?: Array<{
    size: string;
    url: string;
  }>;
  waiver_priority?: number;
  number_of_moves?: string;
  number_of_trades?: number;
  roster_adds?: {
    coverage_type: string;
    coverage_value: number;
    value: string;
  };
  clinched_playoffs?: number;
  league_scoring_type?: string;
  managers?: Manager[];
}

export interface StatCategory {
  stat_id: number;
  name: string;
  display_name: string;
  sort_order: string;
  position_types?: string[];
  is_composite_stat?: number;
  base_stats?: string[];
}

// ---------------------------------------------------------------------------
// Stat value (shared across standings, scoreboard, team stats)
// ---------------------------------------------------------------------------

export interface StatValue {
  stat_id: number;
  value: string;
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export interface StandingsEntry {
  team_key: string;
  team_id: string;
  name: string;
  is_owned_by_current_login?: number;
  url: string;
  team_logos: Array<{ size: string; url: string }>;
  rank?: number;
  wins?: number;
  losses?: number;
  ties?: number;
  percentage?: string;
  points_for?: number;
  points_against?: number;
  points_back?: string;
  streak?: string;
  stats?: StatValue[];
}

// ---------------------------------------------------------------------------
// Scoreboard / Matchups
// ---------------------------------------------------------------------------

export interface MatchupTeam {
  team_key: string;
  team_id: string;
  name: string;
  is_owned_by_current_login?: number;
  team_logos: Array<{ size: string; url: string }>;
  points?: string;
  stats: StatValue[];
}

export interface MatchupData {
  week?: number;
  status: string;
  is_playoffs: boolean;
  is_tied: boolean;
  winner_team_key?: string;
  teams: MatchupTeam[];
}

// ---------------------------------------------------------------------------
// Team Stats
// ---------------------------------------------------------------------------

export interface TeamStats {
  team_key: string;
  team_id: string;
  name: string;
  week?: number;
  stats: StatValue[];
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export interface RosterEntry {
  player_key: string;
  player_id: string;
  name: string;
  editorial_team_abbr: string;
  display_position: string;
  eligible_positions: string[];
  selected_position: string;
  status?: string;          // 'IL', 'IL10', 'IL60', 'DTD', 'NA', 'DL', etc.
  status_full?: string;     // 'Injured Reserve', 'Day-to-Day', etc.
  image_url?: string;
  on_disabled_list: boolean;
  uniform_number?: string;
  /**
   * False when Yahoo has locked this player for the selected date —
   * typically because their game has already started. Moving a locked
   * player via the roster PUT will fail with "Player is not editable".
   * Defaults to true when Yahoo omits the flag.
   */
  is_editable: boolean;
}

// ---------------------------------------------------------------------------
// Free agent / league players
// ---------------------------------------------------------------------------

export interface FreeAgentPlayer {
  player_key: string;
  player_id: string;
  name: string;
  editorial_team_abbr: string;
  display_position: string;
  eligible_positions: string[];
  status?: string;
  status_full?: string;
  image_url?: string;
  on_disabled_list: boolean;
  uniform_number?: string;
  ownership_type: 'freeagent' | 'waivers';
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface TransactionPlayer {
  player_key: string;
  player_id: string;
  name: string;
  editorial_team_abbr: string;
  display_position: string;
  type: string;             // 'add' | 'drop'
  source_team_key?: string;
  destination_team_key?: string;
}

export interface TransactionEntry {
  transaction_key: string;
  transaction_id: string;
  type: string;             // 'add', 'drop', 'add/drop', 'trade'
  status: string;           // 'successful', 'pending', etc.
  timestamp?: number;       // Unix timestamp
  trader_team_key?: string;
  tradee_team_key?: string;
  players: TransactionPlayer[];
}

interface YahooAPIResponse<T> {
  fantasy_content: T;
}

/**
 * Minimal XML escaper for values we interpolate into write-request bodies.
 * Yahoo player_keys and position codes are ASCII-safe in practice, but we
 * still escape defensively so a future odd value can't break the payload.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Normalize Yahoo's variable position_types format to a plain string array.
 *
 * Yahoo JSON may return any of these shapes:
 *   "B"                              → ["B"]
 *   {"position_type": "B"}           → ["B"]
 *   {"position_type": ["B","P"]}     → ["B","P"]
 *   {"position_type": {"0":"B","count":1}}  → ["B"]
 *   ["B","P"]                        → ["B","P"]
 */
function normalizePositionTypes(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(v => typeof v === 'string');
  if (typeof raw === 'string') return [raw];
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const pt = obj['position_type'];
    if (pt === undefined) return [];
    if (typeof pt === 'string') return [pt];
    if (Array.isArray(pt)) return pt.filter(v => typeof v === 'string');
    if (typeof pt === 'object') {
      // Numeric-key object: {"0": "B", "count": 1}
      return Object.entries(pt as Record<string, unknown>)
        .filter(([k, v]) => k !== 'count' && typeof v === 'string')
        .map(([, v]) => v as string);
    }
  }
  return [];
}

/**
 * Yahoo Fantasy API client with automatic token management
 * Handles authentication, token refresh, and provides methods for fantasy sports data
 */
export class YahooFantasyAPI {
  private readonly baseUrl = 'https://fantasysports.yahooapis.com/fantasy/v2';
  private readonly yahooOAuth: YahooOAuth;
  private userId?: string;

  constructor(userId?: string) {
    this.yahooOAuth = new YahooOAuth();
    this.userId = userId;
  }

  /**
   * Get a valid access token, refreshing if necessary
   * Checks for expiration with 5-minute buffer and auto-refreshes expired tokens
   */
  private async getValidAccessToken(): Promise<string> {
    try {
      // Try to get user from session first, then fallback to Redis if userId provided
      let user = null;
      
      if (!this.userId) {
        const session = await getSession();
        user = session.user;
        this.userId = user?.id;
      } else {
        user = await this.getUserFromRedis(this.userId);
        // Redis may have been cleared (e.g. cache flush) — fall back to the
        // session cookie, which is the encrypted source of truth for auth data.
        if (!user) {
          const session = await getSession();
          if (session.user?.id === this.userId) {
            user = session.user;
          }
        }
      }

      if (!user) {
        throw new Error('User not authenticated');
      }

      // Check if token is expired or expires within 5 minutes (300 seconds buffer)
      const now = Date.now();
      const expiresAt = typeof user.expiresAt === 'string' ? parseInt(user.expiresAt) : user.expiresAt;
      const bufferTime = 5 * 60 * 1000; // 5 minutes in milliseconds

      if (now + bufferTime >= expiresAt) {
        console.log('Access token expired or expiring soon, refreshing...');
        
        if (!user.refreshToken) {
          throw new Error('No refresh token available');
        }

        // Refresh the access token
        const newTokens = await this.yahooOAuth.refreshAccessToken(user.refreshToken);
        const newExpiresAt = Date.now() + (newTokens.expires_in * 1000);

        // Update session if we got user from session
        if (!this.userId) {
          const session = await getSession();
          if (session.user) {
            session.user.accessToken = newTokens.access_token;
            session.user.refreshToken = newTokens.refresh_token;
            session.user.expiresAt = newExpiresAt;
            await session.save();
          }
        }

        // Always update Redis backup
        const userRedisKey = `user:${user.id}`;
        await redisUtils.hset(userRedisKey, 'accessToken', newTokens.access_token);
        await redisUtils.hset(userRedisKey, 'refreshToken', newTokens.refresh_token);
        await redisUtils.hset(userRedisKey, 'expiresAt', newExpiresAt.toString());

        // Update token lookup mapping
        const oldTokenKey = `token:${user.accessToken}`;
        const newTokenKey = `token:${newTokens.access_token}`;
        await redisUtils.del(oldTokenKey);
        await redisUtils.set(newTokenKey, user.id, newTokens.expires_in);

        console.log('Access token refreshed successfully');
        return newTokens.access_token;
      }

      return user.accessToken;
    } catch (error) {
      console.error('Failed to get valid access token:', error);
      throw new Error(`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get user data from Redis backup storage
   */
  private async getUserFromRedis(userId: string): Promise<any | null> {
    const userKey = `user:${userId}`;
    const userData = await redisUtils.hgetall(userKey);
    
    if (Object.keys(userData).length === 0) {
      return null;
    }
    
    return {
      id: userData.id,
      email: userData.email,
      name: userData.name,
      accessToken: userData.accessToken,
      refreshToken: userData.refreshToken,
      expiresAt: parseInt(userData.expiresAt),
      profile: userData.profile ? JSON.parse(userData.profile) : null,
      lastLogin: parseInt(userData.lastLogin)
    };
  }

  /**
   * Make an authenticated request to the Yahoo Fantasy API
   */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    try {
      const accessToken = await this.getValidAccessToken();
      
      // Add format=json to force JSON response (Yahoo API quirk)
      const separator = endpoint.includes('?') ? '&' : '?';
      const url = `${this.baseUrl}${endpoint}${separator}format=json`;
      
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication failed - token may be invalid');
        }
        if (response.status === 403) {
          throw new Error('Access forbidden - insufficient permissions');
        }
        if (response.status === 429) {
          throw new Error('Rate limit exceeded for Yahoo Fantasy API');
        }
        if (response.status === 500) {
          throw new Error('Yahoo Fantasy API server error');
        }

        let errorMessage = `Yahoo Fantasy API error: ${response.status}`;
        try {
          const errorData: YahooFantasyAPIError = await response.json();
          if (errorData.error) {
            errorMessage += ` - ${errorData.error}`;
            if (errorData.description) {
              errorMessage += `: ${errorData.description}`;
            }
          }
        } catch {
          errorMessage += ` - ${response.statusText}`;
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Yahoo Fantasy API request failed:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Unknown error occurred during API request');
    }
  }

  /**
   * Make an authenticated write request to the Yahoo Fantasy API.
   * Yahoo's write endpoints require XML bodies and do NOT accept `format=json`
   * on the URL (even though reads can). The response is still JSON when the
   * Accept header asks for it.
   */
  private async writeXml<T>(
    endpoint: string,
    method: 'PUT' | 'POST' | 'DELETE',
    xmlBody?: string,
  ): Promise<T> {
    const accessToken = await this.getValidAccessToken();
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/xml',
      },
      body: xmlBody,
    });

    if (!response.ok) {
      const rawBody = await response.text().catch(() => '');
      // Yahoo write errors come back as XML with a <description> element.
      // Pull it out so the caller gets a human-readable reason instead of
      // a pile of namespaced XML.
      const xmlDescription = rawBody.match(/<description>([^<]*)<\/description>/)?.[1]?.trim();

      let errorMessage: string;
      if (xmlDescription) {
        errorMessage = xmlDescription;
      } else if (response.status === 401) {
        errorMessage = 'Authentication failed — token may be invalid';
      } else if (response.status === 403) {
        errorMessage = 'Access forbidden — scope may be missing fspt-w';
      } else if (response.status === 429) {
        errorMessage = 'Rate limit exceeded for Yahoo Fantasy API';
      } else {
        errorMessage = `Yahoo Fantasy write error: ${response.status}`;
      }

      console.error('Yahoo Fantasy write failed:', { endpoint, method, status: response.status, body: rawBody });
      // Attach the original HTTP status so callers can branch on it.
      const err = new Error(errorMessage) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    // Some write endpoints return 201 with an empty body — return {} in that case.
    const text = await response.text();
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return {} as T;
    }
  }

  /**
   * Get user's fantasy leagues
   * Returns all leagues the authenticated user participates in
   */
  async getUserLeagues(gameKeys?: string[]): Promise<League[]> {
    try {
      let endpoint = '/users;use_login=1/games/leagues';
      
      // If specific game keys are provided, filter by them
      if (gameKeys && gameKeys.length > 0) {
        endpoint = `/users;use_login=1/games;game_keys=${gameKeys.join(',')}/leagues`;
      }

      const response = await this.request<YahooAPIResponse<any>>(endpoint);
      
      // Extract leagues from the nested Yahoo API response structure
      const leagues: League[] = [];
      
      if (response.fantasy_content?.users?.[0]?.user?.[1]?.games) {
        const games = response.fantasy_content.users[0].user[1].games;
        
        for (const gameData of Object.values(games)) {
          if (typeof gameData === 'object' && gameData && 'game' in gameData) {
            const game = (gameData as any).game;
            if (game && game[1] && game[1].leagues) {
              for (const leagueData of Object.values(game[1].leagues)) {
                if (typeof leagueData === 'object' && leagueData && 'league' in leagueData) {
                  const league = (leagueData as any).league[0];
                  leagues.push({
                    league_key: league.league_key,
                    league_id: league.league_id,
                    name: league.name,
                    url: league.url,
                    logo_url: league.logo_url,
                    draft_status: league.draft_status,
                    num_teams: league.num_teams,
                    edit_key: league.edit_key,
                    weekly_deadline: league.weekly_deadline,
                    league_update_timestamp: league.league_update_timestamp,
                    scoring_type: league.scoring_type,
                    league_type: league.league_type,
                    renew: league.renew,
                    renewed: league.renewed,
                    iris_group_chat_id: league.iris_group_chat_id,
                    allow_add_to_dl_extra_pos: league.allow_add_to_dl_extra_pos,
                    is_pro_league: league.is_pro_league,
                    is_cash_league: league.is_cash_league,
                    current_week: league.current_week,
                    start_week: league.start_week,
                    start_date: league.start_date,
                    end_week: league.end_week,
                    end_date: league.end_date,
                    is_finished: league.is_finished,
                  });
                }
              }
            }
          }
        }
      }
      
      return leagues;
    } catch (error) {
      console.error('Failed to get user leagues:', error);
      throw new Error(`Failed to get user leagues: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get teams in a specific league
   * @param leagueKey - The league key (e.g., "414.l.123456")
   */
  async getLeagueTeams(leagueKey: string): Promise<Team[]> {
    try {
      if (!leagueKey) {
        throw new Error('League key is required');
      }

      // Include managers sub-resource to get the manager data needed to identify user's team
      const endpoint = `/league/${leagueKey}/teams;out=managers`;
      const response = await this.request<YahooAPIResponse<any>>(endpoint);
      
      // Extract teams from the nested Yahoo API response structure
      const teams: Team[] = [];
      
      // Try multiple possible paths for team data based on Yahoo API documentation
      let teamsData = null;
      
      // Path 1: Standard response structure (league is an array with metadata at [0] and content at [1])
      if (response.fantasy_content?.league?.[1]?.teams) {
        teamsData = response.fantasy_content.league[1].teams;
      }
      // Path 2: Alternative structure (league is direct object)
      else if (response.fantasy_content?.league?.teams) {
        teamsData = response.fantasy_content.league.teams;
      }
      // Path 3: Direct teams array
      else if (response.fantasy_content?.teams) {
        teamsData = response.fantasy_content.teams;
      }
      
      if (teamsData) {
        // Handle Yahoo's specific team data structure
        // Teams are stored as numbered keys ("0", "1", "2", etc.) with each team having a complex nested structure
        for (const [teamIndex, teamContainer] of Object.entries(teamsData)) {
          if (teamIndex === 'count') continue; // Skip the count property
          
          if (typeof teamContainer === 'object' && teamContainer && 'team' in teamContainer) {
            const teamArray = (teamContainer as any).team;
            
            if (Array.isArray(teamArray) && teamArray.length >= 1) {
              // First element contains team properties as an array of objects
              const teamPropsArray = teamArray[0];
              // Second element (if exists) contains managers
              const managersContainer = teamArray.length > 1 ? teamArray[1] : null;
              
              if (Array.isArray(teamPropsArray)) {
                // Parse team properties from the array of objects
                const teamInfo: any = {};
                
                // Each property is stored as a separate object in the array
                for (const propObj of teamPropsArray) {
                  if (typeof propObj === 'object' && propObj) {
                    // Merge all properties into teamInfo
                    Object.assign(teamInfo, propObj);
                  }
                }
                
                // Add managers from the second array element if available
                if (managersContainer && 'managers' in managersContainer) {
                  teamInfo.managers = managersContainer.managers;
                }
                
                // Create team object if we have the required fields
                if (teamInfo.team_key && teamInfo.name) {
                  const team: Team = {
                    team_key: teamInfo.team_key || '',
                    team_id: teamInfo.team_id || '',
                    name: teamInfo.name || 'Unknown Team',
                    is_owned_by_current_login: teamInfo.is_owned_by_current_login,
                    url: teamInfo.url || '',
                    team_logos: teamInfo.team_logos || [],
                    waiver_priority: teamInfo.waiver_priority,
                    number_of_moves: teamInfo.number_of_moves,
                    number_of_trades: teamInfo.number_of_trades,
                    roster_adds: teamInfo.roster_adds,
                    clinched_playoffs: teamInfo.clinched_playoffs,
                    league_scoring_type: teamInfo.league_scoring_type,
                    managers: teamInfo.managers || [],
                  };
                  
                  teams.push(team);
                  console.log(`[DEBUG] Successfully parsed team: ${team.name} (${team.team_key}), owned by current user: ${team.is_owned_by_current_login}`);
                }
              }
            }
          }
        }
      }
      
      // Enhanced debug logging when no teams found
      if (teams.length === 0) {
        console.log(`[DEBUG] No teams found for league ${leagueKey} with managers sub-resource.`);
        console.log(`[DEBUG] Full API Response:`, JSON.stringify(response, null, 2));
        console.log(`[DEBUG] Response structure analysis:`, {
          hasFantasyContent: !!response.fantasy_content,
          hasLeague: !!response.fantasy_content?.league,
          leagueType: Array.isArray(response.fantasy_content?.league) ? 'array' : typeof response.fantasy_content?.league,
          leagueLength: Array.isArray(response.fantasy_content?.league) ? response.fantasy_content.league.length : 'n/a',
          hasTeams1: !!response.fantasy_content?.league?.[1]?.teams,
          hasTeamsDirect: !!response.fantasy_content?.league?.teams,
          hasTeamsRoot: !!response.fantasy_content?.teams,
          endpoint: endpoint,
          // Log all keys in the response for debugging
          responseKeys: response.fantasy_content ? Object.keys(response.fantasy_content) : [],
          leagueKeys: response.fantasy_content?.league ? 
            (Array.isArray(response.fantasy_content.league) ? 
              response.fantasy_content.league.map((item: any, index: number) => `[${index}]: ${typeof item === 'object' ? Object.keys(item || {}).join(', ') : typeof item}`) :
              Object.keys(response.fantasy_content.league)
            ) : []
        });
        
        // If league is an array, show the structure of each element
        if (Array.isArray(response.fantasy_content?.league)) {
          response.fantasy_content.league.forEach((leagueItem: any, index: number) => {
            console.log(`[DEBUG] League array item [${index}]:`, {
              type: typeof leagueItem,
              keys: typeof leagueItem === 'object' && leagueItem ? Object.keys(leagueItem) : 'n/a',
              hasTeams: typeof leagueItem === 'object' && leagueItem && 'teams' in leagueItem
            });
          });
        }
      }
      
      return teams;
    } catch (error) {
      console.error('Failed to get league teams for league', leagueKey, ':', error);
      throw new Error(`Failed to get league teams: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get available games/sports
   * Useful for getting current game keys for filtering leagues
   */
  async getGames(): Promise<any[]> {
    try {
      const endpoint = '/games';
      const response = await this.request<YahooAPIResponse<any>>(endpoint);
      
      const games: any[] = [];
      
      if (response.fantasy_content?.games) {
        for (const gameData of Object.values(response.fantasy_content.games)) {
          if (typeof gameData === 'object' && gameData && 'game' in gameData) {
            // Yahoo returns each game as an *array* where index 0 is the metadata
            // (game_key, season, code, etc.) and index 1 holds optional sub-resources.
            // Down-stream callers (e.g. agentFantasy.getCurrentMLBGameKey) expect a
            // flat object with readable fields (season, game_key, is_game_over,…).

            let rawGame: any = (gameData as any).game;

            // If the game container is an array we take the first element which
            // contains the metadata; otherwise we use the object as-is.
            const gameMeta = Array.isArray(rawGame) ? rawGame[0] : rawGame;

            // Push the flattened metadata so callers don't need to know Yahoo's
            // nested structure.
            games.push(gameMeta);
          }
        }
      }
      
      return games;
    } catch (error) {
      console.error('Failed to get games:', error);
      throw new Error(`Failed to get games: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get games filtered by sport codes for efficiency
   * @param gameCodes - Array of game codes (e.g., ['mlb', 'nfl']) or single code
   */
  async getGamesBySport(gameCodes: string | string[]): Promise<any[]> {
    try {
      const codes = Array.isArray(gameCodes) ? gameCodes.join(',') : gameCodes;
      const endpoint = `/games;game_codes=${codes}`;
      const response = await this.request<YahooAPIResponse<any>>(endpoint);
      
      const games: any[] = [];
      
      if (response.fantasy_content?.games) {
        for (const gameData of Object.values(response.fantasy_content.games)) {
          if (typeof gameData === 'object' && gameData && 'game' in gameData) {
            // Yahoo returns each game as an *array* where index 0 is the metadata
            // (game_key, season, code, etc.) and index 1 holds optional sub-resources.
            // Down-stream callers (e.g. agentFantasy.getCurrentMLBGameKey) expect a
            // flat object with readable fields (season, game_key, is_game_over,…).

            let rawGame: any = (gameData as any).game;

            // If the game container is an array we take the first element which
            // contains the metadata; otherwise we use the object as-is.
            const gameMeta = Array.isArray(rawGame) ? rawGame[0] : rawGame;

            // Push the flattened metadata so callers don't need to know Yahoo's
            // nested structure.
            games.push(gameMeta);
          }
        }
      }
      
      return games;
    } catch (error) {
      console.error('Failed to get games by sport:', error);
      throw new Error(`Failed to get games by sport: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get the current MLB season efficiently
   * Returns only the active MLB season or the most recent one
   */
  async getCurrentMLBSeason(): Promise<{ game_key: string; season: string; is_active: boolean }> {
    try {
      const mlbGames = await this.getGamesBySport('mlb');
      
      if (mlbGames.length === 0) {
        throw new Error('No MLB games found');
      }
      
      // Sort by season (highest first) to get most recent
      mlbGames.sort((a: any, b: any) => parseInt(b.season) - parseInt(a.season));
      
      // Prioritize active season (is_game_over === "0") or use most recent
      const activeGame = mlbGames.find((game: any) => game.is_game_over === "0");
      const currentGame = activeGame || mlbGames[0];
      
      return {
        game_key: currentGame.game_key,
        season: currentGame.season,
        is_active: currentGame.is_game_over === "0"
      };
    } catch (error) {
      console.error('Failed to get current MLB season:', error);
      throw new Error(`Failed to get current MLB season: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get stat categories for a specific game
   * @param gameKey - The game key (e.g., "458" for MLB 2025)
   * @returns Array of stat categories with their IDs and metadata
   */
  async getStatCategories(gameKey: string): Promise<StatCategory[]> {
    try {
      const endpoint = `/game/${gameKey}/stat_categories`;
      const response = await this.request<YahooAPIResponse<any>>(endpoint);
      
      const categories: StatCategory[] = [];
      
      // Parse the nested Yahoo API response structure
      if (response.fantasy_content?.game?.[1]?.stat_categories?.stats) {
        const stats = response.fantasy_content.game[1].stat_categories.stats;
        
        for (const statData of Object.values(stats)) {
          if (typeof statData === 'object' && statData && 'stat' in statData) {
            const stat = (statData as any).stat;
            categories.push({
              stat_id: Number(stat.stat_id),
              name: stat.name,
              display_name: stat.display_name,
              sort_order: stat.sort_order,
              position_types: normalizePositionTypes(stat.position_types),
              is_composite_stat: stat.is_composite_stat,
              base_stats: stat.base_stats?.base_stat || stat.base_stats || []
            });
          }
        }
      }

      return categories;
    } catch (error) {
      console.error('Failed to get stat categories:', error);
      throw new Error(`Failed to get stat categories: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build a stat category lookup map from an array of categories
   * @param categories - Array of stat categories
   * @returns Map of stat_id to category metadata
   */
  static buildStatCategoryMap(categories: StatCategory[]): Record<number, StatCategory> {
    return Object.fromEntries(
      categories.map(cat => [cat.stat_id, cat])
    );
  }

  /**
   * Get league settings including stat categories
   * @param leagueKey - The league key (e.g., "458.l.123456")
   * @returns League settings with stat categories
   */
  async getLeagueSettings(leagueKey: string): Promise<any> {
    try {
      const endpoint = `/league/${leagueKey}/settings`;
      const response = await this.request<YahooAPIResponse<any>>(endpoint);
      
      // Parse the nested Yahoo API response structure
      if (response.fantasy_content?.league?.[1]?.settings) {
        return response.fantasy_content.league[1].settings;
      }
      
      throw new Error('League settings not found in response');
    } catch (error) {
      console.error('Failed to get league settings for league', leagueKey, ':', error);
      throw new Error(`Failed to get league settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get the league's roster slot template — the set of positions and how
   * many of each are rostered (e.g. { 'C': 1, 'OF': 3, 'Util': 2, 'BN': 3 }).
   * Yahoo leagues vary: some have 2 C, CI/MI slots, more UTIL, etc.
   * Returns an ordered list so callers can preserve Yahoo's display order.
   */
  async getLeagueRosterPositions(leagueKey: string): Promise<Array<{ position: string; count: number; position_type?: string }>> {
    const settings = await this.getLeagueSettings(leagueKey);

    // roster_positions can be wrapped in several shapes across Yahoo responses:
    //   settings.roster_positions                        → array of { roster_position }
    //   settings[0].roster_positions                     → when settings itself is wrapped
    //   settings.roster_positions as numeric-key object  → { '0': {...}, 'count': N }
    let rpContainer: unknown = undefined;
    if (settings && typeof settings === 'object') {
      if ('roster_positions' in settings) {
        rpContainer = (settings as any).roster_positions;
      } else if (Array.isArray(settings) && settings[0]?.roster_positions) {
        rpContainer = settings[0].roster_positions;
      }
    }

    if (!rpContainer) {
      console.warn('[roster positions] not found in league settings for', leagueKey);
      return [];
    }

    // Normalize into a plain array of wrapper entries.
    let entries: any[] = [];
    if (Array.isArray(rpContainer)) {
      entries = rpContainer;
    } else if (typeof rpContainer === 'object') {
      for (const [k, v] of Object.entries(rpContainer)) {
        if (k === 'count') continue;
        entries.push(v);
      }
    }

    const out: Array<{ position: string; count: number; position_type?: string }> = [];
    for (const e of entries) {
      const rp = e?.roster_position ?? e;
      if (!rp || typeof rp !== 'object') continue;
      const position = rp.position;
      if (typeof position !== 'string' || !position) continue;
      const rawCount = rp.count;
      const count =
        typeof rawCount === 'number' ? rawCount :
        typeof rawCount === 'string' ? parseInt(rawCount, 10) :
        1;
      out.push({
        position,
        count: Number.isFinite(count) && count > 0 ? count : 1,
        position_type: typeof rp.position_type === 'string' ? rp.position_type : undefined,
      });
    }

    return out;
  }

  /**
   * Get stat categories used by a specific league
   * @param leagueKey - The league key (e.g., "458.l.123456")
   * @returns Array of stat categories used by this league with enriched metadata
   */
  async getLeagueStatCategories(leagueKey: string): Promise<StatCategory[]> {
    try {
      // Get league settings to find which stat categories are used
      const settings = await this.getLeagueSettings(leagueKey);
      
      // Yahoo responses sometimes wrap settings and sub-resources in an extra
      // array layer ( e.g. `settings[0].stat_categories[0].stats` ).
      // Resolve the correct reference defensively.
      let statsContainer: any | undefined = undefined;

      if (settings.stat_categories?.stats) {
        statsContainer = settings.stat_categories.stats;
      } else if (Array.isArray(settings.stat_categories) && settings.stat_categories[0]?.stats) {
        statsContainer = settings.stat_categories[0].stats;
      } else if (Array.isArray(settings) && settings[0]?.stat_categories?.stats) {
        statsContainer = settings[0].stat_categories.stats;
      }

      if (!statsContainer) {
        throw new Error('No stat categories found in league settings');
      }
      
      const categories: StatCategory[] = [];
      
      // Parse league-specific stat categories
      for (const statData of Object.values(statsContainer)) {
        if (typeof statData === 'object' && statData && 'stat' in statData) {
          const stat = (statData as any).stat;
          categories.push({
            stat_id: Number(stat.stat_id),
            name: stat.name,
            display_name: stat.display_name,
            sort_order: stat.sort_order,
            position_types: normalizePositionTypes(stat.position_types),
            is_composite_stat: stat.is_composite_stat,
            base_stats: stat.base_stats?.base_stat || stat.base_stats || []
          });
        }
      }

      return categories;
    } catch (error) {
      console.error('Failed to get league stat categories for league', leagueKey, ':', error);
      throw new Error(`Failed to get league stat categories: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // =========================================================================
  // Standings
  // =========================================================================

  /**
   * Get league standings (team records, ranks, points, stats).
   * @param leagueKey - The league key (e.g., "458.l.123456")
   */
  async getLeagueStandings(leagueKey: string): Promise<StandingsEntry[]> {
    const endpoint = `/league/${leagueKey}/standings`;
    const response = await this.request<YahooAPIResponse<any>>(endpoint);

    const entries: StandingsEntry[] = [];
    const teamsData =
      response.fantasy_content?.league?.[1]?.standings?.[0]?.teams ??
      response.fantasy_content?.league?.[1]?.standings?.teams;

    if (!teamsData) return entries;

    for (const [key, container] of Object.entries(teamsData)) {
      if (key === 'count') continue;
      if (typeof container !== 'object' || !container || !('team' in container)) continue;

      const teamArray = (container as any).team;
      if (!Array.isArray(teamArray)) continue;

      // First element: array of property objects. Remaining elements: sub-resources.
      const props: any = {};
      if (Array.isArray(teamArray[0])) {
        for (const p of teamArray[0]) {
          if (typeof p === 'object' && p) Object.assign(props, p);
        }
      }

      // Find team_standings sub-resource
      let standings: any = null;
      for (const el of teamArray) {
        if (typeof el === 'object' && el && 'team_standings' in el) {
          standings = el.team_standings;
          break;
        }
      }

      // Find team_stats sub-resource (standings endpoint may include season stats)
      let teamStats: StatValue[] = [];
      for (const el of teamArray) {
        if (typeof el === 'object' && el && 'team_stats' in el) {
          const rawStats = el.team_stats?.stats;
          if (rawStats) {
            for (const s of Object.values(rawStats)) {
              if (typeof s === 'object' && s && 'stat' in s) {
                const stat = (s as any).stat;
                teamStats.push({ stat_id: Number(stat.stat_id), value: stat.value });
              }
            }
          }
          break;
        }
      }

      entries.push({
        team_key: props.team_key ?? '',
        team_id: props.team_id ?? '',
        name: props.name ?? 'Unknown',
        is_owned_by_current_login: props.is_owned_by_current_login,
        url: props.url ?? '',
        team_logos: props.team_logos ?? [],
        rank: standings?.rank ? Number(standings.rank) : undefined,
        wins: standings?.outcome_totals?.wins ? Number(standings.outcome_totals.wins) : undefined,
        losses: standings?.outcome_totals?.losses ? Number(standings.outcome_totals.losses) : undefined,
        ties: standings?.outcome_totals?.ties ? Number(standings.outcome_totals.ties) : undefined,
        percentage: standings?.outcome_totals?.percentage ?? undefined,
        points_for: standings?.points_for ? Number(standings.points_for) : undefined,
        points_against: standings?.points_against ? Number(standings.points_against) : undefined,
        points_back: standings?.points_back ?? undefined,
        streak: standings?.streak?.type && standings?.streak?.value
          ? `${standings.streak.type}${standings.streak.value}`
          : undefined,
        stats: teamStats.length > 0 ? teamStats : undefined,
      });
    }

    return entries;
  }

  // =========================================================================
  // Scoreboard (matchups for a given week)
  // =========================================================================

  /**
   * Get the league scoreboard (all matchups for a given week).
   * Omit `week` for the current week.
   */
  async getLeagueScoreboard(leagueKey: string, week?: number): Promise<MatchupData[]> {
    const weekParam = week !== undefined ? `;week=${week}` : '';
    const endpoint = `/league/${leagueKey}/scoreboard${weekParam}`;
    const response = await this.request<YahooAPIResponse<any>>(endpoint);

    const matchups: MatchupData[] = [];

    const matchupsContainer =
      response.fantasy_content?.league?.[1]?.scoreboard?.['0']?.matchups ??
      response.fantasy_content?.league?.[1]?.scoreboard?.matchups;

    if (!matchupsContainer) return matchups;

    for (const [key, mContainer] of Object.entries(matchupsContainer)) {
      if (key === 'count') continue;
      if (typeof mContainer !== 'object' || !mContainer || !('matchup' in mContainer)) continue;

      const matchup = (mContainer as any).matchup;
      const matchupWeek = matchup.week ? Number(matchup.week) : week;
      const status = matchup.status ?? 'unknown';
      const isPlayoffs = matchup.is_playoffs === '1';
      const isTied = matchup.is_tied === '1';
      const winnerTeamKey = matchup.winner_team_key ?? undefined;

      // Parse teams in this matchup
      const teamsInMatchup: MatchupTeam[] = [];
      const teamsData = matchup['0']?.teams ?? matchup.teams;

      if (teamsData) {
        for (const [tKey, tContainer] of Object.entries(teamsData)) {
          if (tKey === 'count') continue;
          if (typeof tContainer !== 'object' || !tContainer || !('team' in tContainer)) continue;

          const teamArray = (tContainer as any).team;
          if (!Array.isArray(teamArray)) continue;

          const teamProps: any = {};
          if (Array.isArray(teamArray[0])) {
            for (const p of teamArray[0]) {
              if (typeof p === 'object' && p) Object.assign(teamProps, p);
            }
          }

          // Extract team stats from remaining elements
          const stats: StatValue[] = [];
          let teamPoints: string | undefined;
          for (const el of teamArray) {
            if (typeof el !== 'object' || !el) continue;
            if ('team_stats' in el) {
              const rawStats = el.team_stats?.stats;
              if (rawStats) {
                for (const s of Object.values(rawStats)) {
                  if (typeof s === 'object' && s && 'stat' in s) {
                    const stat = (s as any).stat;
                    stats.push({ stat_id: Number(stat.stat_id), value: stat.value });
                  }
                }
              }
            }
            if ('team_points' in el) {
              teamPoints = el.team_points?.total;
            }
          }

          teamsInMatchup.push({
            team_key: teamProps.team_key ?? '',
            team_id: teamProps.team_id ?? '',
            name: teamProps.name ?? 'Unknown',
            is_owned_by_current_login: teamProps.is_owned_by_current_login,
            team_logos: teamProps.team_logos ?? [],
            points: teamPoints,
            stats,
          });
        }
      }

      matchups.push({
        week: matchupWeek,
        status,
        is_playoffs: isPlayoffs,
        is_tied: isTied,
        winner_team_key: winnerTeamKey,
        teams: teamsInMatchup,
      });
    }

    return matchups;
  }

  // =========================================================================
  // Team Stats
  // =========================================================================

  /**
   * Get team stats — season-to-date or for a specific week.
   */
  async getTeamStats(teamKey: string, week?: number): Promise<TeamStats> {
    const weekParam = week !== undefined ? `;type=week;week=${week}` : '';
    const endpoint = `/team/${teamKey}/stats${weekParam}`;
    const response = await this.request<YahooAPIResponse<any>>(endpoint);

    const teamArray = response.fantasy_content?.team;
    const teamProps: any = {};
    const stats: StatValue[] = [];

    if (Array.isArray(teamArray)) {
      // Parse team properties from first element
      if (Array.isArray(teamArray[0])) {
        for (const p of teamArray[0]) {
          if (typeof p === 'object' && p) Object.assign(teamProps, p);
        }
      }

      // Find team_stats in remaining elements
      for (const el of teamArray) {
        if (typeof el !== 'object' || !el || !('team_stats' in el)) continue;
        const rawStats = el.team_stats?.stats;
        if (rawStats) {
          for (const s of Object.values(rawStats)) {
            if (typeof s === 'object' && s && 'stat' in s) {
              const stat = (s as any).stat;
              stats.push({ stat_id: Number(stat.stat_id), value: stat.value });
            }
          }
        }
      }
    }

    return {
      team_key: teamProps.team_key ?? teamKey,
      team_id: teamProps.team_id ?? '',
      name: teamProps.name ?? 'Unknown',
      week: week,
      stats,
    };
  }

  // =========================================================================
  // Roster
  // =========================================================================

  /**
   * Get team roster (players and their positions/status).
   * @param date - Specific date (YYYY-MM-DD) or omit for today
   * @param week - Week number (for weekly leagues)
   */
  async getTeamRoster(teamKey: string, options?: { date?: string; week?: number }): Promise<RosterEntry[]> {
    let param = '';
    if (options?.date) param = `;date=${options.date}`;
    else if (options?.week) param = `;week=${options.week}`;

    const endpoint = `/team/${teamKey}/roster${param}`;
    const response = await this.request<YahooAPIResponse<any>>(endpoint);

    const roster: RosterEntry[] = [];
    const teamArray = response.fantasy_content?.team;

    if (!Array.isArray(teamArray)) return roster;

    // Find the roster sub-resource
    let playersData: any = null;
    for (const el of teamArray) {
      if (typeof el === 'object' && el && 'roster' in el) {
        // roster -> 0 -> players  OR  roster -> players
        playersData =
          el.roster?.['0']?.players ??
          el.roster?.players;
        break;
      }
    }

    if (!playersData) return roster;

    for (const [key, pContainer] of Object.entries(playersData)) {
      if (key === 'count') continue;
      if (typeof pContainer !== 'object' || !pContainer || !('player' in pContainer)) continue;

      const playerArray = (pContainer as any).player;
      if (!Array.isArray(playerArray)) continue;

      const playerProps: any = {};
      if (Array.isArray(playerArray[0])) {
        for (const p of playerArray[0]) {
          if (typeof p === 'object' && p) Object.assign(playerProps, p);
        }
      }

      // Walk the sibling objects after the flat props block at index 0.
      // They look like: { selected_position: [...] }, { starting_status: [...] },
      // { is_editable: 0|1 }. `is_editable` is its OWN sibling, not nested
      // inside selected_position — false when the player's game has already
      // started and their slot is locked for the day.
      let selectedPosition: string | undefined;
      let isEditable: boolean | undefined;
      const toBool = (v: unknown): boolean | undefined => {
        if (v === 0 || v === '0') return false;
        if (v === 1 || v === '1') return true;
        return undefined;
      };
      for (const el of playerArray) {
        if (typeof el !== 'object' || !el) continue;

        if ('selected_position' in el) {
          const selPos = (el as any).selected_position;
          selectedPosition =
            selPos?.[1]?.position ??
            selPos?.position ??
            (Array.isArray(selPos) ? selPos.find((x: any) => x?.position)?.position : undefined);
        }

        if ('is_editable' in el) {
          isEditable = toBool((el as any).is_editable);
        }
      }

      // Extract eligible positions
      const eligiblePositions: string[] = [];
      if (playerProps.eligible_positions) {
        const ep = playerProps.eligible_positions;
        if (Array.isArray(ep)) {
          for (const pos of ep) {
            if (typeof pos === 'string') eligiblePositions.push(pos);
            else if (pos?.position) eligiblePositions.push(pos.position);
          }
        }
      }

      roster.push({
        player_key: playerProps.player_key ?? '',
        player_id: playerProps.player_id ?? '',
        name: playerProps.name?.full ?? playerProps.name?.first + ' ' + playerProps.name?.last ?? 'Unknown',
        editorial_team_abbr: playerProps.editorial_team_abbr ?? '',
        display_position: playerProps.display_position ?? '',
        eligible_positions: eligiblePositions,
        selected_position: selectedPosition ?? 'BN',
        status: playerProps.status ?? undefined,
        status_full: playerProps.status_full ?? undefined,
        image_url: playerProps.image_url ?? playerProps.headshot?.url ?? undefined,
        on_disabled_list: playerProps.on_disabled_list === 1,
        uniform_number: playerProps.uniform_number ?? undefined,
        is_editable: isEditable ?? true,
      });
    }

    return roster;
  }

  /**
   * Set the full roster for a team on a given date.
   * Yahoo requires the ENTIRE roster to be sent in one PUT — partial updates
   * that would temporarily produce an illegal lineup are rejected. Callers
   * should pass every player currently on the team with their target slot.
   *
   * @param teamKey  e.g. '458.l.123456.t.1'
   * @param date     YYYY-MM-DD — day the lineup applies to
   * @param players  full list of { player_key, position } for every rostered player
   */
  async setRoster(
    teamKey: string,
    date: string,
    players: Array<{ player_key: string; position: string }>,
  ): Promise<void> {
    const playerXml = players
      .map(
        (p) =>
          `<player><player_key>${escapeXml(p.player_key)}</player_key>` +
          `<position>${escapeXml(p.position)}</position></player>`,
      )
      .join('');

    const body =
      `<?xml version="1.0"?>` +
      `<fantasy_content>` +
      `<roster>` +
      `<coverage_type>date</coverage_type>` +
      `<date>${escapeXml(date)}</date>` +
      `<players>${playerXml}</players>` +
      `</roster>` +
      `</fantasy_content>`;

    await this.writeXml<unknown>(`/team/${teamKey}/roster`, 'PUT', body);
  }

  // =========================================================================
  // Transactions
  // =========================================================================

  /**
   * Get league transactions (adds, drops, trades).
   * @param type - Filter by type: 'add', 'drop', 'trade', or omit for all
   */
  async getLeagueTransactions(leagueKey: string, type?: 'add' | 'drop' | 'trade'): Promise<TransactionEntry[]> {
    const typeParam = type ? `;type=${type}` : '';
    const endpoint = `/league/${leagueKey}/transactions${typeParam}`;
    const response = await this.request<YahooAPIResponse<any>>(endpoint);

    const transactions: TransactionEntry[] = [];
    const txContainer =
      response.fantasy_content?.league?.[1]?.transactions;

    if (!txContainer) return transactions;

    for (const [key, tContainer] of Object.entries(txContainer)) {
      if (key === 'count') continue;
      if (typeof tContainer !== 'object' || !tContainer || !('transaction' in tContainer)) continue;

      const tx = (tContainer as any).transaction;
      const txData = Array.isArray(tx) ? tx[0] : tx;
      const playersContainer = Array.isArray(tx) && tx[1]?.players ? tx[1].players : null;

      // Parse players involved
      const players: TransactionPlayer[] = [];
      if (playersContainer) {
        for (const [pKey, pContainer] of Object.entries(playersContainer)) {
          if (pKey === 'count') continue;
          if (typeof pContainer !== 'object' || !pContainer || !('player' in pContainer)) continue;

          const playerArray = (pContainer as any).player;
          if (!Array.isArray(playerArray)) continue;

          const playerProps: any = {};
          if (Array.isArray(playerArray[0])) {
            for (const p of playerArray[0]) {
              if (typeof p === 'object' && p) Object.assign(playerProps, p);
            }
          }

          // Find transaction_data
          let txPlayerData: any = null;
          for (const el of playerArray) {
            if (typeof el === 'object' && el && 'transaction_data' in el) {
              const td = el.transaction_data;
              txPlayerData = Array.isArray(td) ? td[0] : td;
              break;
            }
          }

          players.push({
            player_key: playerProps.player_key ?? '',
            player_id: playerProps.player_id ?? '',
            name: playerProps.name?.full ?? 'Unknown',
            editorial_team_abbr: playerProps.editorial_team_abbr ?? '',
            display_position: playerProps.display_position ?? '',
            type: txPlayerData?.type ?? '',
            source_team_key: txPlayerData?.source_team_key ?? undefined,
            destination_team_key: txPlayerData?.destination_team_key ?? undefined,
          });
        }
      }

      transactions.push({
        transaction_key: txData.transaction_key ?? '',
        transaction_id: txData.transaction_id ?? '',
        type: txData.type ?? '',
        status: txData.status ?? '',
        timestamp: txData.timestamp ? Number(txData.timestamp) : undefined,
        trader_team_key: txData.trader_team_key ?? undefined,
        tradee_team_key: txData.tradee_team_key ?? undefined,
        players,
      });
    }

    return transactions;
  }

  // =========================================================================
  // Team Matchups (schedule)
  // =========================================================================

  /**
   * Get matchup schedule for a specific team.
   * @param weeks - Comma-separated week numbers or omit for all
   */
  async getTeamMatchups(teamKey: string, weeks?: number[]): Promise<MatchupData[]> {
    const weeksParam = weeks ? `;weeks=${weeks.join(',')}` : '';
    const endpoint = `/team/${teamKey}/matchups${weeksParam}`;
    const response = await this.request<YahooAPIResponse<any>>(endpoint);

    const matchups: MatchupData[] = [];
    const teamArray = response.fantasy_content?.team;
    if (!Array.isArray(teamArray)) return matchups;

    // Find matchups sub-resource
    let matchupsData: any = null;
    for (const el of teamArray) {
      if (typeof el === 'object' && el && 'matchups' in el) {
        matchupsData = el.matchups;
        break;
      }
    }

    if (!matchupsData) return matchups;

    for (const [key, mContainer] of Object.entries(matchupsData)) {
      if (key === 'count') continue;
      if (typeof mContainer !== 'object' || !mContainer || !('matchup' in mContainer)) continue;

      const matchup = (mContainer as any).matchup;
      const teams: MatchupTeam[] = [];
      const teamsData = matchup['0']?.teams ?? matchup.teams;

      if (teamsData) {
        for (const [tKey, tContainer] of Object.entries(teamsData)) {
          if (tKey === 'count') continue;
          if (typeof tContainer !== 'object' || !tContainer || !('team' in tContainer)) continue;

          const tArray = (tContainer as any).team;
          if (!Array.isArray(tArray)) continue;

          const tProps: any = {};
          if (Array.isArray(tArray[0])) {
            for (const p of tArray[0]) {
              if (typeof p === 'object' && p) Object.assign(tProps, p);
            }
          }

          teams.push({
            team_key: tProps.team_key ?? '',
            team_id: tProps.team_id ?? '',
            name: tProps.name ?? 'Unknown',
            is_owned_by_current_login: tProps.is_owned_by_current_login,
            team_logos: tProps.team_logos ?? [],
            stats: [],
          });
        }
      }

      matchups.push({
        week: matchup.week ? Number(matchup.week) : undefined,
        status: matchup.status ?? 'unknown',
        is_playoffs: matchup.is_playoffs === '1',
        is_tied: matchup.is_tied === '1',
        winner_team_key: matchup.winner_team_key ?? undefined,
        teams,
      });
    }

    return matchups;
  }

  // =========================================================================
  // League Players (Free Agents)
  // =========================================================================

  /**
   * Get free agent players from a league, optionally filtered by position.
   * Yahoo caps at 25 per page. This fetches up to `maxPages` pages.
   * @param status - 'FA' for free agents only, 'A' for all available (FA + waivers)
   */
  async getLeaguePlayers(
    leagueKey: string,
    options?: { position?: string; status?: 'FA' | 'A'; count?: number; maxPages?: number },
  ): Promise<FreeAgentPlayer[]> {
    const status = options?.status ?? 'A';
    const count = options?.count ?? 25;
    const maxPages = options?.maxPages ?? 4; // 100 players max
    const posParam = options?.position ? `;position=${options.position}` : '';

    const players: FreeAgentPlayer[] = [];

    for (let page = 0; page < maxPages; page++) {
      const start = page * count;
      const endpoint = `/league/${leagueKey}/players;status=${status}${posParam};start=${start};count=${count}`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await this.request<YahooAPIResponse<any>>(endpoint);
      const leagueArray = response.fantasy_content?.league;
      if (!Array.isArray(leagueArray)) break;

      // Find the players sub-resource
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let playersData: any = null;
      for (const el of leagueArray) {
        if (typeof el === 'object' && el && 'players' in el) {
          playersData = el.players;
          break;
        }
      }
      if (!playersData) break;

      let foundAny = false;
      for (const [key, pContainer] of Object.entries(playersData)) {
        if (key === 'count') continue;
        if (typeof pContainer !== 'object' || !pContainer || !('player' in pContainer)) continue;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const playerArray = (pContainer as any).player;
        if (!Array.isArray(playerArray)) continue;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const playerProps: any = {};
        if (Array.isArray(playerArray[0])) {
          for (const p of playerArray[0]) {
            if (typeof p === 'object' && p) Object.assign(playerProps, p);
          }
        }

        // Extract eligible positions
        const eligiblePositions: string[] = [];
        if (playerProps.eligible_positions) {
          const ep = playerProps.eligible_positions;
          if (Array.isArray(ep)) {
            for (const pos of ep) {
              if (typeof pos === 'string') eligiblePositions.push(pos);
              else if (pos?.position) eligiblePositions.push(pos.position);
            }
          }
        }

        // Determine ownership type
        let ownershipType: 'freeagent' | 'waivers' = 'freeagent';
        if (playerProps.ownership?.ownership_type === 'waivers') {
          ownershipType = 'waivers';
        }

        players.push({
          player_key: playerProps.player_key ?? '',
          player_id: playerProps.player_id ?? '',
          name: playerProps.name?.full ?? (playerProps.name?.first + ' ' + playerProps.name?.last) ?? 'Unknown',
          editorial_team_abbr: playerProps.editorial_team_abbr ?? '',
          display_position: playerProps.display_position ?? '',
          eligible_positions: eligiblePositions,
          status: playerProps.status ?? undefined,
          status_full: playerProps.status_full ?? undefined,
          image_url: playerProps.image_url ?? playerProps.headshot?.url ?? undefined,
          on_disabled_list: playerProps.on_disabled_list === 1,
          uniform_number: playerProps.uniform_number ?? undefined,
          ownership_type: ownershipType,
        });
        foundAny = true;
      }

      // If no players found on this page, we've exhausted results
      if (!foundAny) break;
      // If we got fewer than count, this was the last page
      if (players.length < (page + 1) * count) break;
    }

    return players;
  }

  /**
   * Check API health and token validity
   * Returns basic information about the current user and API status
   */
  async healthCheck(): Promise<{ status: string; user?: any; tokenValid: boolean }> {
    try {
      const accessToken = await this.getValidAccessToken();
      
      // Simple request to verify token validity
      const userInfo = await this.yahooOAuth.getUserInfo(accessToken);
      
      return {
        status: 'healthy',
        user: {
          id: userInfo.sub,
          name: userInfo.name || userInfo.preferred_username,
          email: userInfo.email,
        },
        tokenValid: true,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        tokenValid: false,
      };
    }
  }
} 