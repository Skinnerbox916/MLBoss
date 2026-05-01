import { YahooFantasyAPI, League, Team } from '@/lib/yahoo-fantasy-api';
import { withCache, CACHE_CATEGORIES } from './cache';

// ---------------------------------------------------------------------------
// Result types — discriminated union so consumers can handle failures
// ---------------------------------------------------------------------------

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// League analysis types
// ---------------------------------------------------------------------------

export interface LeagueAnalysisSummary {
  total_leagues: number;
  active_leagues: number;
  finished_leagues: number;
  leagues_with_teams: number;
  sport_breakdown: Record<string, number>;
}

export interface LeagueAnalysisEntry {
  league_key: string;
  league_name: string;
  league_type: string;
  scoring_type: string;
  total_teams: number;
  user_team: {
    team_key: string;
    team_name: string;
    waiver_priority?: number;
  } | null;
  draft_status: string;
  current_week?: string;
  is_finished?: number;
  error?: string;
}

export interface LeagueAnalysis {
  status: 'success' | 'no_leagues';
  message?: string;
  summary?: LeagueAnalysisSummary;
  leagues?: LeagueAnalysisEntry[];
  timestamp?: number;
}

// ---------------------------------------------------------------------------
// Helper — find the user's own team from a list of teams
// ---------------------------------------------------------------------------

function findUserTeam(teams: Team[]): Team | undefined {
  return teams.find(team => {
    const ownedFlag = team.is_owned_by_current_login !== undefined
      && String(team.is_owned_by_current_login) === '1';
    const managerFlag = team.managers?.some(m => String(m.is_current_login) === '1');
    return ownedFlag || managerFlag;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get current MLB game key and season info.
 * Uses Static caching with 24-hour TTL (data rarely changes during season).
 */
export async function getCurrentMLBGameKey(userId?: string): Promise<{ game_key: string; season: string; is_active: boolean }> {
  return withCache(
    `${CACHE_CATEGORIES.STATIC.prefix}:current-mlb-game`,
    CACHE_CATEGORIES.STATIC.ttl,
    () => new YahooFantasyAPI(userId).getCurrentMLBSeason(),
  );
}

/**
 * Get fantasy leagues for a user with caching.
 * Uses Semi-dynamic caching (5-minute TTL).
 */
export async function getUserLeagues(userId: string): Promise<League[]> {
  return withCache(
    `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:leagues:${userId}`,
    CACHE_CATEGORIES.SEMI_DYNAMIC.ttl,
    () => new YahooFantasyAPI(userId).getUserLeagues(),
  );
}

/**
 * Get league teams with caching.
 * Uses Semi-dynamic caching (10-minute TTL).
 */
export async function getLeagueTeams(userId: string, leagueKey: string): Promise<Team[]> {
  return withCache(
    `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:teams:${leagueKey}`,
    CACHE_CATEGORIES.SEMI_DYNAMIC.ttlMedium,
    () => new YahooFantasyAPI(userId).getLeagueTeams(leagueKey),
  );
}

/**
 * Check fantasy API health for a user.
 */
export async function checkUserFantasyAccess(userId: string): Promise<{ hasAccess: boolean; error?: string }> {
  try {
    const api = new YahooFantasyAPI(userId);
    const health = await api.healthCheck();
    return { hasAccess: health.tokenValid && health.status === 'healthy' };
  } catch (error) {
    return {
      hasAccess: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Analyze user's fantasy leagues: find leagues, teams, and identify the user's own team in each.
 * Optionally filter by game keys for efficiency (e.g., only current MLB season).
 *
 * Returns a Result<LeagueAnalysis> so consumers can distinguish
 * between "no data" and "something broke".
 */
export async function analyzeUserFantasyLeagues(
  userId: string,
  gameKeys?: string[],
): Promise<Result<LeagueAnalysis>> {
  try {
    const api = new YahooFantasyAPI(userId);
    const leagues = await api.getUserLeagues(gameKeys);

    if (leagues.length === 0) {
      return {
        ok: true,
        data: {
          status: 'no_leagues',
          message: gameKeys
            ? `User has no leagues for game keys: ${gameKeys.join(', ')}`
            : 'User has no active fantasy leagues',
        },
      };
    }

    // Analyze each league with individual error handling and rate limiting
    const analysis: LeagueAnalysisEntry[] = await Promise.all(
      leagues.map(async (league, index) => {
        // Small delay between requests to avoid Yahoo rate limits
        if (index > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        try {
          const teams = await api.getLeagueTeams(league.league_key);
          const userTeam = findUserTeam(teams);

          return {
            league_key: league.league_key,
            league_name: league.name,
            league_type: league.league_type,
            scoring_type: league.scoring_type,
            total_teams: teams.length,
            user_team: userTeam
              ? {
                  team_key: userTeam.team_key,
                  team_name: userTeam.name,
                  waiver_priority: userTeam.waiver_priority,
                }
              : null,
            draft_status: league.draft_status,
            current_week: league.current_week,
            is_finished: league.is_finished,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const isAuthError = errorMessage.includes('Authentication failed')
            || errorMessage.includes('Access forbidden');

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
            error: isAuthError
              ? 'Access denied - may no longer be a member of this league'
              : errorMessage,
          };
        }
      }),
    );

    const summary: LeagueAnalysisSummary = {
      total_leagues: leagues.length,
      active_leagues: analysis.filter(l => !l.error && l.is_finished === 0).length,
      finished_leagues: analysis.filter(l => !l.error && l.is_finished === 1).length,
      leagues_with_teams: analysis.filter(l => !l.error && l.user_team).length,
      sport_breakdown: leagues.reduce<Record<string, number>>((acc, league) => {
        const gk = league.league_key.split('.')[0];
        acc[gk] = (acc[gk] || 0) + 1;
        return acc;
      }, {}),
    };

    return {
      ok: true,
      data: {
        status: 'success',
        summary,
        leagues: analysis,
        timestamp: Date.now(),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
