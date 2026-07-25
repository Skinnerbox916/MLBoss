/**
 * Points-native pricing of expected streamed starts.
 *
 * The categories side folds a team's expected streams into per-category
 * output via `LEAGUE_AVG_START_OUTPUT` ([projection/streamVolume.ts](../projection/streamVolume.ts)).
 * Points leagues can't use a constant: two leagues with the same rosters
 * score a start completely differently (innings-heavy vs strikeout-heavy
 * profiles, negative-point walks, quality-start bonuses). So the anchor is
 * the league's own FA pool — `faStartPointsAvg` from `analyzePointsStreaming`,
 * the mean expected points of one available FA start, priced through this
 * league's scoring profile by the same engine that ranks the streaming board.
 *
 * The *rate* and the pro-rating rule are shared with categories on purpose
 * (`proRateStreamStarts`) — one estimator, one home, so the two modes can't
 * drift on the question "how many starts will they add?" Only the currency
 * conversion differs, which is exactly the difference between the modes.
 *
 * By-side rule (opponent always, me on next-week surfaces only) is documented
 * once, in the categories module. See docs/points-leagues.md#opponent-stream-volume.
 */

import { proRateStreamStarts } from '@/lib/projection/streamVolume';

export interface ExpectedStreamPointsInput {
  /** Demonstrated SP adds per week for this team (`useLeagueStreamRates`). */
  startsPerWeek: number;
  /** Calendar days left in the window being projected. For a next-week window
   *  this is the whole window — none of it has happened. Days, not a share:
   *  the rate is per 7 days and a matchup week can be 14 (all-star break). */
  remainingDays: number;
  /** Mean expected points of one FA start in this league's scoring profile
   *  (`PointsStreamingAnalysis.faStartPointsAvg`). 0 until it resolves, which
   *  makes the whole term 0 — callers degrade to roster-only. */
  faStartPointsAvg: number;
}

export interface ExpectedStreamPoints {
  /** Expected streamed starts over the window (pro-rated). */
  starts: number;
  /** Those starts priced in league points. */
  points: number;
}

export function expectedStreamPoints({
  startsPerWeek,
  remainingDays,
  faStartPointsAvg,
}: ExpectedStreamPointsInput): ExpectedStreamPoints {
  const starts = proRateStreamStarts(startsPerWeek, remainingDays);
  return { starts, points: starts * (faStartPointsAvg || 0) };
}
