// Fantasy data layer — domain modules for Yahoo Fantasy API integration

export {
  CACHE_CATEGORIES,
  cacheResult,
  getCachedResult,
  invalidateCache,
  invalidateCachePattern,
  withCache,
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

export { getLeagueTransactions } from './transactions';

export { getAvailablePitchers, getTopAvailableBatters, getAvailableBatters } from './players';
