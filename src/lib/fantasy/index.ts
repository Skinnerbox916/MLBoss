// Fantasy data layer — domain modules for Yahoo Fantasy API integration

export {
  CACHE_CATEGORIES,
  cacheResult,
  getCachedResult,
  invalidateCache,
  invalidateCachePattern,
  listCacheKeys,
  withCache,
  withCacheGated,
} from './cache';

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
  checkUserFantasyAccess,
  analyzeUserFantasyLeagues,
} from './leagues';
export type {
  Result,
  LeagueAnalysis,
  LeagueAnalysisEntry,
  LeagueAnalysisSummary,
} from './leagues';

export { getLeagueStandings } from './standings';

export { getLeagueScoreboard, getTeamMatchups } from './matchups';

export { getTeamStatsSeason, getTeamStatsWeek } from './teamStats';

export {
  getTeamRoster,
  getTeamRosterByDate,
  setTeamRoster,
  getLeagueRosterPositions,
} from './roster';

export { getLeagueLimits } from './limits';
export type { LeagueLimits } from './limits';

export { getLeagueTransactions } from './transactions';

export {
  getAvailablePitchers,
  getTopAvailableBatters,
  getAvailableBatters,
  getPlayerMarketSignals,
} from './players';
export type { PlayerMarketSignals } from './players';
