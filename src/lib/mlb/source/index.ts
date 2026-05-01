// Source layer barrel — pure I/O over the MLB Stats API.
// model/ files MUST NOT import from this barrel (or any of its members).

export {
  fetchStatSplitsForSeason,
  fetchHittingGameLog,
  fetchCareerVsPitcher,
  fetchPitcherStarterLine,
  fetchPitcherPlatoon,
  fetchPitcherGameLog,
} from './playerStats';

export type {
  RawStat,
  RawSplit,
  RawStatsGroup,
  RawStatsResponse,
} from './playerStats';
