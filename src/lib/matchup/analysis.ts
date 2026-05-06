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
  /** Margin in [-1, +1] from the user's perspective. Positive = winning. */
  margin: number;
  /** Priority weight in [0, 1]. 1 = toss-up, 0 = locked. */
  priority: number;
  /** Mapped onto the existing chase/neutral/punt vocabulary. */
  suggestedFocus: SuggestedFocus;
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
const CONTESTED_THRESHOLD = 0.4;

/**
 * Does this row carry enough signal to drive a recommendation?
 *
 * Beyond the obvious `!hasData` case (Yahoo omitted the value entirely —
 * typical for ratio stats with 0 IP / 0 AB), we also treat a row where
 * both sides are exactly zero as no-signal. This is the Monday-morning
 * pattern: Yahoo returns "0" for every counting stat (so `hasData=true`,
 * `margin=0`) before any games have completed. Without this guard every
 * counting cat would land in `chase` (since `|0| < CONTESTED_THRESHOLD`),
 * making the rate cats — which are correctly missing — look like they
 * were "demoted" by the engine.
 */
function hasMatchupSignal(row: MatchupRow): boolean {
  if (!row.hasData) return false;
  const my = parseFloat(row.myVal);
  const opp = parseFloat(row.oppVal);
  if (!Number.isFinite(my) || !Number.isFinite(opp)) return false;
  return !(my === 0 && opp === 0);
}

function suggestFocus(margin: number, hasSignal: boolean, weekProgress: number): SuggestedFocus {
  if (!hasSignal) return 'neutral';
  const abs = Math.abs(margin);
  if (abs >= LOCKED_THRESHOLD) return 'punt';
  // Tighten the chase threshold early in the week so we don't flag everything
  // as contested. Tuesday: ~0.15; Friday: ~0.29; Sunday: 0.40. When the whole
  // board is unsettled, only the genuinely closest categories should chase.
  const chaseThreshold = CONTESTED_THRESHOLD * (0.2 + 0.8 * weekProgress);
  if (abs < chaseThreshold) return 'chase';
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
      suggestedFocus: suggestFocus(margin, hasSignal, weekProgress),
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
