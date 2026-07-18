// Forecast ledger barrel — capture, grading, and scorecard for the
// forecast-verification loop. See docs/forecast-verification.md.

export {
  capturePitcherSlate,
  capturePitcherSlateInBackground,
  captureBatterSlate,
  captureBatterSlateInBackground,
  captureBatterWeek,
  captureBatterWeekInBackground,
  capturePointsInBackground,
  pointsSnapshotRows,
  insertSnapshots,
  leadDaysFor,
  addDaysIso,
  nextMondayEt,
  todayEt,
  BATTER_STAT_KEYS,
} from './capture';
export type { ForecastEngine, SnapshotRow } from './capture';

export { scorePendingActuals } from './score';
export type { ScoreRunResult } from './score';

export { buildScorecard } from './scorecard';
export type {
  Scorecard,
  EngineScorecard,
  ScorecardFilters,
  StatGrade,
  CalibrationBucket,
  RankBucket,
  ScoreBucket,
  PlayerMiss,
  Finding,
} from './scorecard';

export { MODEL_VERSION } from './modelVersion';
