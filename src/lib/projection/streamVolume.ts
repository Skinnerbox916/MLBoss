/**
 * Expected streamed-start volume for a team-week.
 *
 * The team pitcher projection (`pitcherTeam.ts`) prices the CURRENT roster:
 * posted probables plus inferred rest-day slots for arms already owned. In a
 * league where managers stream, that is not what either side will actually
 * do — a manager who adds three starters a week will out-pitch their roster
 * projection by ~16 IP, and so will their opponent. Comparing two roster-only
 * projections silently assumes both managers stand pat, which is wrong in the
 * same direction for both but by very different amounts (in our reference
 * league the spread across nine managers is 0 to 3+ SP adds/week).
 *
 * This module supplies the missing volume in two halves:
 *
 *   1. `computeTeamStreamRates` — a *demonstrated-rate* estimate of how many
 *      starters each manager will add next week, from the league's own
 *      transaction feed (Yahoo returns the full season in one call).
 *   2. `applyExpectedStreams` — folds those starts into a projected pitcher
 *      week at league-average per-start output, counting cats and ratio
 *      numerators/denominators alike, so ERA/WHIP move the way added innings
 *      actually move them.
 *
 * **Demonstrated rate, not capacity.** We deliberately do NOT assume every
 * manager burns their weekly add cap. A set-and-forget manager projects zero
 * extra starts and their roster projection stands, which is the whole point:
 * the estimate has to discriminate between opponents or it adds noise instead
 * of information. The cap only clamps the top end.
 *
 * **Recency-weighted.** Each historical add decays with a 3-week half-life,
 * so a manager who streamed hard in April and stopped in July reads as
 * stopped, and a deadline-week convert reads as active within a fortnight.
 * The normalizer is the same decay integrated over the feed's coverage, so
 * the result is a per-week rate regardless of how much history exists.
 *
 * **Expectation, not intent.** A category that reads "in play" only because
 * of expected streams still needs the adds to happen. That's why the L5
 * stream-capacity gate keeps its residual headroom (`cap − expected`) rather
 * than being deleted as redundant: a deficit stays reachable-by-streaming for
 * anyone below their cap, so nothing self-fulfillingly concedes.
 *
 * **Where it applies — one rule, both scoring modes.** The split is by SIDE,
 * not by surface:
 *
 *   - **Opponent: always.** Nothing else in the app models their adds, so
 *     every forward projection of the opponent carries their expected
 *     streams — mid-week pro-rated over remaining days (`proRateStreamStarts`)
 *     and the full week on the next-week pivot. Their matchup-to-date
 *     already contains the streams they made; this covers the ones they
 *     haven't yet.
 *   - **Me: pivot only.** Mid-week my remaining adds are a *lever*, not a
 *     prediction, and they're already represented by `streamCapacity` in
 *     `analyzeMatchup` (reachability on losing rows, capped at even). Adding
 *     an expectation on top of that would count the same moves twice. On the
 *     pivot there is no matchup-to-date to reason from, so my expected
 *     streams go into the rows and capacity drops to the residual.
 *
 * Points leagues follow the identical rule with a points-native anchor —
 * the FA pool's own mean expected points per start — instead of the
 * per-category anchors here (scoring profiles vary too much for a constant).
 * See docs/points-leagues.md#opponent-stream-volume.
 *
 * Rationale + the asymmetry argument: docs/projection.md#expected-streamed-starts.
 *
 * Per-start output anchors are NOT redefined here — they come from
 * `LEAGUE_AVG_START_OUTPUT` / `LEAGUE_AVG_START_RATIO_NUM` in
 * `streamPitcherCatImpact.ts`, the one home for "what one league-average
 * start is worth".
 */

import {
  LEAGUE_AVG_START_OUTPUT,
  LEAGUE_AVG_START_RATIO_NUM,
  LEAGUE_AVG_START_IP,
} from './streamPitcherCatImpact';
import type { TransactionEntry } from '@/lib/yahoo-fantasy-api';

/**
 * Half-life (weeks) of the recency decay on historical adds. Three weeks
 * keeps roughly the last month-and-a-half of behavior load-bearing while
 * still letting a change of habit show up quickly. Not a sabermetric
 * constant — a responsiveness choice; see module docblock.
 */
const DECAY_HALF_LIFE_WEEKS = 3;

/**
 * Starts credited per streamed SP add. One: a stream is added for a specific
 * turn. Two-start streams exist and push above 1, adds that never start
 * (post-add scratch, an add held on the bench, a same-week drop) push below,
 * and we have no evidence the residual is large enough to justify a fudge
 * factor. Revisit against the forecast ledger, not by intuition.
 */
const STARTS_PER_SP_ADD = 1;

/**
 * Hard ceiling on expected streamed starts per week, used when the league
 * reports no weekly add cap. Seven = one per day; beyond that a manager is
 * churning a slot rather than adding starts.
 */
const MAX_STREAM_STARTS_PER_WEEK = 7;

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export interface TeamStreamRate {
  teamKey: string;
  /** Recency-weighted starting-pitcher adds per week (pre-clamp). */
  spAddsPerWeek: number;
  /** Expected streamed starts next week, after the cap/ceiling clamp. */
  expectedStreamStarts: number;
  /** Raw count of SP adds seen in the feed (diagnostic, un-weighted). */
  spAdds: number;
}

export interface ComputeTeamStreamRatesInput {
  /** Full league transaction feed (`getLeagueTransactions`, no type filter). */
  transactions: TransactionEntry[];
  /** Every team in the league — teams absent from the feed must still get a
   *  zero-rate entry, so callers can distinguish "no streams expected" from
   *  "no data". */
  teamKeys: string[];
  /** League weekly add cap (`LeagueLimits.maxWeeklyAdds`); null = unlimited. */
  weeklyAddCap: number | null;
  /** Evaluation instant (ms). Injected so the result is testable/pure. */
  nowMs: number;
}

/** True when a Yahoo `display_position` string covers starting pitcher. */
function isStartingPitcher(displayPosition: string): boolean {
  return displayPosition.split(',').some(p => p.trim() === 'SP');
}

/**
 * Per-team expected streamed starts for the upcoming week, from demonstrated
 * behavior in the league transaction feed. Pure: same inputs → same outputs.
 *
 * Only successful adds of SP-eligible players count. Relief adds are excluded
 * on purpose — they chase saves, which `LEAGUE_AVG_START_OUTPUT` doesn't
 * model (SV carries no per-start yield anywhere in the app).
 */
export function computeTeamStreamRates({
  transactions,
  teamKeys,
  weeklyAddCap,
  nowMs,
}: ComputeTeamStreamRatesInput): TeamStreamRate[] {
  const ceiling = Math.min(weeklyAddCap ?? MAX_STREAM_STARTS_PER_WEEK, MAX_STREAM_STARTS_PER_WEEK);

  // Collect SP adds with a usable timestamp, per destination team.
  const addsByTeam = new Map<string, number[]>(); // teamKey → weeksAgo[]
  let earliestMs = Infinity;
  for (const tx of transactions) {
    if (tx.status !== 'successful' || !tx.timestamp) continue;
    const tsMs = tx.timestamp * 1000;
    if (tsMs > nowMs) continue;
    earliestMs = Math.min(earliestMs, tsMs);
    for (const p of tx.players) {
      if (p.type !== 'add' || !p.destination_team_key) continue;
      if (!isStartingPitcher(p.display_position)) continue;
      const weeksAgo = (nowMs - tsMs) / MS_PER_WEEK;
      const list = addsByTeam.get(p.destination_team_key);
      if (list) list.push(weeksAgo);
      else addsByTeam.set(p.destination_team_key, [weeksAgo]);
    }
  }

  // Feed coverage in weeks. `earliestMs` spans the whole feed (not just SP
  // adds) so a team with zero adds is measured over the same window as one
  // that streams daily. Floored at one week: a brand-new league shouldn't
  // divide a single add by a fraction of a week and read as 5 streams/wk.
  const coverageWeeks = Number.isFinite(earliestMs)
    ? Math.max(1, (nowMs - earliestMs) / MS_PER_WEEK)
    : 0;

  // ∫₀^W 0.5^(x/HL) dx — the same decay applied to the denominator, so the
  // quotient is a decay-weighted rate per week rather than a raw total.
  const ln2 = Math.LN2;
  const decayedWeeks = coverageWeeks > 0
    ? (DECAY_HALF_LIFE_WEEKS / ln2) * (1 - Math.pow(0.5, coverageWeeks / DECAY_HALF_LIFE_WEEKS))
    : 0;

  return teamKeys.map(teamKey => {
    const weeksAgoList = addsByTeam.get(teamKey) ?? [];
    const weighted = weeksAgoList.reduce(
      (sum, weeksAgo) => sum + Math.pow(0.5, weeksAgo / DECAY_HALF_LIFE_WEEKS),
      0,
    );
    const spAddsPerWeek = decayedWeeks > 0 ? weighted / decayedWeeks : 0;
    return {
      teamKey,
      spAddsPerWeek,
      expectedStreamStarts: Math.max(0, Math.min(spAddsPerWeek * STARTS_PER_SP_ADD, ceiling)),
      spAdds: weeksAgoList.length,
    };
  });
}

/**
 * The most streamed starts a team could add in a week — the ceiling the
 * estimate clamps to. Exposed so the L5 stream-capacity gate can express
 * "headroom left above what we already expect" in the same units.
 */
export function maxStreamStartsPerWeek(weeklyAddCap: number | null | undefined): number {
  return Math.min(weeklyAddCap ?? MAX_STREAM_STARTS_PER_WEEK, MAX_STREAM_STARTS_PER_WEEK);
}

/**
 * A per-7-day stream rate scaled to a window of `remainingDays`.
 *
 * Mid-week only a fraction of a manager's weekly adds are still ahead of
 * them, so the full-week rate would over-credit: a 3-streams-a-week manager
 * with one day left is not about to add three starters. Linear in days, which
 * matches how add budgets actually get spent (roughly evenly, since streams
 * follow the daily probable slate).
 *
 * **Scales on CALENDAR days, not share-of-matchup-week.** `computeTeamStreamRates`
 * measures adds per 7 days, and a Yahoo matchup week is not always 7 — the
 * combined all-star week is 14 (2026 week 17 = Jul 13–26). Dividing by the
 * matchup week's own length would halve every estimate in that week, and
 * Yahoo's add cap resets per 7-day coverage week anyway, so a 14-day matchup
 * genuinely carries two weeks of streaming. Same trap as the other
 * "assumes 7" sites in docs/history.md.
 *
 * Shared by both scoring modes so the pro-rating rule can't drift — points
 * multiplies the result by its own per-start points anchor, categories feeds
 * it to `applyExpectedStreams`.
 */
const DAYS_PER_RATE_WEEK = 7;

export function proRateStreamStarts(startsPerWeek: number, remainingDays: number): number {
  if (!startsPerWeek || startsPerWeek <= 0) return 0;
  if (remainingDays <= 0) return 0;
  return startsPerWeek * (remainingDays / DAYS_PER_RATE_WEEK);
}

/**
 * `applyExpectedStreams` for a whole team projection response — folds the
 * starts into `byCategory` AND the headline IP totals, so a surface reading
 * `weeklyIp` ("~39 IP left" on the Boss Card, the streaming page's volume
 * gap) tells the same story as the category rows. Streamed starts are SP
 * starts, so only `weeklySpIp` moves.
 *
 * Returns the input unchanged when there's nothing to add, so callers can
 * pass it through unconditionally.
 */
export function applyExpectedStreamsToProjection<
  T extends {
    byCategory: Record<number, { expectedCount: number; expectedDenom: number }>;
    weeklySpIp: number;
    weeklyIp: number;
  },
>(projection: T | undefined, starts: number): T | undefined {
  if (!projection || !starts || starts <= 0) return projection;
  return {
    ...projection,
    byCategory: applyExpectedStreams(projection.byCategory, starts),
    weeklySpIp: projection.weeklySpIp + starts * LEAGUE_AVG_START_IP,
    weeklyIp: projection.weeklyIp + starts * LEAGUE_AVG_START_IP,
  };
}

/**
 * Fold `starts` league-average streamed starts into a projected pitcher week.
 *
 * Returns a NEW record (does not mutate). Counting cats gain their per-start
 * yield and one unit of `expectedDenom` (which is a start count on the
 * counting side); ratio cats gain league-average ER / baserunners over
 * league-average IP, which is what makes a streamed inning pull a 3.30 ERA
 * up and a 4.50 ERA down. Categories the projection doesn't carry are left
 * absent rather than invented — a side with no pitcher projection at all
 * stays empty so the row falls back to em-dash.
 */
export function applyExpectedStreams(
  byCategory: Record<number, { expectedCount: number; expectedDenom: number }>,
  starts: number,
): Record<number, { expectedCount: number; expectedDenom: number }> {
  if (!starts || starts <= 0) return byCategory;
  const out: Record<number, { expectedCount: number; expectedDenom: number }> = { ...byCategory };

  for (const [statIdStr, perStart] of Object.entries(LEAGUE_AVG_START_OUTPUT)) {
    const statId = Number(statIdStr);
    const cur = out[statId];
    if (!cur) continue;
    out[statId] = {
      expectedCount: cur.expectedCount + starts * perStart,
      // IP's own denominator is a start count like every other counting cat.
      expectedDenom: cur.expectedDenom + starts,
    };
  }

  for (const [statIdStr, perStartNum] of Object.entries(LEAGUE_AVG_START_RATIO_NUM)) {
    const statId = Number(statIdStr);
    const cur = out[statId];
    if (!cur) continue;
    out[statId] = {
      expectedCount: cur.expectedCount + starts * perStartNum,
      expectedDenom: cur.expectedDenom + starts * LEAGUE_AVG_START_IP,
    };
  }

  return out;
}
