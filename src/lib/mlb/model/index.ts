// Model layer barrel — pure functions over raw shapes from source/.
// source/ files MUST NOT import from this barrel (or any of its members).

export {
  parseSplitLine,
  findByCode,
  findGroup,
  aggregateLastN,
  parsePitchingLine,
  aggregatePitcherRecentForm,
} from './playerStats';

export type { PitcherSeasonLine } from './playerStats';

export {
  classifyPitcherTier,
  MIN_IP_CURRENT,
  MIN_IP_PRIOR,
  MIN_BIP_FOR_XERA,
} from './quality';

export {
  applyPitcherStatsLine,
  applySavantSignals,
  applyPitcherPlatoon,
  applyPitcherRecentForm,
} from './pitcherEnrichment';
