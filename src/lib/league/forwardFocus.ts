import type { ForecastEntry, LeagueForecast } from './forecast';
import type {
  MatchupAnalysis,
  AnalyzedMatchupRow,
  SuggestedFocus,
} from '@/lib/matchup/analysis';

/**
 * Forward-looking focus assignment for the roster page.
 *
 * H2H category leagues are won by maximizing **weekly category wins** —
 * a 5-of-9 record every week beats 9-of-9 half the time and 1-of-9 the
 * rest. So the right roster strategy isn't "make every cat better,"
 * it's "pick the cats you commit to winning, and concede the rest so
 * resources concentrate where they matter."
 *
 * Two algorithms live in this file:
 *
 *  - **v2 (`assignFocusForBattingSide`)** — goal-driven. Sorts cats into
 *    anchors / swings / concedes to fill a target winning-majority count.
 *    Used for batting, where roster construction is the dominant lever
 *    (most leagues' weekly add/drop budget gets spent on hitters).
 *
 *  - **v1 (`forwardFocusV1`)** — per-cat z-score bands. Used for pitching
 *    while the v2 model is being validated on batting. Pitcher rosters
 *    typically run "ace anchors + streamers" so the per-cat bands are
 *    a reasonable first cut; we'll bring pitching into v2 later.
 */

import type { Focus } from '@/lib/mlb/batterRating';

/**
 * Anchor: user is currently rank 1 or 2 in the cat. In H2H weekly play,
 * rank 1 wins ~90% of cat matchups and rank 2 wins ~80% — both are
 * "winning the cat in expectation." Rank 3 (~67%) doesn't qualify;
 * those cats need to chase up to be reliable.
 */
const ANCHOR_RANK_THRESHOLD = 2;

/**
 * Strict-majority floor for the winning-majority safety check. With
 * `cats=9`, floor = 5 (must be projected to win > 50% of cats). When
 * anchors + swings falls below this, the plan flags `belowMajority` —
 * roster shape needs work, not just focus tuning. This is a FLOOR, not
 * a cap; the algorithm never artificially demotes a swing to punt to
 * meet a target.
 */
function majorityFloor(cats: number): number {
  return Math.floor(cats / 2) + 1;
}

// Pitcher v1 still uses z-score (talent-only, no FA pool dependency yet).
// Kept here until v2 pitcher port lands.
const ANCHOR_Z_THRESHOLD = 0.5;
const CONTEST_Z_THRESHOLD = -0.5;
const HARD_PUNT_Z = -1.5;
const LOCKED_Z = 1.5;

// ---------------------------------------------------------------------------
// v2 — goal-driven assignment for batting
// ---------------------------------------------------------------------------

export interface BattingFocusPlan {
  /** stat_id → suggested focus (anchor=neutral, swing=chase, concede=punt). */
  focusByStatId: Map<number, SuggestedFocus>;
  /** Cats already projected to win in a typical week (rank ≤ 2).
   *  Defend, don't dilute. */
  anchors: ForecastEntry[];
  /** Cats committed to flipping with roster moves — rank 3+ but with
   *  rank 1 or 2 reachable in `REACHABLE_GAP_MOVES` or fewer moves. */
  swings: ForecastEntry[];
  /** Cats with no realistic path to rank 1 or 2 — roster shape doesn't
   *  support winning this cat without major reconstruction. */
  concedes: ForecastEntry[];
  /** Strict majority count (cats / 2 + 1) — the floor below which the
   *  plan can't reliably win a weekly matchup. Informational, not a
   *  cap on swings. */
  majority: number;
  /** anchors + swings count — what the user is realistically targeting
   *  to win. No cap: if every cat is reachable, every cat is a swing
   *  or anchor. */
  committed: number;
  /** True when anchors + swings < majority floor. Indicates the roster
   *  isn't built to win a majority of cats even with optimal moves —
   *  needs roster reconstruction, not just focus tuning. */
  belowMajority: boolean;
}

/**
 * Pick anchor / swing / concede sets to maximize expected weekly
 * category wins on the batting side.
 *
 * Algorithm:
 *   - **Anchor**: `me.rank ≤ 2` — already winning the cat in expectation
 *     (rank 1: ~90% of weekly H2H cat matchups; rank 2: ~80%). Hold.
 *   - **Swing**: `me.rank > 2` AND `targetRank` is defined (rank 1 or 2
 *     reachable in ≤ `REACHABLE_GAP_MOVES`). Chase the target.
 *   - **Concede**: rank > 2 AND neither rank 1 nor 2 is reachable.
 *     Punt — roster shape doesn't support winning.
 *
 * There is **no forced punt** — every reachable cat becomes a swing.
 * If your roster could realistically win every cat, the plan chases
 * every cat. The `majority` floor is informational only: if anchors
 * + swings < `majorityFloor(cats)`, you're below the level needed to
 * reliably win weekly matchups → `belowMajority = true`.
 *
 * Why rank-based instead of moves-from-median: median = rank 5-6 in a
 * 10-team league, which is barely above coin-flip in H2H weekly play.
 * Anchoring to median sets the bar too low — being "comfortably above
 * median" still doesn't reliably win the cat. Rank 1-2 does.
 *
 * Why RUPM-based reachability instead of z-score: z normalizes to
 * distribution spread, which over-punishes tight distributions (H, AVG)
 * where small absolute deficits look like 1.5σ chasms. RUPM normalizes
 * to what one move actually buys you — the unit fantasy decisions are
 * actually made in.
 */
export function assignFocusForBattingSide(entries: ForecastEntry[]): BattingFocusPlan {
  const focusByStatId = new Map<number, SuggestedFocus>();
  const anchors: ForecastEntry[] = [];
  const swings: ForecastEntry[] = [];
  const concedes: ForecastEntry[] = [];

  for (const entry of entries) {
    if (entry.me.rank <= ANCHOR_RANK_THRESHOLD) {
      anchors.push(entry);
      focusByStatId.set(entry.statId, 'neutral');
      continue;
    }
    if (entry.targetRank !== undefined) {
      swings.push(entry);
      focusByStatId.set(entry.statId, 'chase');
    } else {
      concedes.push(entry);
      focusByStatId.set(entry.statId, 'punt');
    }
  }

  const majority = majorityFloor(entries.length);
  const committed = anchors.length + swings.length;
  const belowMajority = committed < majority;

  return {
    focusByStatId,
    anchors,
    swings,
    concedes,
    majority,
    committed,
    belowMajority,
  };
}

// ---------------------------------------------------------------------------
// v1 — per-cat z-band assignment (still used for pitching)
// ---------------------------------------------------------------------------

/**
 * v1 per-cat z-score band assignment. Maps a single forecast entry to
 * chase / hold / punt without considering the rest of the portfolio.
 *
 * Used for pitching while v2 is being calibrated on the batting side.
 * Bands:
 *  - z ≥ +1.5σ → punt (locked-good — redirect investment)
 *  - +0.5σ ≤ z < +1.5σ → hold (comfortable, defend against erosion)
 *  - −0.5σ ≤ z < +0.5σ AND reachable target → chase
 *  - −0.5σ ≤ z < +0.5σ AND no reachable target → hold (mid-pack stable)
 *  - −1.5σ < z < −0.5σ AND reachable target → chase (closeable deficit)
 *  - z ≤ −1.5σ OR (z < −0.5σ AND no target) → punt
 */
export function forwardFocusV1(entry: ForecastEntry): SuggestedFocus {
  const z = entry.zCompetitive;
  const hasReachableTarget =
    entry.targetRank !== undefined && entry.targetRank < entry.me.rank;

  if (z >= LOCKED_Z) return 'punt';
  if (z >= ANCHOR_Z_THRESHOLD) return 'neutral';
  if (z <= HARD_PUNT_Z) return 'punt';
  if (hasReachableTarget) return 'chase';
  return z >= CONTEST_Z_THRESHOLD ? 'neutral' : 'punt';
}

/** Backward-compatible alias for any caller importing `forwardFocus`. */
export const forwardFocus = forwardFocusV1;

// ---------------------------------------------------------------------------
// MatchupAnalysis adapter — splits batting/pitching, applies side-specific algo
// ---------------------------------------------------------------------------

/**
 * Wrap a `LeagueForecast` as a `MatchupAnalysis` so `useSuggestedFocus` can
 * consume it the same way it consumes the matchup analyzer's output.
 *
 * Batter cats use the v2 goal-driven assignment (anchors / swings /
 * concedes filling a winning-majority target). Pitcher cats use v1
 * per-cat bands. The two sides run independently — picking a swing on
 * batter HR has no effect on pitcher cat assignments.
 *
 * `useSuggestedFocus` only reads `rows[].statId` and `rows[].suggestedFocus`,
 * so the other matchup-analysis fields (margin, priority, leverage) are
 * placeholder zeros — forecast math doesn't map onto the matchup
 * analyzer's `[-1, +1]` margin scale.
 */
export function forecastToAnalysis(forecast: LeagueForecast | undefined): MatchupAnalysis {
  if (!forecast) {
    return { rows: [], leverage: 0, contestedCount: 0, lockedCount: 0 };
  }

  const batterEntries = forecast.entries.filter(e => e.isBatterStat);
  const pitcherEntries = forecast.entries.filter(e => e.isPitcherStat);

  // Batter: v2 goal-driven
  const batterPlan = assignFocusForBattingSide(batterEntries);

  // Pitcher: v1 per-cat (bring into v2 later)
  const pitcherFocus = new Map<number, SuggestedFocus>();
  for (const entry of pitcherEntries) {
    pitcherFocus.set(entry.statId, forwardFocusV1(entry));
  }

  const rows: AnalyzedMatchupRow[] = forecast.entries.map(entry => {
    const focus: Focus = entry.isBatterStat
      ? batterPlan.focusByStatId.get(entry.statId) ?? 'neutral'
      : pitcherFocus.get(entry.statId) ?? 'neutral';
    return {
      label: entry.displayName,
      name: entry.displayName,
      statId: entry.statId,
      myVal: '',
      oppVal: '',
      winning: null,
      countsTowardRecord: true,
      isBatterStat: entry.isBatterStat,
      isPitcherStat: entry.isPitcherStat,
      betterIs: entry.betterIs,
      margin: 0,
      priority: 0,
      suggestedFocus: focus,
    };
  });

  return { rows, leverage: 0, contestedCount: 0, lockedCount: 0 };
}
