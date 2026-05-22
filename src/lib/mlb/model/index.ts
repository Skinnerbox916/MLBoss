// Model layer barrel — pure functions over raw shapes from source/.
// source/ files MUST NOT import from this barrel (or any of its members).

export {
  parseSplitLine,
  findByCode,
  findGroup,
  aggregateLastN,
  parsePitchingLine,
  parsePitchingOverallLine,
  aggregatePitcherRecentForm,
  parsePitcherAppearances,
} from './playerStats';

export type {
  PitcherSeasonLine,
  PitcherOverallLine,
  PitcherAppearance,
} from './playerStats';

export {
  applyPitcherStatsLine,
  applySavantSignals,
  applyPitcherPlatoon,
  applyPitcherRecentForm,
} from './pitcherEnrichment';
