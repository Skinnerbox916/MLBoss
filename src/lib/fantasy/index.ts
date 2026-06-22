// Fantasy data layer — domain modules for Yahoo Fantasy API integration

export {
  CACHE_CATEGORIES,
  cacheResult,
  getCachedResult,
  getCacheStats,
  invalidateCache,
  invalidateCachePattern,
  listCacheKeys,
  resetCacheStats,
  withCache,
  withCacheGated,
} from './cache';
export type { CacheStats, CacheTier } from './cache';

export {
  getUserFromRedis,
  isTokenValid,
  refreshUserTokens,
  getUserIdFromToken,
} from './auth';

export {
  getStatCategories,
  getStatCategoryMap,
  enrichStats,
  getEnrichedLeagueStatCategories,
} from './stats';
export type { EnrichedLeagueStatCategory, EnrichedStat, RawStat } from './stats';

export {
  getCurrentMLBGameKey,
  getUserLeagues,
  getLeagueTeams,
  getLineupCadence,
  checkUserFantasyAccess,
  analyzeUserFantasyLeagues,
} from './leagues';
export type {
  Result,
  LeagueAnalysis,
  LeagueAnalysisEntry,
  LeagueAnalysisSummary,
} from './leagues';

export { getScoringProfile } from './scoringProfile';
export type { ScoringProfile, ScoringMode } from './scoringProfile';

export { getLeagueStandings } from './standings';

export { getLeagueScoreboard, getTeamMatchups } from './matchups';

export { getTeamStatsSeason, getTeamStatsWeek } from './teamStats';

export {
  getTeamRoster,
  getTeamRosterByDate,
  setTeamRoster,
  getLeagueRosterPositions,
} from './roster';

export { getLeagueLimits, getMovesBudget } from './limits';
export type { LeagueLimits, MovesBudget } from './limits';

export { getLeagueTransactions } from './transactions';

export {
  getAvailablePitchers,
  getTopAvailableBatters,
  getAvailableBatters,
  getPlayerMarketSignals,
} from './players';
export type { PlayerMarketSignals } from './players';
