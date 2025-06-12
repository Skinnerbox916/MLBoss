// AGENT Library Entry Point
// This file will contain the main logic, tools, and behaviors for LLM-powered agents in the MLBoss project.

import { redis, redisUtils } from '@/lib/redis';
import { YahooOAuth } from '@/lib/yahoo-oauth';
import { YahooFantasyAPI } from '@/lib/yahoo-fantasy-api';
import { getSession } from '@/lib/session';

// Agent state management using Redis
export class AgentState {
  constructor(private agentId: string) {}

  async saveState(key: string, value: any): Promise<void> {
    const stateKey = `agent:${this.agentId}:${key}`;
    await redisUtils.set(stateKey, JSON.stringify(value));
  }

  async getState<T>(key: string): Promise<T | null> {
    const stateKey = `agent:${this.agentId}:${key}`;
    const value = await redisUtils.get(stateKey);
    return value ? JSON.parse(value) : null;
  }

  async deleteState(key: string): Promise<void> {
    const stateKey = `agent:${this.agentId}:${key}`;
    await redisUtils.del(stateKey);
  }
}

// Agent cache utilities
export const agentCache = {
  async cacheResult(key: string, result: any, ttl: number = 3600): Promise<void> {
    const cacheKey = `cache:${key}`;
    await redisUtils.set(cacheKey, JSON.stringify(result), ttl);
  },

  async getCachedResult<T>(key: string): Promise<T | null> {
    const cacheKey = `cache:${key}`;
    const cached = await redisUtils.get(cacheKey);
    return cached ? JSON.parse(cached) : null;
  },

  async invalidateCache(key: string): Promise<void> {
    const cacheKey = `cache:${key}`;
    await redisUtils.del(cacheKey);
  }
};

// OAuth and Authentication utilities for agents
export const agentAuth = {
  /**
   * Get user information from Redis backup storage
   */
  async getUserFromRedis(userId: string): Promise<any | null> {
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
  },

  /**
   * Check if a user's token is still valid
   */
  async isTokenValid(userId: string): Promise<boolean> {
    const user = await this.getUserFromRedis(userId);
    if (!user) return false;
    
    return Date.now() < user.expiresAt;
  },

  /**
   * Refresh user tokens if needed
   */
  async refreshUserTokens(userId: string): Promise<boolean> {
    try {
      const user = await this.getUserFromRedis(userId);
      if (!user || !user.refreshToken) return false;

      const yahooOAuth = new YahooOAuth();
      const newTokens = await yahooOAuth.refreshAccessToken(user.refreshToken);
      
      // Update tokens in Redis
      const userKey = `user:${userId}`;
      const expiresAt = Date.now() + (newTokens.expires_in * 1000);
      
      await redisUtils.hset(userKey, 'accessToken', newTokens.access_token);
      await redisUtils.hset(userKey, 'refreshToken', newTokens.refresh_token);
      await redisUtils.hset(userKey, 'expiresAt', expiresAt.toString());
      
      // Update token lookup
      const oldTokenKey = `token:${user.accessToken}`;
      const newTokenKey = `token:${newTokens.access_token}`;
      
      await redisUtils.del(oldTokenKey);
      await redisUtils.set(newTokenKey, userId, newTokens.expires_in);
      
      return true;
    } catch (error) {
      console.error('Failed to refresh tokens for user:', userId, error);
      return false;
    }
  },

  /**
   * Get user ID from access token
   */
  async getUserIdFromToken(accessToken: string): Promise<string | null> {
    const tokenKey = `token:${accessToken}`;
    return await redisUtils.get(tokenKey);
  },

  /**
   * Validate and get user from session (for server-side usage)
   */
  async getCurrentUser(): Promise<any | null> {
    try {
      const session = await getSession();
      return session.user || null;
    } catch (error) {
      console.error('Failed to get current user from session:', error);
      return null;
    }
  }
};

// Agent task management with user context
export class UserAgentTask {
  constructor(private userId: string, private agentId: string = 'default') {}

  async executeWithUserContext<T>(taskFn: (userData: any) => Promise<T>): Promise<T | null> {
    try {
      // Get user data from Redis
      const userData = await agentAuth.getUserFromRedis(this.userId);
      if (!userData) {
        throw new Error('User not found');
      }

      // Check if tokens are valid, refresh if needed
      if (!await agentAuth.isTokenValid(this.userId)) {
        const refreshed = await agentAuth.refreshUserTokens(this.userId);
        if (!refreshed) {
          throw new Error('Failed to refresh user tokens');
        }
        // Get updated user data
        const updatedUserData = await agentAuth.getUserFromRedis(this.userId);
        return await taskFn(updatedUserData);
      }

      return await taskFn(userData);
    } catch (error) {
      console.error('User agent task failed:', error);
      return null;
    }
  }

  async saveUserTask(taskName: string, result: any): Promise<void> {
    const state = new AgentState(`${this.agentId}:${this.userId}`);
    await state.saveState(`task:${taskName}`, {
      result,
      timestamp: Date.now()
    });
  }

  async getUserTaskHistory(taskName: string): Promise<any | null> {
    const state = new AgentState(`${this.agentId}:${this.userId}`);
    return await state.getState(`task:${taskName}`);
  }
}

// Enhanced agent task with authentication support
export async function authenticatedAgentTask(
  userId: string, 
  taskFn: (userData: any) => Promise<any>,
  agentId: string = 'default'
): Promise<any> {
  const userTask = new UserAgentTask(userId, agentId);
  return await userTask.executeWithUserContext(taskFn);
}

// Yahoo Fantasy API utilities for agents (defined early to avoid forward reference issues)
// 
// Caching Strategy:
// - Static: 24-48h TTL for data that never changes during season (game metadata, stat categories)
// - Semi-dynamic: 5-10min TTL for data that changes occasionally (leagues, teams, rosters)
// - Dynamic: No cache or very short TTL for real-time data (scoreboards, live stats, transactions)

// Cache category helper for consistent TTL values
export const CACHE_CATEGORIES = {
  STATIC: {
    ttl: 86400, // 24 hours
    ttlLong: 172800, // 48 hours  
    prefix: 'static',
    description: 'Data that never changes during season'
  },
  SEMI_DYNAMIC: {
    ttl: 300, // 5 minutes
    ttlMedium: 600, // 10 minutes
    ttlLong: 3600, // 1 hour
    prefix: 'semi-dynamic',
    description: 'Data that changes occasionally during season'
  },
  DYNAMIC: {
    ttl: 60, // 1 minute
    ttlShort: 30, // 30 seconds
    prefix: 'dynamic',
    description: 'Real-time data that changes frequently'
  }
} as const;

export const agentFantasy = {
    /**
   * Get current MLB game key and season info efficiently
   * Returns the active MLB fantasy season or the most recent one
   * Uses Static caching with 24-hour TTL (data rarely changes during season)
   */
  async getCurrentMLBGameKey(userId?: string): Promise<{ game_key: string; season: string; is_active: boolean }> {
    const cacheKey = `${CACHE_CATEGORIES.STATIC.prefix}:current_mlb_game`;
    
    // Try cache first (24 hour TTL - seasons don't change frequently)
    const cached = await agentCache.getCachedResult<{ game_key: string; season: string; is_active: boolean }>(cacheKey);
    if (cached) {
      console.log('🔄 Using cached MLB season:', cached);
      return cached;
    }
    
    const api = new YahooFantasyAPI(userId);
    const result = await api.getCurrentMLBSeason();
    
    console.log('🎯 Current MLB season:', result);
    
    // Cache for 24 hours (Static data - current season rarely changes)
    await agentCache.cacheResult(cacheKey, result, CACHE_CATEGORIES.STATIC.ttl);
    
    console.log('💾 Cached and returning result:', result);
    return result;
  },

  /**
   * Get fantasy leagues for a user with caching
   * Uses Semi-dynamic caching (5-minute TTL) - league list changes infrequently but may have updates
   */
  async getUserLeagues(userId: string, cacheKey?: string, ttl: number = CACHE_CATEGORIES.SEMI_DYNAMIC.ttl): Promise<any[]> {
    const key = cacheKey || `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:leagues:${userId}`;
    
    // Try cache first
    const cached = await agentCache.getCachedResult<any[]>(key);
    if (cached) return cached;
    
    // Fetch from API
    const api = new YahooFantasyAPI(userId);
    const leagues = await api.getUserLeagues();
    
    // Cache the result
    await agentCache.cacheResult(key, leagues, ttl);
    
    return leagues;
  },

  /**
   * Get league teams with caching
   * Uses Semi-dynamic caching (10-minute TTL) - team rosters and basic info change occasionally
   */
  async getLeagueTeams(userId: string, leagueKey: string, cacheKey?: string, ttl: number = CACHE_CATEGORIES.SEMI_DYNAMIC.ttlMedium): Promise<any[]> {
    const key = cacheKey || `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:teams:${leagueKey}`;
    
    // Try cache first
    const cached = await agentCache.getCachedResult<any[]>(key);
    if (cached) return cached;
    
    // Fetch from API
    const api = new YahooFantasyAPI(userId);
    const teams = await api.getLeagueTeams(leagueKey);
    
    // Cache the result
    await agentCache.cacheResult(key, teams, ttl);
    
    return teams;
  },

  /**
   * Get stat categories for a game with caching
   * Uses Static caching (48-hour TTL) - stat categories never change during a season
   */
  async getStatCategories(gameKey: string, userId?: string): Promise<any[]> {
    const key = `${CACHE_CATEGORIES.STATIC.prefix}:stat_categories:${gameKey}`;
    
    // Try cache first
    const cached = await agentCache.getCachedResult<any[]>(key);
    if (cached) return cached;
    
    // Fetch from API - use system user or provided userId
    const api = new YahooFantasyAPI(userId);
    const categories = await api.getStatCategories(gameKey);
    
    // Cache the result for 48 hours (Static data - never changes during season)
    await agentCache.cacheResult(key, categories, CACHE_CATEGORIES.STATIC.ttlLong);
    
    return categories;
  },

  /**
   * Get stat category map for quick lookups
   * Uses Static caching (48-hour TTL) - stat categories never change during a season
   */
  async getStatCategoryMap(gameKey: string, userId?: string): Promise<Record<number, any>> {
    const key = `${CACHE_CATEGORIES.STATIC.prefix}:stat_category_map:${gameKey}`;
    
    // Try cache first
    const cached = await agentCache.getCachedResult<Record<number, any>>(key);
    if (cached) return cached;
    
    // Get categories and build map
    const categories = await this.getStatCategories(gameKey, userId);
    const map = YahooFantasyAPI.buildStatCategoryMap(categories);
    
    // Cache the map for 48 hours (Static data - never changes during season)
    await agentCache.cacheResult(key, map, CACHE_CATEGORIES.STATIC.ttlLong);
    
    return map;
  },

  /**
   * Check fantasy API health for a user
   */
  async checkUserFantasyAccess(userId: string): Promise<{ hasAccess: boolean; error?: string }> {
    try {
      const api = new YahooFantasyAPI(userId);
      const health = await api.healthCheck();
      
      return {
        hasAccess: health.tokenValid && health.status === 'healthy'
      };
    } catch (error) {
      return {
        hasAccess: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  },

  /**
   * Execute fantasy-related agent tasks with proper authentication
   */
  async executeFantasyTask<T>(
    userId: string, 
    taskFn: (api: YahooFantasyAPI) => Promise<T>
  ): Promise<T | null> {
    try {
      // Ensure user has valid tokens
      if (!await agentAuth.isTokenValid(userId)) {
        const refreshed = await agentAuth.refreshUserTokens(userId);
        if (!refreshed) {
          throw new Error('Failed to refresh user tokens for fantasy access');
        }
      }

      const api = new YahooFantasyAPI(userId);
      return await taskFn(api);
    } catch (error) {
      console.error('Fantasy agent task failed:', error);
      return null;
    }
  },

  /**
   * Enrich player/team stats with category metadata
   * @param gameKey - The game key (e.g., "458" for MLB 2025)
   * @param stats - Array of stat objects with stat_id and value
   * @param userId - Optional user ID for authentication (only needed if not cached)
   * @returns Array of enriched stats with category metadata
   */
  async enrichStats<T extends { stat_id: string | number; value: string | number }>(
    gameKey: string,
    stats: T[],
    userId?: string
  ): Promise<Array<T & {
    stat_id: number;
    name: string;
    display_name: string;
    position_types: string[];
    is_pitcher_stat: boolean;
    is_batter_stat: boolean;
    sort_order?: string;
  }>> {
    try {
      // Get the stat category map (uses caching)
      const categoryMap = await this.getStatCategoryMap(gameKey, userId);
      
      // Enrich each stat with category metadata
      return stats.map(stat => {
        const statId = Number(stat.stat_id);
        const category = categoryMap[statId];
        
        return {
          ...stat,
          stat_id: statId,
          name: category?.name || 'Unknown',
          display_name: category?.display_name || '??',
          position_types: category?.position_types || [],
          is_pitcher_stat: (category?.position_types || []).includes('P'),
          is_batter_stat: (category?.position_types || []).includes('B'),
          sort_order: category?.sort_order,
        };
      });
    } catch (error) {
      console.error('Failed to enrich stats:', error);
      throw new Error(`Failed to enrich stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
};

// Fantasy league analysis agent task
export async function analyzeUserFantasyLeagues(userId: string, gameKeys?: string[]): Promise<any> {
  return await agentFantasy.executeFantasyTask(userId, async (api) => {
    // Get user's leagues, optionally filtered by specific game keys for efficiency
    const leagues = await api.getUserLeagues(gameKeys);
    
    if (leagues.length === 0) {
      return { 
        status: 'no_leagues',
        message: gameKeys ? `User has no leagues for game keys: ${gameKeys.join(', ')}` : 'User has no active fantasy leagues'
      };
    }

    // Log efficiency improvement when filtering is used
    if (gameKeys && gameKeys.length > 0) {
      console.log(`🚀 EFFICIENCY: Loading only leagues for game keys [${gameKeys.join(', ')}] instead of all leagues`);
    }

    // Analyze each league with individual error handling and rate limiting
    const analysis = await Promise.all(leagues.map(async (league, index) => {
      // Add small delay to prevent rate limiting and token conflicts
      if (index > 0) {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
      }
      try {
        const teams = await api.getLeagueTeams(league.league_key);
        // Identify the user's own team. Yahoo provides two indicators:
        // 1. `team.is_owned_by_current_login` flag at team level
        // 2. A manager object inside `team.managers` where `is_current_login === 1`.
        const userTeam = teams.find(team => {
          const ownedFlag = team.is_owned_by_current_login !== undefined && String(team.is_owned_by_current_login) === '1';
          const managerFlag = team.managers && team.managers.some(m => String(m.is_current_login) === '1');
          return ownedFlag || managerFlag;
        });
        
        return {
          league_key: league.league_key,
          league_name: league.name,
          league_type: league.league_type,
          scoring_type: league.scoring_type,
          total_teams: teams.length,
          user_team: userTeam ? {
            team_key: userTeam.team_key,
            team_name: userTeam.name,
            waiver_priority: userTeam.waiver_priority,
          } : null,
          draft_status: league.draft_status,
          current_week: league.current_week,
          is_finished: league.is_finished,
          // Debug information
          debug_teams_raw: teams.map(team => ({
            team_key: team.team_key,
            team_name: team.name,
            managers: team.managers,
            has_current_user: team.managers && team.managers.some(manager => 
              String(manager.is_current_login) === '1'
            )
          })),
          debug_teams_count: teams.length,
          debug_user_team_search: teams.filter(team => {
            const ownedFlag = team.is_owned_by_current_login !== undefined && String(team.is_owned_by_current_login) === '1';
            const managerFlag = team.managers && team.managers.some(manager => String(manager.is_current_login) === '1');
            return ownedFlag || managerFlag;
          })
        };
      } catch (error) {
        console.error(`Failed to get teams for league ${league.league_key}:`, error);
        
        // Handle authentication errors more gracefully
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const isAuthError = errorMessage.includes('Authentication failed') || errorMessage.includes('Access forbidden');
        
        return {
          league_key: league.league_key,
          league_name: league.name,
          league_type: league.league_type,
          scoring_type: league.scoring_type,
          total_teams: 0,
          user_team: null,
          draft_status: league.draft_status,
          current_week: league.current_week,
          is_finished: league.is_finished,
          error: isAuthError ? 'Access denied - may no longer be a member of this league' : errorMessage,
          debug_teams_raw: [],
          debug_teams_count: 0,
          debug_user_team_search: []
        };
      }
    }));

    // Generate summary statistics
    const summary = {
      total_leagues: leagues.length,
      active_leagues: analysis.filter(l => !l.error && l.is_finished === 0).length,
      finished_leagues: analysis.filter(l => !l.error && l.is_finished === 1).length,
      leagues_with_teams: analysis.filter(l => !l.error && l.user_team).length,
      sport_breakdown: leagues.reduce((acc, league) => {
        // Extract sport from league key (e.g., "414" for NFL)
        const gameKey = league.league_key.split('.')[0];
        acc[gameKey] = (acc[gameKey] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    };

    return {
      status: 'success',
      summary,
      leagues: analysis,
      timestamp: Date.now()
    };
  });
}

// Get user's best performing teams across leagues
export async function getUserTopTeams(userId: string): Promise<any> {
  return await agentFantasy.executeFantasyTask(userId, async (api) => {
    const leagues = await api.getUserLeagues();
    const topTeams = [];

    for (const league of leagues) {
      try {
        const teams = await api.getLeagueTeams(league.league_key);
        // Identify the user's own team. Yahoo provides two indicators:
        // 1. `team.is_owned_by_current_login` flag at team level
        // 2. A manager object inside `team.managers` where `is_current_login === 1`.
        const userTeam = teams.find(team => {
          const ownedFlag = team.is_owned_by_current_login !== undefined && String(team.is_owned_by_current_login) === '1';
          const managerFlag = team.managers && team.managers.some(m => String(m.is_current_login) === '1');
          return ownedFlag || managerFlag;
        });
        
        if (userTeam) {
          topTeams.push({
            league_name: league.name,
            league_key: league.league_key,
            team_name: userTeam.name,
            team_key: userTeam.team_key,
            waiver_priority: userTeam.waiver_priority,
            // Lower waiver priority often indicates better performance
            estimated_rank: userTeam.waiver_priority || teams.length,
            league_size: teams.length
          });
        }
      } catch (error) {
        console.error('Failed to get teams for league:', league.league_key, error);
      }
    }

    // Sort by estimated performance (lower waiver priority = better)
    topTeams.sort((a, b) => (a.estimated_rank || 999) - (b.estimated_rank || 999));

    return {
      status: 'success',
      top_teams: topTeams.slice(0, 5), // Top 5 teams
      total_teams: topTeams.length,
      timestamp: Date.now()
    };
  });
}

// Example agent task with Redis integration
export async function exampleAgentTask(agentId: string = 'default'): Promise<string> {
  const state = new AgentState(agentId);
  
  // Check if task has been executed recently
  const lastExecution = await state.getState<number>('lastExecution');
  const now = Date.now();
  
  if (lastExecution && (now - lastExecution) < 60000) { // 1 minute cooldown
    return 'Agent task executed recently. Skipping execution.';
  }
  
  // Save execution timestamp
  await state.saveState('lastExecution', now);
  
  // Example: Cache expensive operation result
  const cacheKey = `expensive-operation-${agentId}`;
  let result = await agentCache.getCachedResult<string>(cacheKey);
  
  if (!result) {
    // Simulate expensive operation
    result = `Expensive operation completed at ${new Date().toISOString()}`;
    await agentCache.cacheResult(cacheKey, result, 300); // Cache for 5 minutes
  }
  
  return `Agent task executed. ${result}`;
}

// Example authenticated agent task
export async function exampleUserTask(userId: string): Promise<string> {
  return await authenticatedAgentTask(userId, async (userData) => {
    // Example task that uses user data
    const taskResult = `Task executed for user: ${userData.name} (${userData.email}) at ${new Date().toISOString()}`;
    
    // Cache the result for this user
    await agentCache.cacheResult(`user-task-${userId}`, taskResult, 600);
    
    return taskResult;
  });
}

// Agent health check with authentication system status
export async function agentHealthCheck(): Promise<{ 
  status: string; 
  redis: string; 
  oauth: string;
  fantasy: string;
  sessionCount: number;
}> {
  try {
    const pingResult = await redisUtils.ping();
    
    // Check OAuth system health
    let oauthStatus = 'healthy';
    try {
      const yahooOAuth = new YahooOAuth();
      // OAuth client initializes successfully if credentials are present
      oauthStatus = 'configured';
    } catch (error) {
      oauthStatus = 'misconfigured';
    }
    
    // Check Fantasy API health
    let fantasyStatus = 'healthy';
    try {
      // Test with a dummy user if available
      const userKeys = await redis.keys('user:*');
      if (userKeys.length > 0) {
        const userId = await redisUtils.hget(userKeys[0], 'id');
        if (userId) {
          const fantasyCheck = await agentFantasy.checkUserFantasyAccess(userId);
          fantasyStatus = fantasyCheck.hasAccess ? 'accessible' : 'no_access';
        } else {
          fantasyStatus = 'no_users';
        }
      } else {
        fantasyStatus = 'no_users';
      }
    } catch (error) {
      fantasyStatus = 'error';
    }
    
    // Count active sessions (approximation by counting user keys)
    const userKeys = await redis.keys('user:*');
    const sessionCount = userKeys.length;
    
    return {
      status: 'healthy',
      redis: pingResult === 'PONG' ? 'connected' : 'disconnected',
      oauth: oauthStatus,
      fantasy: fantasyStatus,
      sessionCount
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      redis: 'error',
      oauth: 'unknown',
      fantasy: 'unknown',
      sessionCount: 0
    };
  }
}

// OAuth state management for agents
export const agentOAuth = {
  /**
   * Generate and store OAuth state for agent-initiated auth flows
   */
  async generateAgentOAuthState(agentId: string, purpose: string): Promise<string> {
    const state = `agent:${agentId}:${purpose}:${Date.now()}:${Math.random().toString(36).substring(2)}`;
    const stateKey = `oauth_state:${state}`;
    await redisUtils.set(stateKey, JSON.stringify({ agentId, purpose }), 600); // 10 minutes
    return state;
  },

  /**
   * Validate and retrieve agent OAuth state
   */
  async validateAgentOAuthState(state: string): Promise<{ agentId: string; purpose: string } | null> {
    const stateKey = `oauth_state:${state}`;
    const stateData = await redisUtils.get(stateKey);
    
    if (!stateData) return null;
    
    // Remove used state
    await redisUtils.del(stateKey);
    
    try {
      return JSON.parse(stateData);
    } catch {
      return null;
    }
  }
};

// -------------------------------------------------------------------
// Dashboard data helpers (stubs)
// -------------------------------------------------------------------
/**
 * Lightweight wrappers around Yahoo Fantasy API calls used by dashboard cards.
 * These are currently stub implementations that return placeholder data.
 * Replace the TODO blocks with real data fetching logic as integration progresses.
 */
export const dashboardAgent = {
  /** Get summary of the current scoring-period matchup for the specified team */
  async getCurrentMatchup(userId: string, teamKey: string): Promise<any> {
    return await agentFantasy.executeFantasyTask(userId, async (api) => {
      // TODO: call api.getTeamMatchup(teamKey) once implemented
      return { teamKey, opponent: 'stub-opponent', score: { you: 0, them: 0 } };
    });
  },

  /** Aggregate team stats (season or week) */
  async getTeamStats(
    userId: string,
    teamKey: string,
    span: 'season' | 'week' = 'season'
  ): Promise<any> {
    return await agentFantasy.executeFantasyTask(userId, async (api) => {
      // TODO: implement via api.getTeamStats(teamKey, span)
      return { teamKey, span, stats: [] };
    });
  },

  /** Identify lineup issues such as injured or bench-starting players */
  async getLineupIssues(userId: string, teamKey: string): Promise<any[]> {
    const issues = await agentFantasy.executeFantasyTask(userId, async (api) => {
      // TODO: analyse roster and return issues list
      return [];
    });
    return issues || [];
  },

  /** Waiver priority, active claims, and trending pickups */
  async getWaiverWire(userId: string, teamKey: string): Promise<any> {
    return await agentFantasy.executeFantasyTask(userId, async (api) => {
      // TODO: implement via transactions & waiver API calls
      return { priority: null, claims: [], hotAdds: [] };
    });
  },

  /** Latest news affecting players on the roster */
  async getPlayerNews(userId: string, teamKey: string): Promise<any[]> {
    const news = await agentFantasy.executeFantasyTask(userId, async (api) => {
      // TODO: fetch news feed for rostered players
      return [];
    });
    return news || [];
  },

  /** Preview information for the next scoring period */
  async getNextWeekPreview(userId: string, teamKey: string): Promise<any> {
    return await agentFantasy.executeFantasyTask(userId, async (api) => {
      // TODO: compute projected games played, opponent, etc.
      return { period: 'next', teamKey };
    });
  },

  /** Recent transactions and activity log */
  async getRecentActivity(userId: string, teamKey: string): Promise<any[]> {
    const activity = await agentFantasy.executeFantasyTask(userId, async (api) => {
      // TODO: fetch recent transactions
      return [];
    });
    return activity || [];
  },
};

// ------------------------------------------------------------------- 