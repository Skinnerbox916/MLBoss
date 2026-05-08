/**
 * Matchup analysis — turn raw category rows into per-category margins,
 * priorities, and a single-scalar leverage value.
 *
 * One helper, three consumers:
 *  - BossCard `LeverageBar` reads `leverage` to size its center-origin fill.
 *  - Today / `LineupManager` seeds its batter `focusMap` from `suggestedFocus`.
 *  - Streaming / `StreamingManager` seeds its pitcher `focusMap` the same way.
 *
 * The math splits into two flavors. Counting stats use a week-elapsed model so
 * "HR 8-5" feels different on Wednesday than on Sunday — the same gap is much
 * harder to close late in the week because there's less production left to
 * accrue. Rate stats use a per-stat "typical-swing" scale and soften early-
 * week confidence so a small Monday sample doesn't read as locked.
 *
 * Both branches output a margin in [-1, +1] from the user's perspective. A
 * margin of 0 is dead-even / no data; a magnitude near 1 reads as "locked".
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

import type { MatchupRow } from '@/components/shared/matchupRows';

/**
 * Typical-swing scale per rate stat — the gap that, on its own, corresponds
 * to a "decent lead" (margin ~1.0 before confidence softening). Calibrated
 * for standard 5x5 / 6x6 leagues; deriving these from league averages is a
 * v2 once defaults are observed to misbehave.
 */
const RATE_SCALE: Record<string, number> = {
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

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export type SuggestedFocus = 'chase' | 'neutral' | 'punt';

export interface AnalyzedMatchupRow extends MatchupRow {
  /** Margin in [-1, +1] from the user's perspective. Positive = winning.
   *  When the analysis is corrected with projections, this is the
   *  projected end-of-week margin; otherwise it's the YTD margin. */
  margin: number;
  /** Priority weight in [0, 1]. 1 = toss-up, 0 = locked. */
  priority: number;
  /** Mapped onto the existing chase/neutral/punt vocabulary. */
  suggestedFocus: SuggestedFocus;
  /** Margin from YTD-only rows, populated by `withSwing` when both raw
   *  and corrected analyses are available. Undefined when this analysis
   *  ran on a single set of rows (e.g. dashboard descriptive surfaces). */
  rawMargin?: number;
  /** `margin - rawMargin`. Positive swing = projection improves the
   *  user's standing; negative swing = projection erodes it. Undefined
   *  unless both margins are available. */
  swing?: number;
  /** YTD-only stat values as strings (matching `myVal`/`oppVal` format).
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

const LOCKED_THRESHOLD = 0.7;

/**
 * Does this row carry enough signal to drive a recommendation?
 *
 * Beyond the obvious `!hasData` case (Yahoo omitted the value entirely —
 * typical for ratio stats with 0 IP / 0 AB), we also treat a row where
 * both sides are exactly zero as no-signal. This is the Monday-morning
 * pattern: Yahoo returns "0" for every counting stat (so `hasData=true`,
 * `margin=0`) before any games have completed. Without this guard every
 * counting cat would land in `chase` (since `margin === 0` triggers the
 * losing/tied branch), making the rate cats — which are correctly missing
 * — look like they were "demoted" by the engine.
 */
function hasMatchupSignal(row: MatchupRow): boolean {
  if (!row.hasData) return false;
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
 * The function operates purely on the row's `name` (Yahoo abbreviation, e.g.
 * "AVG") to decide rate vs. counting; the `betterIs` field handles "lower is
 * better" stats like ERA / WHIP transparently.
 */
function computeMargin(row: MatchupRow, weekProgress: number): number {
  if (!row.hasData) return 0;
  const my = parseFloat(row.myVal);
  const opp = parseFloat(row.oppVal);
  if (!Number.isFinite(my) || !Number.isFinite(opp)) return 0;

  const dir = row.betterIs === 'lower' ? -1 : 1;
  const scale = RATE_SCALE[row.name];

  if (scale !== undefined) {
    const confidence = 0.15 + 0.85 * weekProgress;
    return clamp(((my - opp) * dir / scale) * confidence, -1, 1);
  }

  // Counting stat: scale gap by expected remaining production.
  const expectedRemaining = ((my + opp) / weekProgress) * (1 - weekProgress);
  return clamp(((my - opp) * dir) / Math.max(expectedRemaining, 1), -1, 1);
}

export interface AnalyzeOpts {
  /**
   * Days elapsed in the current Mon-Sun matchup week. Fractional values
   * (e.g. 2.5 to represent "midway through Wednesday") are fine — the math
   * uses `daysElapsed / 7` to derive week progress.
   */
  daysElapsed: number;
}

/**
 * Decorate each row with margin/priority/suggested focus, plus aggregate
 * leverage and counts. Pure: same inputs → same outputs.
 */
export function analyzeMatchup(
  rows: MatchupRow[],
  { daysElapsed }: AnalyzeOpts,
): MatchupAnalysis {
  const weekProgress = clamp(daysElapsed / 7, 0.1, 1);

  const decorated: AnalyzedMatchupRow[] = rows.map(row => {
    const hasSignal = hasMatchupSignal(row);
    const margin = hasSignal ? computeMargin(row, weekProgress) : 0;
    return {
      ...row,
      margin,
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
