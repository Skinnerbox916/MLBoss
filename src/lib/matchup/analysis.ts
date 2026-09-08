/**
 * Matchup analysis — turn raw category rows into per-category margins,
 * priorities, and a single-scalar leverage value.
 *
 * One helper, three consumers:
 *  - BossCard `LeverageBar` reads `leverage` to size its center-origin fill.
 *  - Today / `LineupManager` seeds its batter `focusMap` from `suggestedFocus`.
 *  - Streaming / `StreamingManager` seeds its pitcher `focusMap` the same way.
 *
 * **Margin is a win probability** (2026-09-08). Every category's gap is
 * divided by the standard deviation of that gap — built from how much
 * production each side still has coming and the category's fitted
 * dispersion — and the resulting z-score becomes the margin. See
 * [categoryVariance.ts](./categoryVariance.ts) for the model, the fitted
 * constants, and the probability each threshold corresponds to. The short
 * version: margin is `PIVOTALITY_W × z` clamped to ±1, so 0 is a coin
 * flip, ±0.7 (`LOCKED_THRESHOLD`) is ~97.7%, and the ±1 clamp is ~99.8%.
 *
 * Both analysis modes reach that same quantity, differing only in where
 * "remaining production" comes from:
 *
 *   - `'raw'` (default — matchup-to-date scoreboard rows): pace
 *     extrapolation from what each side has banked so far.
 *   - `'corrected'` (end-of-week projected rows): the rest-of-week
 *     projection itself, carried onto each row as `gapSigma` by
 *     `composeCorrectedRows`. Only `useCorrectedMatchupAnalysis` passes
 *     this mode.
 *
 * Because the spread shrinks as the week empties out, time awareness is
 * automatic in both modes and no separate week-progress fudge is needed.
 *
 * `RATE_SCALE` and `CORRECTED_COUNTING_SCALE` survive only as fallbacks for
 * rows the variance model can't reach (an unprojected category, an exotic
 * scored stat). They are the pre-2026-09-08 model; don't extend them.
 *
 * "No signal" is treated identically to "no data" everywhere downstream
 * (suggestedFocus stays `neutral`, leverage / contested counts skip the
 * row). See `hasMatchupSignal` for the exact rule — the most important
 * non-obvious case is Monday morning, where every counting cat reads
 * `0=0` because no games have finished yet.
 *
 * `suggestedFocus` is direction-aware: a category you're losing or tied
 * in is `chase`, a category you're winning that isn't locked is `neutral`
 * (hold), and either extreme (locked win OR out-of-reach loss) is `punt`.
 * The focus engine intentionally does NOT use a magnitude band for
 * "contested" — we lean on the corrected margin (when projection data
 * is available via `withSwing`) to decide direction, and the projection
 * already incorporates rest-of-week confidence.
 */

import { rowHasComparablePair, type MatchupRow } from '@/components/shared/matchupRows';
import { countingGapSigma, marginFromGap } from './categoryVariance';

/**
 * FALLBACK ONLY. Typical-swing scale per rate stat, used when a row carries
 * no measured `gapSigma` — an unprojected rate cat, or a matchup-to-date row
 * analyzed outside the corrected composer. Where the projection exists,
 * `ratioGapSigma` supersedes this with a real spread.
 *
 * Also the list that identifies which categories ARE rate stats, which is
 * why entries stay here for cats the projection can't reach (OBP, SLG, OPS,
 * K/9, BB/9, H/9).
 */
export const RATE_SCALE: Record<string, number> = {
  AVG: 0.040,
  OBP: 0.040,
  SLG: 0.080,
  OPS: 0.100,
  ERA: 0.50,
  WHIP: 0.10,
  K9: 1.5,
  BB9: 1.0,
  H9: 1.5,
};

/**
 * FALLBACK ONLY, and superseded. These were eyeballed at "~1.0-1.4× the
 * cross-team σ of full-week production" with a note to revisit once
 * projection-vs-realized data accumulated. It has, and
 * [categoryVariance.ts](./categoryVariance.ts) now derives the spread per
 * matchup from fitted dispersion and remaining production.
 *
 * What made them wrong was not the levels but the shape: a constant can't
 * know how much production is left, and the ±1 clamp collapsed every lead
 * past its constant onto the same "locked" value. On 2026-09-08 that put a
 * 3.7-steal lead (85-92% to hold) and a 43.7-total-base lead (97-99.6%) at
 * the identical margin of 1.00, and `pivotality` zeroed both.
 *
 * Still reached when a corrected row has no projection on one side.
 * Keyed by `stat_id` (not display_name) because batter K (21) and
 * pitcher K (42) share a label.
 */
export const CORRECTED_COUNTING_SCALE: Record<number, number> = {
  // Batter counting cats
  7: 8,    // R
  8: 12,   // H
  12: 4,   // HR
  13: 9,   // RBI
  16: 3,   // SB
  18: 7,   // BB (batter)
  21: 10,  // K  (batter, lower-better)
  23: 20,  // TB
  // Pitcher counting cats
  50: 15,  // IP
  28: 2,   // W
  32: 2,   // SV
  42: 18,  // K  (pitcher)
  83: 2,   // QS
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export type SuggestedFocus = 'chase' | 'neutral' | 'punt';

export interface AnalyzedMatchupRow extends MatchupRow {
  /** Margin in [-1, +1] from the user's perspective. Positive = winning.
   *  `PIVOTALITY_W × z`, where z is the gap over its standard deviation —
   *  so it maps to a win probability (0 = coin flip, ±0.7 ≈ 97.7%, ±1
   *  ≈ 99.8%). When the analysis is corrected with projections this is the
   *  projected end-of-week margin; otherwise it's the matchup-to-date one. */
  margin: number;
  /** True when `streamCapacity` softened this row's deficit — the raw
   *  projected gap reads worse, but remaining streams can close it.
   *  Drives the "in reach via streams" tile status. */
  streamAssisted?: boolean;
  /** Priority weight in [0, 1]. 1 = toss-up, 0 = locked. `1 - |margin|`,
   *  so the `>= 0.5` contested test is a win probability between roughly
   *  7.6% and 92.4%. */
  priority: number;
  /** Mapped onto the existing chase/neutral/punt vocabulary. */
  suggestedFocus: SuggestedFocus;
  /** Margin from matchup-to-date-only rows, populated by `withSwing` when
   *  both raw and corrected analyses are available. Undefined when this
   *  analysis ran on a single set of rows (e.g. the projection-only Sunday
   *  pivot, or dashboard descriptive surfaces). */
  rawMargin?: number;
  /** `margin - rawMargin`. Positive swing = projection improves the
   *  user's standing; negative swing = projection erodes it. Undefined
   *  unless both margins are available. */
  swing?: number;
  /** Matchup-to-date-only stat values as strings (matching `myVal`/`oppVal` format).
   *  Populated by `withSwing` so consumers can render
   *  "current → projected" displays. Undefined unless both analyses
   *  were combined. */
  rawMyVal?: string;
  rawOppVal?: string;
}

export interface MatchupAnalysis {
  /** Decorated rows in the same order they came in. */
  rows: AnalyzedMatchupRow[];
  /** Mean of `margin` across rows that carry signal. Range: [-1, +1]. */
  leverage: number;
  /** Number of contested categories (priority >= 0.5 and signal-bearing). */
  contestedCount: number;
  /** Number of locked categories (|margin| >= 0.7 and signal-bearing). */
  lockedCount: number;
}

/**
 * |margin| at or above this reads as decided — a locked win on the positive
 * side, out of reach on the negative. In probability terms it is a z of 2.0,
 * so ~97.7% / ~2.3%. See [categoryVariance.ts](./categoryVariance.ts) for
 * the full margin-to-probability table.
 */
export const LOCKED_THRESHOLD = 0.7;

/**
 * Does this row carry enough signal to drive a recommendation?
 *
 * When `rowHasComparablePair` is false (one or both sides missing / non-
 * numeric — typical for ratio stats with 0 IP / 0 AB), there is no signal.
 * We also treat a row where both sides are exactly zero as no-signal. This
 * is the Monday-morning pattern: Yahoo returns "0" for every counting stat
 * (so the row is comparable but `0=0`) before any games have completed. Without
 * this guard every counting cat would land in `chase` (since `margin === 0`
 * triggers the losing/tied branch), making the rate cats — which are correctly
 * missing — look like they were "demoted" by the engine.
 */
function hasMatchupSignal(row: MatchupRow): boolean {
  if (!rowHasComparablePair(row)) return false;
  const my = parseFloat(row.myVal);
  const opp = parseFloat(row.oppVal);
  if (!Number.isFinite(my) || !Number.isFinite(opp)) return false;
  return !(my === 0 && opp === 0);
}

/**
 * Direction-aware focus suggestion.
 *
 * The vocabulary stays `chase | neutral | punt`, but the boundaries are
 * sign-aware:
 *  - `|margin| ≥ LOCKED`  → punt (locked win OR out-of-reach loss — both
 *    extremes mean "don't sacrifice lineup optimization for this cat")
 *  - `margin ≤ 0`         → chase (you're losing or tied — these are the
 *    pickup / lineup-tilt targets)
 *  - `0 < margin < LOCKED` → neutral (winning but not locked — "hold")
 *
 * The previous direction-blind logic flagged any `|margin| < 0.4` band as
 * chase, which produced "chase everything" on the streaming page when many
 * corrected margins clustered near zero. Direction matters: a slim lead
 * doesn't need a stream pickup, while a slim deficit does.
 */
function suggestFocus(margin: number, hasSignal: boolean): SuggestedFocus {
  if (!hasSignal) return 'neutral';
  if (Math.abs(margin) >= LOCKED_THRESHOLD) return 'punt';
  if (margin <= 0) return 'chase';
  return 'neutral';
}

/**
 * Compute a per-row margin in [-1, +1] using the right model for the stat.
 *
 * Rate stats (AVG, ERA, WHIP, …) use a fixed `RATE_SCALE` plus a week-
 * progress confidence factor.
 *
 * Counting stats branch on `mode`:
 *  - `'raw'`: gap scaled by `expectedRemaining` = pace-extrapolated
 *    remaining production. Right model for matchup-to-date scoreboard rows where
 *    rest-of-week production is unknown and "lots of games left" should
 *    shrink the margin.
 *  - `'corrected'`: gap scaled by `CORRECTED_COUNTING_SCALE` — a fixed
 *    per-cat residual-uncertainty scale. Right model for end-of-week
 *    projected rows where rest-of-week production is already baked in,
 *    so a remaining-production buffer double-counts and over-compresses
 *    the gap.
 */
function computeMargin(
  row: MatchupRow,
  weekProgress: number,
  mode: AnalyzeMode,
  streamCapacity?: Record<number, number>,
): { margin: number; streamAssisted: boolean } {
  if (!rowHasComparablePair(row)) return { margin: 0, streamAssisted: false };
  const my = parseFloat(row.myVal);
  const opp = parseFloat(row.oppVal);
  if (!Number.isFinite(my) || !Number.isFinite(opp)) return { margin: 0, streamAssisted: false };

  const dir = row.betterIs === 'lower' ? -1 : 1;
  const isRateStat = RATE_SCALE[row.name] !== undefined;

  let gap = (my - opp) * dir;
  let streamAssisted = false;
  // Stream-capacity softening for losing counting rows (see
  // AnalyzeOpts.streamCapacity): the deficit is measured net of what
  // the user's remaining moves could add, capped at even. SV carries
  // no capacity entry (SP streams can't make saves), so a save deficit
  // is never softened — it auto-concedes on its own margin when the
  // opponent's projected saves are large enough, and stays chase-able
  // when they aren't (user concedes manually in that case).
  if (mode === 'corrected' && !isRateStat) {
    const capacity = streamCapacity?.[row.statId];
    if (capacity !== undefined && capacity > 0 && gap < 0) {
      const softened = Math.min(0, gap + capacity);
      streamAssisted = softened !== gap;
      gap = softened;
    }
  }

  // Preferred path: the corrected-row composer measured how much
  // production each side still has coming, so the gap can be read as a
  // win probability instead of against a hand-set constant.
  if (row.gapSigma !== undefined && row.gapSigma > 0) {
    return { margin: marginFromGap(gap, row.gapSigma), streamAssisted };
  }

  // Rate stat with no measured spread (unprojected, or a matchup-to-date
  // row that never went through the composer). Legacy scale.
  if (isRateStat) {
    const confidence = 0.15 + 0.85 * weekProgress;
    return { margin: clamp((gap / RATE_SCALE[row.name]) * confidence, -1, 1), streamAssisted };
  }

  // Corrected counting row whose projection was missing. Legacy scale.
  if (mode === 'corrected') {
    const countScale = CORRECTED_COUNTING_SCALE[row.statId];
    if (countScale !== undefined) {
      return { margin: clamp(gap / countScale, -1, 1), streamAssisted };
    }
    // Unknown counting cat — fall through to the raw model rather than
    // returning 0. Better to under-call punt than to silently hide a row.
  }

  // Counting stat, matchup-to-date. There is no projection here, but pace
  // extrapolation gives the remaining production each side should accrue,
  // which is the same quantity the corrected path gets from the projection —
  // so the same variance model applies and the two modes agree on what a
  // margin means.
  const remainingScale = (1 - weekProgress) / weekProgress;
  const sigma = countingGapSigma(row.statId, my * remainingScale, opp * remainingScale);
  if (sigma !== null) {
    return { margin: marginFromGap(gap, sigma), streamAssisted };
  }

  // No fitted dispersion for this category at all (an exotic scored stat).
  const expectedRemaining = ((my + opp) / weekProgress) * (1 - weekProgress);
  return { margin: clamp(gap / Math.max(expectedRemaining, 1), -1, 1), streamAssisted };
}

export type AnalyzeMode = 'raw' | 'corrected';

export interface AnalyzeOpts {
  /**
   * Days elapsed in the current matchup week. Fractional values
   * (e.g. 2.5 to represent "midway through Wednesday") are fine — the math
   * uses `daysElapsed / weekLengthDays` to derive week progress.
   */
  daysElapsed: number;
  /**
   * Total days in the matchup week. Usually 7, but Yahoo's calendar has
   * irregular weeks (short week 1, ~14-day combined all-star week) —
   * callers with real `WeekBounds` pass the actual span so week progress
   * doesn't max out halfway through a long week.
   */
  weekLengthDays?: number;
  /**
   * Which counting-stat margin model to use. `'raw'` (default) is right
   * for matchup-to-date scoreboard rows; `'corrected'` is right for rows
   * that already carry end-of-week projections (see `CORRECTED_COUNTING_SCALE`).
   * Only `useCorrectedMatchupAnalysis` should pass `'corrected'` — every
   * other caller analyzes matchup-to-date-only inputs.
   */
  mode?: AnalyzeMode;
  /**
   * statId → units the USER could still add via streaming this week
   * (remaining moves × league-average per-start yield — pitcher counting
   * cats only; see `LEAGUE_AVG_START_OUTPUT`). Applied in `'corrected'`
   * mode to LOSING counting rows only: the gap is softened by the
   * realizable stream volume, capped at even (reachability, never a
   * projected lead). Without this, a stream-closable deficit reads
   * "out of reach", auto-concedes, zeroes its pivotality weight — and the
   * streaming board stops valuing the very cats streaming would win (the
   * 2026-07-21 circular-concession report). One stream adds to K/W/QS/IP
   * simultaneously, so the same capacity applies per-cat without
   * double-counting. Deliberately absent for ratio cats (added volume can't
   * reliably fix an ERA/WHIP gap) and batter cats (batter adds displace, so
   * net gain is small).
   *
   * This is the user's LEVER, not a forecast — which is why it stays
   * one-sided. The opponent's streaming is modeled where it belongs, as
   * expected volume inside their projection, and only on the next-week
   * pivot (`applyExpectedStreams` in projection/streamVolume.ts). Callers
   * that price expected streams into the rows must pass the RESIDUAL
   * capacity (cap − expected), or the same moves get counted twice.
   */
  streamCapacity?: Record<number, number>;
}

/**
 * Decorate each row with margin/priority/suggested focus, plus aggregate
 * leverage and counts. Pure: same inputs → same outputs.
 */
export function analyzeMatchup(
  rows: MatchupRow[],
  { daysElapsed, weekLengthDays = 7, mode = 'raw', streamCapacity }: AnalyzeOpts,
): MatchupAnalysis {
  const weekProgress = clamp(daysElapsed / Math.max(weekLengthDays, 1), 0.1, 1);

  const decorated: AnalyzedMatchupRow[] = rows.map(row => {
    const hasSignal = hasMatchupSignal(row);
    const computed = hasSignal
      ? computeMargin(row, weekProgress, mode, streamCapacity)
      : { margin: 0, streamAssisted: false };
    const { margin, streamAssisted } = computed;
    return {
      ...row,
      margin,
      streamAssisted,
      priority: hasSignal ? 1 - Math.abs(margin) : 1,
      suggestedFocus: suggestFocus(margin, hasSignal),
    };
  });

  // Aggregate over signal-bearing rows only: a Monday-morning matchup where
  // every counting cat reads 0=0 should produce a flat leverage and zero
  // contested cats, not a fully-contested no-op.
  const signal = rows.map(hasMatchupSignal);
  const live = decorated.filter((_, i) => signal[i]);
  const leverage = live.length > 0
    ? live.reduce((sum, r) => sum + r.margin, 0) / live.length
    : 0;
  const contestedCount = live.filter(r => r.priority >= 0.5).length;
  const lockedCount = live.filter(r => Math.abs(r.margin) >= LOCKED_THRESHOLD).length;

  return { rows: decorated, leverage, contestedCount, lockedCount };
}

/**
 * Decorate a corrected analysis with the parallel raw analysis's per-cat
 * margin so consumers can show "currently losing but projected to win"
 * style explanations and so swing magnitude is available for UI grading.
 *
 * The focus suggestion on the corrected analysis already reflects the
 * projected end-of-week direction (`chase` for projected losses, `hold`
 * for projected leads); swing is purely additive context. If you want to
 * recompute focus from raw and corrected together, do it in the consumer —
 * the canonical engine treats corrected margin as the source of truth.
 *
 * Pitcher rows pass through `composeCorrectedRows` unchanged, so their
 * `swing` will be 0 — no extra logic needed in the consumer.
 */
export function withSwing(
  corrected: MatchupAnalysis,
  raw: MatchupAnalysis,
): MatchupAnalysis {
  const rawByStatId = new Map(raw.rows.map(r => [r.statId, r]));
  const rows: AnalyzedMatchupRow[] = corrected.rows.map(row => {
    const rawRow = rawByStatId.get(row.statId);
    if (!rawRow) return row;
    return {
      ...row,
      rawMargin: rawRow.margin,
      swing: row.margin - rawRow.margin,
      rawMyVal: rawRow.myVal,
      rawOppVal: rawRow.oppVal,
    };
  });
  return { ...corrected, rows };
}
