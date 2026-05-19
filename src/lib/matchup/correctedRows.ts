/**
 * Compose matchup-to-date (MTD) scoreboard MatchupRows with forward
 * projections to produce a corrected per-cat row set that `analyzeMatchup`
 * can ingest unchanged.
 *
 * Two modes:
 *
 *  - `'blend'` (default) — Mid-week behavior. For rows where Yahoo
 *    returned a comparable MTD pair, we add the rest-of-week projection
 *    on top so the margin reflects where the matchup ends, not where it
 *    sits today. Counting cats: `MTD + projected`. Rate cats (AVG, ERA,
 *    WHIP): blend the MTD rate with the projected rate, weighted by
 *    their respective denominators. K/9 / BB/9 / H/9 pass through
 *    unchanged — we don't project these.
 *
 *  - `'projection-only'` — Sunday-pivot behavior. The matchup hasn't
 *    started, so there is no MTD to blend with. Every row's value
 *    comes directly from the projection. Rows without a projection
 *    (K/9 / BB/9 / H/9) pass through unchanged.
 *
 * **Unpaired-row fallback in blend mode.** Monday morning, Yahoo doesn't
 * return MTD entries for IP / K / W / QS until pitcher games actually
 * complete; the same holds for ERA / WHIP with 0 IP. Those rows arrive
 * as em-dash baseRows. The blend-mode flow falls back to the projection-
 * only treatment for each such row — same shape as pivot mode, one row
 * at a time — so the Game Plan honors its "Counting and ratio cats use
 * forward projections when current-week stats are missing or incomplete"
 * promise instead of silently filtering those cats out.
 *
 * The two modes share the row-formatting helpers (`buildCountingCorrectedRow`,
 * `buildAvgCorrectedRow`, `buildPitcherRatioCorrectedRow`) so display
 * formatting and the `winning` flag are computed in one place.
 *
 * Why pitcher K/9 / BB/9 / H/9 stay MTD-only: we don't project them
 * separately. Rate fidelity for these stays at the per-FA `scorePitcher`
 * per-start view.
 */

import { rowHasComparablePair, type MatchupRow } from '@/components/shared/matchupRows';
import type { ProjectedCategory } from '@/lib/hooks/useBatterTeamProjection';
import { isProjectablePitcherStat } from '@/lib/projection/pitcherTeam';

/** Yahoo stat_id for AVG — the one rate-stat case in standard leagues. */
const STAT_ID_AVG = 3;
/** Yahoo stat_id for Hits — used to recover MTD AB from MTD AVG when present. */
const STAT_ID_H = 8;
/** Yahoo stat_id for Innings Pitched — used to recover MTD IP for ratio blending. */
const STAT_ID_IP = 50;

/** Yahoo stat_ids for pitcher ratio cats. */
const STAT_ID_ERA = 26;
const STAT_ID_WHIP = 27;

const PITCHER_RATIO_STAT_IDS = new Set<number>([
  STAT_ID_ERA,
  STAT_ID_WHIP,
]);

export type CorrectedRowsMode = 'blend' | 'projection-only';

export interface CorrectedRowsInput {
  baseRows: MatchupRow[];
  /** Per-cat projection for the user's team. Empty record when the
   *  projection failed / hasn't loaded yet. Combines batter + pitcher
   *  projections — same map shape, statId namespace doesn't collide. */
  myProjection: Record<number, ProjectedCategory>;
  /** Per-cat projection for the opponent. */
  oppProjection: Record<number, ProjectedCategory>;
  /** Days elapsed in the current matchup week (0-7). Used by the blend
   *  mode's AB / IP recovery fallback when stat_id 8 (H) or 50 (IP) is
   *  not a scored category. Ignored in 'projection-only' mode. */
  daysElapsed: number;
  /** Default `'blend'`. `'projection-only'` bypasses the MTD math
   *  entirely — every corrected value comes from the projection alone.
   *  Used by the Sunday streaming pivot. See module docblock. */
  mode?: CorrectedRowsMode;
}

/**
 * Apply the projection on top of (or in place of) the MTD rows. Pure:
 * inputs in, new row array out. The caller passes the result straight
 * to `analyzeMatchup`.
 */
export function composeCorrectedRows({
  baseRows,
  myProjection,
  oppProjection,
  daysElapsed,
  mode = 'blend',
}: CorrectedRowsInput): MatchupRow[] {
  if (mode === 'projection-only') {
    return baseRows.map(row => correctRowProjectionOnly(row, myProjection[row.statId], oppProjection[row.statId]));
  }

  // Recover MTD volumes once so the rate blends can use real denominators
  // when this league scores them as categories.
  const myMtdH = parseRowValue(baseRows, STAT_ID_H, 'my');
  const oppMtdH = parseRowValue(baseRows, STAT_ID_H, 'opp');
  const myMtdIP = parseRowValue(baseRows, STAT_ID_IP, 'my');
  const oppMtdIP = parseRowValue(baseRows, STAT_ID_IP, 'opp');

  return baseRows.map(row => {
    if (!rowHasComparablePair(row)) {
      // No comparable MTD pair (Monday morning before any games, IL'd
      // category, etc.). Fall back to projection-only treatment for this
      // row — same shape as pivot mode, one row at a time. Handles
      // counting cats, AVG, and pitcher ratio cats uniformly.
      return correctRowProjectionOnly(row, myProjection[row.statId], oppProjection[row.statId]);
    }

    const myProj = myProjection[row.statId];
    const oppProj = oppProjection[row.statId];
    if (!myProj && !oppProj) return row;

    if (row.isBatterStat) {
      if (row.statId === STAT_ID_AVG) {
        return correctAvgRow(row, myProj, oppProj, { myMtdH, oppMtdH, daysElapsed });
      }
      return correctCountingRow(row, myProj, oppProj);
    }

    // Pitcher row branch.
    if (PITCHER_RATIO_STAT_IDS.has(row.statId)) {
      return correctPitcherRatioRow(row, myProj, oppProj, { myMtdIP, oppMtdIP, daysElapsed });
    }
    if (!isProjectablePitcherStat(row.statId)) return row;
    return correctCountingRow(row, myProj, oppProj);
  });
}

// ---------------------------------------------------------------------------
// Projection-only path — pure-projection values, no MTD math involved.
// ---------------------------------------------------------------------------

function correctRowProjectionOnly(
  row: MatchupRow,
  myProj: ProjectedCategory | undefined,
  oppProj: ProjectedCategory | undefined,
): MatchupRow {
  // No projection on either side → pass through. Em-dash rows get filtered
  // out of consumer panels via `rowHasComparablePair`.
  if (!myProj || !oppProj) return row;

  if (row.statId === STAT_ID_AVG) {
    if (myProj.expectedDenom <= 0 || oppProj.expectedDenom <= 0) return row;
    return buildAvgCorrectedRow(
      row,
      myProj.expectedCount / myProj.expectedDenom,
      oppProj.expectedCount / oppProj.expectedDenom,
    );
  }

  if (PITCHER_RATIO_STAT_IDS.has(row.statId)) {
    if (myProj.expectedDenom <= 0 || oppProj.expectedDenom <= 0) return row;
    const eraScale = row.statId === STAT_ID_ERA ? 9 : 1;
    return buildPitcherRatioCorrectedRow(
      row,
      (myProj.expectedCount / myProj.expectedDenom) * eraScale,
      (oppProj.expectedCount / oppProj.expectedDenom) * eraScale,
    );
  }

  // Counting cats — projectable on either side (batter counting + pitcher
  // K/W/QS/IP). Un-projectable pitcher cats (K/9, BB/9, H/9) won't have a
  // projection at all and fell out at the `!myProj || !oppProj` guard above.
  if (row.isBatterStat || isProjectablePitcherStat(row.statId)) {
    return buildCountingCorrectedRow(row, myProj.expectedCount, oppProj.expectedCount);
  }
  return row;
}

// ---------------------------------------------------------------------------
// Blend path — counting + rate blenders
// ---------------------------------------------------------------------------

function correctCountingRow(
  row: MatchupRow,
  myProj: ProjectedCategory | undefined,
  oppProj: ProjectedCategory | undefined,
): MatchupRow {
  const myMtd = parseFloat(row.myVal);
  const oppMtd = parseFloat(row.oppVal);
  if (!Number.isFinite(myMtd) || !Number.isFinite(oppMtd)) return row;

  return buildCountingCorrectedRow(
    row,
    myMtd + (myProj?.expectedCount ?? 0),
    oppMtd + (oppProj?.expectedCount ?? 0),
  );
}

interface AvgContext {
  myMtdH: number | null;
  oppMtdH: number | null;
  daysElapsed: number;
}

function correctAvgRow(
  row: MatchupRow,
  myProj: ProjectedCategory | undefined,
  oppProj: ProjectedCategory | undefined,
  ctx: AvgContext,
): MatchupRow {
  const myMtdAvg = parseFloat(row.myVal);
  const oppMtdAvg = parseFloat(row.oppVal);
  if (!Number.isFinite(myMtdAvg) || !Number.isFinite(oppMtdAvg)) return row;

  return buildAvgCorrectedRow(
    row,
    blendAvg(myMtdAvg, ctx.myMtdH, myProj, ctx.daysElapsed),
    blendAvg(oppMtdAvg, ctx.oppMtdH, oppProj, ctx.daysElapsed),
  );
}

/**
 * Blend MTD AVG with projected AVG, weighted by AB share.
 *
 * Numerator/denominator path:
 *   correctedAVG = (mtdH + projH) / (mtdAB + projAB)
 *
 * The projection gives projH directly (`expectedCount`) and projAB
 * (`expectedDenom`, already scaled by AB_PER_PA at projection time).
 *
 * For MTD AB we prefer the precise H/AVG quotient when stat_id 8 (Hits) is
 * a scored category in this league. When it isn't, estimate by
 * extrapolating the projection's per-day PA pace backward across the
 * elapsed days. Imperfect but consistent with the projection's volume model.
 */
function blendAvg(
  mtdAvg: number,
  mtdH: number | null,
  proj: ProjectedCategory | undefined,
  daysElapsed: number,
): number {
  if (!proj || proj.expectedDenom <= 0) return mtdAvg;
  const projH = proj.expectedCount;
  const projAB = proj.expectedDenom;
  const projAvg = projAB > 0 ? projH / projAB : mtdAvg;

  let mtdAB: number;
  if (mtdH !== null && mtdAvg > 0) {
    mtdAB = mtdH / mtdAvg;
  } else {
    // Fall back to the projection-derived volume rate. If `daysRemaining`
    // is the projection's domain, mtdAB ≈ projAB × elapsed/remaining.
    const daysRemaining = Math.max(0.5, 7 - daysElapsed);
    const elapsedShare = Math.max(0, daysElapsed) / daysRemaining;
    mtdAB = projAB * elapsedShare;
  }

  const totalAB = mtdAB + projAB;
  if (totalAB <= 0) return mtdAvg;
  const correctedH = mtdAvg * mtdAB + projAvg * projAB;
  return correctedH / totalAB;
}

interface PitcherRatioContext {
  myMtdIP: number | null;
  oppMtdIP: number | null;
  daysElapsed: number;
}

function correctPitcherRatioRow(
  row: MatchupRow,
  myProj: ProjectedCategory | undefined,
  oppProj: ProjectedCategory | undefined,
  ctx: PitcherRatioContext,
): MatchupRow {
  const isEra = row.statId === STAT_ID_ERA;
  const myMtdRatio = parseFloat(row.myVal) || 0;
  const oppMtdRatio = parseFloat(row.oppVal) || 0;

  return buildPitcherRatioCorrectedRow(
    row,
    blendPitcherRatio(myMtdRatio, ctx.myMtdIP, myProj, ctx.daysElapsed, isEra),
    blendPitcherRatio(oppMtdRatio, ctx.oppMtdIP, oppProj, ctx.daysElapsed, isEra),
  );
}

/**
 * Blend MTD pitcher ratio (ERA/WHIP) with projected ratio, weighted by IP.
 */
function blendPitcherRatio(
  mtdRatio: number,
  mtdIP: number | null,
  proj: ProjectedCategory | undefined,
  daysElapsed: number,
  isEra: boolean,
): number {
  if (!proj || proj.expectedDenom <= 0) return mtdRatio;
  const projNum = proj.expectedCount;
  const projIP = proj.expectedDenom;

  let actualMtdIP: number;
  if (mtdIP !== null && mtdIP > 0) {
    actualMtdIP = mtdIP;
  } else {
    const daysRemaining = Math.max(0.5, 7 - daysElapsed);
    const elapsedShare = Math.max(0, daysElapsed) / daysRemaining;
    actualMtdIP = projIP * elapsedShare;
  }

  const totalIP = actualMtdIP + projIP;
  if (totalIP <= 0) return mtdRatio;

  // Recover mtdNum (ER or H+BB) from mtdRatio and mtdIP
  const mtdNum = isEra ? (mtdRatio * actualMtdIP) / 9 : mtdRatio * actualMtdIP;
  const totalNum = mtdNum + projNum;
  const finalRatio = totalIP > 0 ? (isEra ? (totalNum / totalIP) * 9 : totalNum / totalIP) : mtdRatio;

  return finalRatio;
}

// ---------------------------------------------------------------------------
// Row builders — shared between blend and projection-only modes
// ---------------------------------------------------------------------------

function buildCountingCorrectedRow(row: MatchupRow, myValue: number, oppValue: number): MatchupRow {
  return {
    ...row,
    myVal: formatCount(myValue),
    oppVal: formatCount(oppValue),
    winning: deltaWinning(myValue, oppValue, row.betterIs),
  };
}

function buildAvgCorrectedRow(row: MatchupRow, myAvg: number, oppAvg: number): MatchupRow {
  return {
    ...row,
    myVal: formatAvg(myAvg),
    oppVal: formatAvg(oppAvg),
    winning: deltaWinning(myAvg, oppAvg, row.betterIs),
  };
}

function buildPitcherRatioCorrectedRow(row: MatchupRow, myRatio: number, oppRatio: number): MatchupRow {
  return {
    ...row,
    myVal: formatPitcherRatio(myRatio),
    oppVal: formatPitcherRatio(oppRatio),
    winning: deltaWinning(myRatio, oppRatio, row.betterIs),
  };
}

function deltaWinning(my: number, opp: number, betterIs: 'higher' | 'lower'): boolean | null {
  const delta = my - opp;
  if (delta === 0) return null;
  return betterIs === 'higher' ? delta > 0 : delta < 0;
}

function parseRowValue(rows: MatchupRow[], statId: number, side: 'my' | 'opp'): number | null {
  const row = rows.find(r => r.statId === statId);
  if (!row) return null;
  const v = parseFloat(side === 'my' ? row.myVal : row.oppVal);
  return Number.isFinite(v) ? v : null;
}

/** Counting stats — display whole numbers when integral, else one decimal.
 *  The projection is fractional (expected_HR/PA × PA), so most corrected
 *  values will land on a non-integer. Keep it tight for compact display. */
function formatCount(v: number): string {
  if (Math.abs(v - Math.round(v)) < 0.05) return String(Math.round(v));
  return v.toFixed(1);
}

/** AVG stays in 3-decimal Yahoo format. */
function formatAvg(v: number): string {
  return v.toFixed(3);
}

/** ERA/WHIP use 2 decimals. */
function formatPitcherRatio(v: number): string {
  return v.toFixed(2);
}
