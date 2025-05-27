/**
 * Data Facade - Central entry point for all data operations (Server-side only)
 * 
 * This facade provides high-level functions that:
 * - Combine data from multiple sources (Yahoo, ESPN, future sources)
 * - Handle caching of combined results with appropriate strategies
 * - Provide error handling and fallbacks
 * - Return consistent, UI-ready data structures
 * 
 * Cache Strategy:
 * - Static (24h): Cache first, allow stale
 * - Daily (12h): Cache first, allow stale  
 * - Realtime (15m): API first, cache as fallback
 */

import { yahooServices } from '../services/yahoo';
import { getEspnScoreboard, checkTeamGameFromEspn } from '../utils/espn-api';
import { getCachedData, setCachedData, generateCacheKey } from '../lib/server/cache';
import type { 
  YahooLeague, 
  YahooTeam, 
  YahooPlayer,
  YahooMatchup,
  YahooScoreboard,
  YahooLeagueStandings
} from '../types/yahoo';
import type { EspnScoreboard } from '../types/espn';

// ==========================================
// Dashboard Data
// ==========================================

/**
 * Dashboard data structure containing all information needed for the main dashboard view
 */
export interface DashboardData {
  /** League information including settings and scoring */
  league: YahooLeague;
  /** Current user's team information */
  userTeam: YahooTeam;
  /** Current league standings */
  standings: YahooLeagueStandings;
  /** Current week's matchup if available */
  currentMatchup: YahooMatchup | null;
  /** Recent league transactions */
  recentTransactions: any[];
  /** Today's MLB games from multiple sources */
  todaysGames: {
    yahooGames: any[];
    espnGames: any[];
  };
  /** ISO timestamp of when this data was generated */
  lastUpdated: string;
}

/**
 * Get all data needed for the dashboard view
 * Combines league info, team info, standings, and current matchup
 * 
 * @returns {Promise<DashboardData>} Combined dashboard data
 * @throws {Error} Only throws if no data can be retrieved at all
 * 
 * @example
 * ```typescript
 * const dashboardData = await getDashboardData();
 * console.log(dashboardData.userTeam.name);
 * console.log(dashboardData.standings.teams.team[0].name);
 * ```
 */
export async function getDashboardData(): Promise<DashboardData> {
  const cacheKey = generateCacheKey('facade:dashboard', {}, 'daily');
  
  // Daily data: Try cache first
  const cached = await getCachedData<DashboardData>(cacheKey, { 
    category: 'daily',
    allowStale: true 
  });
  
  if (cached) {
    console.log('Data Facade: Using cached dashboard data');
    return cached;
  }
  
  console.log('Data Facade: Building fresh dashboard data');
  
  try {
    // Fetch all data in parallel for better performance
    const [league, userTeam, espnScoreboard] = await Promise.all([
      yahooServices.league.getLeague(),
      yahooServices.team.getTeam(),
      getEspnScoreboard().catch(err => {
        console.warn('Data Facade: ESPN scoreboard fetch failed, continuing without it', err);
        return null;
      })
    ]);
    
    // Extract standings from league data
    const standings = league.standings || { teams: { team: [] } };
    
    // Get current matchup from scoreboard
    let currentMatchup: YahooMatchup | null = null;
    if (league.scoreboard?.matchups?.matchup) {
      currentMatchup = league.scoreboard.matchups.matchup.find((m: YahooMatchup) => 
        m.teams.team.some((t: YahooTeam) => t.team_key === userTeam.team_key)
      ) || null;
    }
    
    // Get recent transactions (if available)
    const recentTransactions = league.transactions?.slice(0, 5) || [];
    
    // Combine game data from multiple sources
    const todaysGames = {
      yahooGames: [], // TODO: Add Yahoo game data when available
      espnGames: espnScoreboard?.events || []
    };
    
    const dashboardData: DashboardData = {
      league,
      userTeam,
      standings,
      currentMatchup,
      recentTransactions,
      todaysGames,
      lastUpdated: new Date().toISOString()
    };
    
    // Cache the combined result
    await setCachedData(cacheKey, dashboardData, { 
      category: 'daily',
      ttl: 12 * 60 * 60 // 12 hours
    });
    
    return dashboardData;
  } catch (error) {
    console.error('Data Facade: Error building dashboard data', error);
    
    // Try to return partial data if possible
    const fallbackData: DashboardData = {
      league: {} as YahooLeague,
      userTeam: {} as YahooTeam,
      standings: { teams: { team: [] } },
      currentMatchup: null,
      recentTransactions: [],
      todaysGames: { yahooGames: [], espnGames: [] },
      lastUpdated: new Date().toISOString()
    };
    
    // Try to get at least some data
    try {
      fallbackData.league = await yahooServices.league.getLeague();
      fallbackData.userTeam = await yahooServices.team.getTeam();
    } catch (e) {
      console.error('Data Facade: Failed to get even basic data', e);
    }
    
    return fallbackData;
  }
}

// ==========================================
// Matchup Data
// ==========================================

/**
 * Detailed matchup data for head-to-head comparisons
 */
export interface MatchupData {
  /** The matchup details including scores */
  matchup: YahooMatchup;
  /** User's team information */
  userTeam: YahooTeam;
  /** Opponent's team information */
  opponentTeam: YahooTeam;
  /** User's roster for this matchup */
  userRoster: YahooPlayer[];
  /** Opponent's roster for this matchup */
  opponentRoster: YahooPlayer[];
  /** League scoring categories */
  scoringCategories: any[];
  /** Week number for this matchup */
  week: number;
  /** Whether this is the current week */
  isCurrentWeek: boolean;
  /** ISO timestamp of when this data was generated */
  lastUpdated: string;
}

/**
 * Get detailed matchup data for a specific week
 * Includes rosters, stats, and scoring information
 * 
 * @param {number} [week] - Week number (omit for current week)
 * @returns {Promise<MatchupData | null>} Matchup data or null if no matchup found
 * 
 * @example
 * ```typescript
 * // Get current week matchup
 * const currentMatchup = await getMatchupData();
 * 
 * // Get specific week matchup
 * const week5Matchup = await getMatchupData(5);
 * ```
 */
export async function getMatchupData(week?: number): Promise<MatchupData | null> {
  const weekStr = week?.toString() || 'current';
  const isCurrentWeek = !week; // If no week specified, it's current
  const category = isCurrentWeek ? 'realtime' : 'daily';
  const cacheKey = generateCacheKey('facade:matchup', { week: weekStr }, category);
  
  // For realtime data: Try API first, cache as fallback
  // For historical data: Try cache first
  if (isCurrentWeek) {
    console.log(`Data Facade: Building fresh matchup data for current week (realtime)`);
    
    try {
      const matchupData = await buildMatchupData(week);
      
      if (matchupData) {
        // Cache the result for fallback
        await setCachedData(cacheKey, matchupData, { 
          category: 'realtime',
          ttl: 15 * 60 // 15 minutes
        });
      }
      
      return matchupData;
    } catch (error) {
      console.error('Data Facade: Error fetching fresh matchup data, trying cache', error);
      
      // Fall back to cache for realtime data
      const cached = await getCachedData<MatchupData>(cacheKey, { 
        category: 'realtime',
        allowStale: true // Allow stale as fallback
      });
      
      if (cached) {
        console.log('Data Facade: Using cached matchup data as fallback');
        return cached;
      }
      
      throw error;
    }
  } else {
    // Historical data: cache first
    const cached = await getCachedData<MatchupData>(cacheKey, { 
      category: 'daily',
      allowStale: true
    });
    
    if (cached) {
      console.log(`Data Facade: Using cached matchup data for week ${weekStr}`);
      return cached;
    }
    
    const matchupData = await buildMatchupData(week);
    
    if (matchupData) {
      await setCachedData(cacheKey, matchupData, { 
        category: 'daily',
        ttl: 12 * 60 * 60 // 12 hours for historical
      });
    }
    
    return matchupData;
  }
}

/**
 * Internal function to build matchup data
 */
async function buildMatchupData(week?: number): Promise<MatchupData | null> {
  // Get league and team info first
  const [league, userTeam] = await Promise.all([
    yahooServices.league.getLeague(),
    yahooServices.team.getTeam()
  ]);
  
  const currentWeek = league.current_week;
  const targetWeek = week || currentWeek;
  const isCurrentWeek = targetWeek === currentWeek;
  
  // Get scoreboard for the specified week
  const scoreboard = await yahooServices.league.getLeagueScoreboard(undefined, targetWeek);
  const matchups = scoreboard.matchups?.matchup || [];
  const userMatchup = matchups.find((m: YahooMatchup) => 
    m.teams.team.some((t: YahooTeam) => t.team_key === userTeam.team_key)
  );
  
  if (!userMatchup) {
    console.warn(`Data Facade: No matchup found for week ${targetWeek}`);
    return null;
  }
  
  // Find opponent team
  const opponentTeam = userMatchup.teams.team.find((t: YahooTeam) => 
    t.team_key !== userTeam.team_key
  );
  
  if (!opponentTeam) {
    console.warn('Data Facade: No opponent found in matchup');
    return null;
  }
  
  // Get rosters for both teams
  const [userRoster, opponentRoster] = await Promise.all([
    yahooServices.team.getTeamRoster(userTeam.team_key).then(team => team.roster?.players || []),
    yahooServices.team.getTeamRoster(opponentTeam.team_key).then(team => team.roster?.players || [])
  ]);
  
  // Get scoring categories from league settings
  const scoringCategories = league.stat_categories?.stats?.stat || [];
  
  return {
    matchup: userMatchup,
    userTeam,
    opponentTeam,
    userRoster,
    opponentRoster,
    scoringCategories,
    week: targetWeek,
    isCurrentWeek,
    lastUpdated: new Date().toISOString()
  };
}

// ==========================================
// Team/Roster Data
// ==========================================

/**
 * Comprehensive team data including roster and performance information
 */
export interface TeamData {
  /** Team information */
  team: YahooTeam;
  /** Basic roster from Yahoo */
  roster: YahooPlayer[];
  /** Roster with additional game and performance data */
  enrichedRoster: EnrichedPlayer[];
  /** Team statistics */
  teamStats: any;
  /** Team standings information */
  standings: any;
  /** Team's season schedule */
  schedule: YahooMatchup[];
  /** Team transactions */
  transactions: any[];
  /** ISO timestamp of when this data was generated */
  lastUpdated: string;
}

/**
 * Enhanced player data with game information and performance metrics
 */
export interface EnrichedPlayer extends YahooPlayer {
  /** Whether the player has a game today */
  hasGameToday: boolean;
  /** Game start time if available */
  gameStartTime: string | null;
  /** Whether the player is in the starting lineup */
  isStartingToday: boolean;
  /** Whether the player is a probable pitcher */
  isProbablePitcher: boolean;
  /** ESPN game information if used as fallback */
  espnGameInfo?: any;
  /** Player's recent performance rating */
  performanceRating?: 'hot' | 'cold' | 'normal';
}

/**
 * Get comprehensive team data including roster with enriched player info
 * 
 * @param {string} [teamKey] - Yahoo team key (omit for user's team)
 * @returns {Promise<TeamData>} Complete team data with enriched roster
 * 
 * @example
 * ```typescript
 * // Get user's team
 * const myTeam = await getTeamData();
 * 
 * // Get specific team
 * const otherTeam = await getTeamData('mlb.l.12345.t.6');
 * 
 * // Check for players with games today
 * const playersWithGames = myTeam.enrichedRoster.filter(p => p.hasGameToday);
 * ```
 */
export async function getTeamData(teamKey?: string): Promise<TeamData> {
  const cacheKey = generateCacheKey('facade:team', { teamKey: teamKey || 'user' }, 'daily');
  
  // Daily data: Try cache first
  const cached = await getCachedData<TeamData>(cacheKey, { 
    category: 'daily',
    allowStale: true 
  });
  
  if (cached) {
    console.log('Data Facade: Using cached team data');
    return cached;
  }
  
  console.log('Data Facade: Building fresh team data');
  
  try {
    // Get team (user's team if no key specified)
    const team = await yahooServices.team.getTeam(teamKey);
    
    // Get full roster
    const rosterTeam = await yahooServices.team.getTeamRoster(team.team_key);
    const roster = rosterTeam.roster?.players || [];
    
    // Get ESPN data for game enrichment
    const espnScoreboard = await getEspnScoreboard().catch(() => null);
    
    // Enrich roster with game info and performance data
    const enrichedRoster = await Promise.all(
      roster.map(async (player) => {
        const enriched: EnrichedPlayer = {
          ...player,
          hasGameToday: false,
          gameStartTime: null,
          isStartingToday: false,
          isProbablePitcher: false
        };
        
        // Check for game info from Yahoo
        try {
          const gameInfo = await yahooServices.player.getPlayerGameInfo(player.player_key);
          enriched.hasGameToday = gameInfo.game_status === 'scheduled';
          enriched.gameStartTime = gameInfo.game_start_time;
        } catch (e) {
          console.warn(`Data Facade: Failed to get game info for ${player.name.full}`, e);
        }
        
        // Fallback to ESPN data if needed
        if (!enriched.hasGameToday && player.editorial_team_abbr && espnScoreboard) {
          const espnGameInfo = await checkTeamGameFromEspn(player.editorial_team_abbr);
          enriched.hasGameToday = espnGameInfo.has_game_today;
          enriched.gameStartTime = espnGameInfo.game_start_time;
          enriched.espnGameInfo = espnGameInfo;
        }
        
        // TODO: Add logic for probable pitchers
        // TODO: Add logic for starting lineups
        // TODO: Add performance ratings (hot/cold streaks)
        
        return enriched;
      })
    );
    
    // Get additional team data
    const [teamStats, standings, schedule, transactions] = await Promise.all([
      team.team_stats || {},
      team.team_standings || {},
      yahooServices.team.getTeamMatchups(team.team_key).catch(() => []),
      [] // TODO: Get team transactions when available
    ]);
    
    const teamData: TeamData = {
      team,
      roster,
      enrichedRoster,
      teamStats,
      standings,
      schedule,
      transactions,
      lastUpdated: new Date().toISOString()
    };
    
    // Cache the result
    await setCachedData(cacheKey, teamData, { 
      category: 'daily',
      ttl: 6 * 60 * 60 // 6 hours
    });
    
    return teamData;
  } catch (error) {
    console.error('Data Facade: Error building team data', error);
    throw error;
  }
}

// ==========================================
// Player Data
// ==========================================

/**
 * Detailed player information including stats, news, and schedule
 */
export interface PlayerDetailData {
  /** Player information */
  player: YahooPlayer;
  /** Season statistics */
  seasonStats: any;
  /** Recent performance statistics */
  recentStats: any;
  /** Game-by-game log */
  gameLog: any[];
  /** Player news and updates */
  news: any[];
  /** Ownership information across leagues */
  ownership: any;
  /** Upcoming schedule */
  schedule: any[];
  /** ISO timestamp of when this data was generated */
  lastUpdated: string;
}

/**
 * Get detailed player information including stats, news, and schedule
 * 
 * @param {string} playerKey - Yahoo player key
 * @returns {Promise<PlayerDetailData>} Complete player information
 * 
 * @example
 * ```typescript
 * const player = await getPlayerData('mlb.p.12345');
 * console.log(player.seasonStats);
 * console.log(player.recentStats);
 * ```
 */
export async function getPlayerData(playerKey: string): Promise<PlayerDetailData> {
  const cacheKey = generateCacheKey('facade:player', { playerKey }, 'daily');
  
  // Daily data: Try cache first
  const cached = await getCachedData<PlayerDetailData>(cacheKey, { 
    category: 'daily',
    allowStale: true 
  });
  
  if (cached) {
    console.log('Data Facade: Using cached player data');
    return cached;
  }
  
  console.log('Data Facade: Building fresh player data');
  
  try {
    // Get base player info
    const player = await yahooServices.player.getPlayer(playerKey);
    
    // Get various stats in parallel
    const [seasonStats, recentStats] = await Promise.all([
      yahooServices.player.getPlayerStats(playerKey, 'season'),
      yahooServices.player.getPlayerStats(playerKey, 'lastweek')
    ]);
    
    // TODO: Add game log from additional data source
    // TODO: Add news from additional data source
    // TODO: Add schedule from additional data source
    const gameLog: any[] = [];
    const news: any[] = [];
    const schedule: any[] = [];
    
    const playerData: PlayerDetailData = {
      player,
      seasonStats,
      recentStats,
      gameLog,
      news,
      ownership: player.ownership || {},
      schedule,
      lastUpdated: new Date().toISOString()
    };
    
    // Cache the result
    await setCachedData(cacheKey, playerData, { 
      category: 'daily',
      ttl: 6 * 60 * 60 // 6 hours
    });
    
    return playerData;
  } catch (error) {
    console.error('Data Facade: Error building player data', error);
    throw error;
  }
}

// ==========================================
// League-wide Data
// ==========================================

/**
 * League-wide overview data for league summary pages
 */
export interface LeagueOverviewData {
  /** League information */
  league: YahooLeague;
  /** All teams in the league */
  allTeams: YahooTeam[];
  /** Current standings */
  standings: YahooLeagueStandings;
  /** Current week's matchups */
  currentWeekMatchups: YahooMatchup[];
  /** Top performing players across the league */
  topPerformers: YahooPlayer[];
  /** Recent league transactions */
  recentTransactions: any[];
  /** ISO timestamp of when this data was generated */
  lastUpdated: string;
}

/**
 * Get comprehensive league overview data
 * 
 * @returns {Promise<LeagueOverviewData>} Complete league information
 * 
 * @example
 * ```typescript
 * const leagueData = await getLeagueOverviewData();
 * console.log(`${leagueData.league.name} - Week ${leagueData.league.current_week}`);
 * console.log(`Teams: ${leagueData.allTeams.length}`);
 * ```
 */
export async function getLeagueOverviewData(): Promise<LeagueOverviewData> {
  const cacheKey = generateCacheKey('facade:league-overview', {}, 'daily');
  
  // Daily data: Try cache first
  const cached = await getCachedData<LeagueOverviewData>(cacheKey, { 
    category: 'daily',
    allowStale: true 
  });
  
  if (cached) {
    console.log('Data Facade: Using cached league overview data');
    return cached;
  }
  
  console.log('Data Facade: Building fresh league overview data');
  
  try {
    // Get base league data
    const league = await yahooServices.league.getLeague();
    
    // Get all teams with their stats
    const allTeams = league.teams || [];
    const standings = league.standings || { teams: { team: [] } };
    
    // Get current week matchups
    const currentWeekMatchups = league.scoreboard?.matchups?.matchup || [];
    
    // TODO: Get top performers across the league
    const topPerformers: YahooPlayer[] = [];
    
    // Get recent transactions
    const recentTransactions = league.transactions?.slice(0, 10) || [];
    
    const leagueData: LeagueOverviewData = {
      league,
      allTeams,
      standings,
      currentWeekMatchups,
      topPerformers,
      recentTransactions,
      lastUpdated: new Date().toISOString()
    };
    
    // Cache the result
    await setCachedData(cacheKey, leagueData, { 
      category: 'daily',
      ttl: 12 * 60 * 60 // 12 hours
    });
    
    return leagueData;
  } catch (error) {
    console.error('Data Facade: Error building league overview data', error);
    throw error;
  }
}

// ==========================================
// Export all facade functions
// ==========================================

/**
 * Data facade object containing all data access functions
 * 
 * @example
 * ```typescript
 * import { dataFacade } from '@/app/data';
 * 
 * // Use individual functions
 * const dashboard = await dataFacade.getDashboardData();
 * const matchup = await dataFacade.getMatchupData();
 * ```
 */
export const dataFacade = {
  getDashboardData,
  getMatchupData,
  getTeamData,
  getPlayerData,
  getLeagueOverviewData
};

export default dataFacade; 