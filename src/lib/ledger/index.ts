// Forecast ledger barrel — capture, grading, and scorecard for the
// forecast-verification loop. See docs/forecast-verification.md.

export {
  capturePitcherSlate,
  capturePitcherSlateInBackground,
  capturePointsInBackground,
  pointsSnapshotRows,
  insertSnapshots,
  leadDaysFor,
  todayEt,
} from './capture';
export type { ForecastEngine, SnapshotRow } from './capture';

export { scorePendingActuals } from './score';
export type { ScoreRunResult } from './score';

export { buildScorecard } from './scorecard';
export type {
  EngineScorecard,
  ScorecardFilters,
  StatGrade,
  CalibrationBucket,
  RankBucket,
  PlayerMiss,
} from './scorecard';

export { MODEL_VERSION } from './modelVersion';
