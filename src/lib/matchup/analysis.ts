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
  /** Mean of `margin` across rows where `hasData`. Range: [-1, +1]. */
  leverage: number;
  /** Number of contested categories (priority >= 0.5 and hasData). */
  contestedCount: number;
  /** Number of locked categories (|margin| >= 0.7 and hasData). */
  lockedCount: number;
}

const LOCKED_THRESHOLD = 0.7;
const CONTESTED_THRESHOLD = 0.4;

function suggestFocus(margin: number, hasData: boolean): SuggestedFocus {
  if (!hasData) return 'neutral';
  const abs = Math.abs(margin);
  if (abs >= LOCKED_THRESHOLD) return 'punt';
  if (abs < CONTESTED_THRESHOLD) return 'chase';
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
    const confidence = 0.5 + 0.5 * weekProgress;
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
    const margin = computeMargin(row, weekProgress);
    return {
      ...row,
      margin,
      priority: row.hasData ? 1 - Math.abs(margin) : 1,
      suggestedFocus: suggestFocus(margin, row.hasData),
    };
  });

  const live = decorated.filter(r => r.hasData);
  const leverage = live.length > 0
    ? live.reduce((sum, r) => sum + r.margin, 0) / live.length
    : 0;
  const contestedCount = live.filter(r => r.priority >= 0.5).length;
  const lockedCount = live.filter(r => Math.abs(r.margin) >= LOCKED_THRESHOLD).length;

  return { rows: decorated, leverage, contestedCount, lockedCount };
}
