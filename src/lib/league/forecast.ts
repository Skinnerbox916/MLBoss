/**
 * League forecast — forward-looking per-category position against the
 * rest of the league. The roster page uses this to decide chase / hold /
 * punt for *roster moves* (long-horizon decisions), as opposed to the
 * matchup analyzer which drives weekly start/sit and pickup decisions.
 *
 * The signal is each team's **projected per-week output** in each scored
 * category, aggregated across their current roster. Outlier teams (a
 * single dominator in a cat) are detected via 1.5×IQR fences and their
 * z-score comparison set is excluded — so chasing 2nd place in SB is
 * scored realistically when 1st is unreachable.
 *
 * Per-cat output:
 *   - `ranking` — every team sorted best-first (direction-aware), with
 *      `isOutlier` flagged
 *   - `me` — my team's entry inside the ranking
 *   - `zCompetitive` — my z-score against the non-outlier competitive
 *      field. Sign-flipped for lower-is-better stats so positive always
 *      means "my roster outproduces the league."
 *   - `targetRank` — the highest non-outlier rank above me whose gap is
 *      within ~1σ (closeable with a roster move). Undefined when nothing
 *      above me is reachable.
 */

import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';

export interface ProjectedCategoryAgg {
  expectedCount: number;
  expectedDenom: number;
}

export interface TeamAggregate {
  teamKey: string;
  teamName: string;
  byCategory: Record<number, ProjectedCategoryAgg>;
}

export interface ForecastTeam {
  teamKey: string;
  teamName: string;
  /** Per-week projected output in this category (already direction-collapsed
   *  to a scalar — counting cats use `expectedCount`, ratio cats use
   *  `expectedCount / expectedDenom`). */
  projectedValue: number;
  rank: number;
  /** `true` when the team's value sits beyond the 1.5×IQR fence. */
  isOutlier: boolean;
}

export interface ForecastEntry {
  statId: number;
  name: string;
  displayName: string;
  betterIs: 'higher' | 'lower';
  isBatterStat: boolean;
  isPitcherStat: boolean;
  /** All teams ranked best-first (1 = best in cat). */
  ranking: ForecastTeam[];
  /** My team's entry inside `ranking`. */
  me: ForecastTeam;
  /** Outlier teams excluded from the competitive z-score. */
  outliers: ForecastTeam[];
  /** Median of the competitive (non-outlier) field. */
  competitiveMedian: number;
  /** Population stddev of the competitive field. 0 when everyone is tied.
   *  Kept for debugging / display; the focus assignment no longer keys
   *  off it — see `movesFromMedian` / `movesToTarget` below. */
  competitiveStdDev: number;
  /**
   * My z-score within the competitive field. Positive = my roster
   * outproduces the league average (sign-flipped for lower-is-better).
   * 0 when stddev is 0. Retained for display only; do **not** key new
   * logic off this — std-dev mis-scales tight distributions (H, AVG).
   */
  zCompetitive: number;
  /**
   * Replacement Upgrade Per Move (RUPM) — typical per-week output gain
   * available by swapping a marginal rostered player for a top FA at
   * this cat. League-wide constant per cat; computed in the API route
   * from FA pool projections minus replacement-level rostered output.
   * 0 when no FA pool data available.
   */
  rupm: number;
  /**
   * My position relative to the competitive median, expressed in RUPM
   * units. Positive = ahead by N moves' worth; negative = behind.
   * This replaces `zCompetitive` for the focus-assignment logic
   * (anchor / swing / concede thresholds) because RUPM scales with
   * cat-specific upgradeability, not distribution spread.
   *
   * `movesFromMedian = (my_value - compMedian) / rupm`, sign-flipped
   * for lower-is-better cats. 0 when rupm is 0.
   */
  movesFromMedian: number;
  /**
   * Highest non-outlier rank above me whose gap is closeable in
   * `REACHABLE_GAP_MOVES` or fewer roster moves (gap / rupm).
   * Undefined when nothing above me is reachable. When defined, this
   * is the rank a one-to-two-move swap could plausibly attain.
   */
  targetRank: number | undefined;
  /**
   * Number of roster moves' worth of gap to `targetRank` (in RUPM
   * units). Undefined when `targetRank` is undefined. Below 1 means
   * a single move closes the gap; 1-2 means it's a realistic 1-2
   * move chase.
   */
  movesToTarget: number | undefined;
}

export interface LeagueForecast {
  myTeamKey: string;
  teamCount: number;
  weekStart?: string;
  weekEnd?: string;
  entries: ForecastEntry[];
}

// Tunables.
const OUTLIER_IQR_K = 1.5;          // standard 1.5×IQR fence
/**
 * Max gap to target rank measured in RUPM units (roster moves). A target
 * rank is "reachable" if the user could plausibly close the gap with
 * 1-2 well-chosen swaps. 2.0 = "two moves' worth of upgrade."
 * Exported: `rosterValue.ts` maps this same bar onto the pivotality
 * decided-boundary so reachability and leverage stay one concept.
 */
export const REACHABLE_GAP_MOVES = 2.0;

/**
 * Ranks worth chasing in an H2H category league. Rank 1 wins ~90% of
 * weekly H2H cat matchups; rank 2 wins ~80%. Rank 3 drops to ~67%,
 * which isn't reliably "winning" the cat in expectation. So we only
 * propose target ranks of 1 or 2 — chasing rank 3 spends roster moves
 * for a coin-flip outcome.
 */
const TARGET_RANKS = [1, 2] as const;

// Display names of cats whose category aggregate is a ratio (count /
// denom), not a raw count. Checked against `cat.display_name` because
// `cat.name` is Yahoo's verbose label ("Batting Average", "Earned Run
// Average") which doesn't match these tickers. Mirrors the scoring
// conventions in `src/lib/matchup/analysis.ts`.
export const RATIO_STATS = new Set(['AVG', 'OBP', 'SLG', 'OPS', 'ERA', 'WHIP', 'K9', 'BB9', 'H9']);

/** True when this cat's projection aggregate is a ratio (count/denom)
 *  rather than a raw count. */
export function isRatioCat(cat: { name: string; display_name: string }): boolean {
  return RATIO_STATS.has(cat.display_name) || RATIO_STATS.has(cat.name);
}

function projectedValueFor(agg: ProjectedCategoryAgg | undefined, isRatio: boolean): number {
  if (!agg) return 0;
  if (isRatio) {
    return agg.expectedDenom > 0 ? agg.expectedCount / agg.expectedDenom : 0;
  }
  return agg.expectedCount;
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function computeLeagueForecast(input: {
  myTeamKey: string;
  teams: TeamAggregate[];
  categories: EnrichedLeagueStatCategory[];
  /**
   * Per-cat Replacement Upgrade Per Move (RUPM), keyed by stat_id.
   * Computed league-wide as
   * `avg(top-K FA per-week output) - avg(bottom-K rostered output)`.
   * Cats absent from the map get `rupm: 0` (closeability checks degrade
   * gracefully — no swing candidates).
   */
  rupmByStatId?: Map<number, number>;
  weekStart?: string;
  weekEnd?: string;
}): LeagueForecast {
  const { myTeamKey, teams, categories, rupmByStatId, weekStart, weekEnd } = input;

  const entries: ForecastEntry[] = [];

  for (const cat of categories) {
    const isRatio = isRatioCat(cat);

    const teamValues = teams.map(t => ({
      teamKey: t.teamKey,
      teamName: t.teamName,
      projectedValue: projectedValueFor(t.byCategory[cat.stat_id], isRatio),
    }));

    // Direction-aware sort (best first).
    teamValues.sort((a, b) =>
      cat.betterIs === 'higher'
        ? b.projectedValue - a.projectedValue
        : a.projectedValue - b.projectedValue,
    );

    const ranking: ForecastTeam[] = teamValues.map((t, i) => ({
      ...t,
      rank: i + 1,
      isOutlier: false,
    }));

    // IQR-based outlier detection on the raw value distribution. We sort
    // ascending here (independent of `betterIs`) so q1/q3 are well-defined.
    const sortedValues = ranking.map(r => r.projectedValue).slice().sort((a, b) => a - b);
    const q1 = quantile(sortedValues, 0.25);
    const q3 = quantile(sortedValues, 0.75);
    const iqr = q3 - q1;
    const lowFence = q1 - OUTLIER_IQR_K * iqr;
    const highFence = q3 + OUTLIER_IQR_K * iqr;
    for (const r of ranking) {
      r.isOutlier = iqr > 0 && (r.projectedValue < lowFence || r.projectedValue > highFence);
    }
    const outliers = ranking.filter(r => r.isOutlier);

    // Competitive field stats (excluding outliers). When an outlier exclusion
    // would leave fewer than 2 teams (degenerate league), fall back to all
    // teams.
    const competitive = ranking.filter(r => !r.isOutlier);
    const compTeams = competitive.length >= 2 ? competitive : ranking;
    const compValues = compTeams.map(r => r.projectedValue);
    const compMean = compValues.reduce((s, v) => s + v, 0) / compValues.length;
    const compMedian = quantile(compValues.slice().sort((a, b) => a - b), 0.5);
    const compVar = compValues.reduce((s, v) => s + (v - compMean) ** 2, 0) / compValues.length;
    const compStdDev = Math.sqrt(compVar);

    const me = ranking.find(r => r.teamKey === myTeamKey);
    if (!me) continue; // user's team not in standings — skip this cat

    const rawZ = compStdDev === 0 ? 0 : (me.projectedValue - compMean) / compStdDev;
    const zCompetitive = cat.betterIs === 'higher' ? rawZ : -rawZ;

    // RUPM-based closeability — replaces z-score for focus logic. See
    // `ForecastEntry.movesFromMedian` doc for rationale.
    const rupm = rupmByStatId?.get(cat.stat_id) ?? 0;
    const rawMovesFromMedian =
      rupm > 0 ? (me.projectedValue - compMedian) / rupm : 0;
    const movesFromMedian = cat.betterIs === 'higher' ? rawMovesFromMedian : -rawMovesFromMedian;

    // Find the best reachable target — rank 1 first (the win), else
    // rank 2 (still wins ~80% of weekly H2H matchups). Rank 3 is never
    // a target: it wins under 70% of matchups, so spending roster moves
    // to reach it is a poor bet. Outliers at the targeted rank are
    // skipped (locked-good for another team).
    let targetRank: number | undefined = undefined;
    let movesToTarget: number | undefined = undefined;
    if (rupm > 0 && me.rank > 1) {
      for (const tryRank of TARGET_RANKS) {
        if (tryRank >= me.rank) continue; // can't target a rank at or below mine
        const candidate = ranking.find(r => r.rank === tryRank);
        if (!candidate || candidate.isOutlier) continue;
        const gapMoves =
          Math.abs(candidate.projectedValue - me.projectedValue) / rupm;
        if (gapMoves > REACHABLE_GAP_MOVES) continue;
        targetRank = tryRank;
        movesToTarget = gapMoves;
        break; // prefer rank 1 if reachable; else fall through to rank 2
      }
    }

    entries.push({
      statId: cat.stat_id,
      name: cat.name,
      displayName: cat.display_name,
      betterIs: cat.betterIs,
      isBatterStat: cat.is_batter_stat,
      isPitcherStat: cat.is_pitcher_stat,
      ranking,
      me,
      outliers,
      competitiveMedian: compMedian,
      competitiveStdDev: compStdDev,
      zCompetitive,
      rupm,
      movesFromMedian,
      targetRank,
      movesToTarget,
    });
  }

  return {
    myTeamKey,
    teamCount: teams.length,
    weekStart,
    weekEnd,
    entries,
  };
}
