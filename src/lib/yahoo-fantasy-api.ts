import { YahooOAuth } from '@/lib/yahoo-oauth';
import { redisUtils } from '@/lib/redis';
import { getSession } from '@/lib/session';

interface YahooFantasyAPIError {
  error: string;
  description?: string;
  status?: number;
}

interface League {
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

interface Team {
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
  managers?: Array<{
    manager_id: string;
    nickname?: string;
    guid: string;
    is_commissioner?: string;
    is_current_login?: string;
    email?: string;
    image_url?: string;
  }>;
}

interface StatCategory {
  stat_id: number;
  name: string;
  display_name: string;
  sort_order: string;
  position_types?: string[];
  is_composite_stat?: number;
  base_stats?: string[];
}

interface YahooAPIResponse<T> {
  fantasy_content: T;
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
              position_types: stat.position_types?.position_type || stat.position_types || [],
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