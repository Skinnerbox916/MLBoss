/**
 * Compose YTD scoreboard MatchupRows with forward projections to produce
 * a corrected per-cat row set that `analyzeMatchup` can ingest unchanged.
 *
 * The correction targets the YTD-scoreboard lag: when a team has IL'd
 * stars returning, just made roster moves, or differs from their
 * accumulated stats for any other reason, the YTD row understates what
 * the matchup will look like by Sunday. We add projected output for the
 * remaining days into both sides and let the existing margin / leverage
 * math run on the corrected totals.
 *
 * Scope:
 *   - Batter rows: AVG gets the rate blend, all other counting cats
 *     get a straight YTD + projected count.
 *   - Pitcher rows: counting cats only (K, W, QS, IP, etc.). Ratio
 *     cats (ERA, WHIP, K/9, BB/9, H/9) pass through YTD unchanged —
 *     the engineering tradeoff per the design discussion is that ratio
 *     fidelity stays at the per-FA `scorePitcher` per-start view, not
 *     baked into the matchup margin.
 */

import type { MatchupRow } from '@/components/shared/matchupRows';
import type { ProjectedCategory } from '@/lib/hooks/useBatterTeamProjection';
import { isProjectablePitcherStat } from '@/lib/projection/pitcherTeam';

/** Yahoo stat_id for AVG — the one rate-stat case in standard leagues. */
const STAT_ID_AVG = 3;
/** Yahoo stat_id for Hits — used to recover ytdAB from ytdAVG when present. */
const STAT_ID_H = 8;

/** Yahoo stat_ids for pitcher ratio cats. These pass through YTD on the
 *  corrected row set; their per-FA fidelity is surfaced separately by
 *  `scorePitcher` per-start sub-scores. Keep in sync with
 *  `RATIO_PITCHER_STAT_IDS` in `lib/projection/pitcherTeam.ts`. */
const PITCHER_RATIO_STAT_IDS = new Set<number>([
  26, // ERA
  27, // WHIP
]);

export interface CorrectedRowsInput {
  baseRows: MatchupRow[];
  /** Per-cat projection for the user's team. Empty record when the
   *  projection failed / hasn't loaded yet. Combines batter + pitcher
   *  projections — same map shape, statId namespace doesn't collide. */
  myProjection: Record<number, ProjectedCategory>;
  /** Per-cat projection for the opponent. */
  oppProjection: Record<number, ProjectedCategory>;
  /** Days elapsed in the current matchup week (0-7). Used to fall back
   *  to a YTD-AB estimate when stat_id 8 (H) isn't in the row set. */
  daysElapsed: number;
}

/**
 * Apply the projection on top of the YTD rows. Pure: inputs in, new row
 * array out. The caller passes the result straight to `analyzeMatchup`.
 */
export function composeCorrectedRows({
  baseRows,
  myProjection,
  oppProjection,
  daysElapsed,
}: CorrectedRowsInput): MatchupRow[] {
  // Recover YTD H once so the AVG rate blend can use a real denominator
  // when this league scores Hits as a category.
  const myYtdH = parseRowValue(baseRows, STAT_ID_H, 'my');
  const oppYtdH = parseRowValue(baseRows, STAT_ID_H, 'opp');

  return baseRows.map(row => {
    if (!row.hasData) return row;
    const myProj = myProjection[row.statId];
    const oppProj = oppProjection[row.statId];
    if (!myProj && !oppProj) return row;

    if (row.isBatterStat) {
      if (row.statId === STAT_ID_AVG) {
        return correctAvgRow(row, myProj, oppProj, { myYtdH, oppYtdH, daysElapsed });
      }
      return correctCountingRow(row, myProj, oppProj);
    }

    // Pitcher row branch: counting cats only. Ratio cats pass through.
    if (PITCHER_RATIO_STAT_IDS.has(row.statId)) return row;
    if (!isProjectablePitcherStat(row.statId)) return row;
    return correctCountingRow(row, myProj, oppProj);
  });
}

function correctCountingRow(
  row: MatchupRow,
  myProj: ProjectedCategory | undefined,
  oppProj: ProjectedCategory | undefined,
): MatchupRow {
  const myYtd = parseFloat(row.myVal);
  const oppYtd = parseFloat(row.oppVal);
  if (!Number.isFinite(myYtd) || !Number.isFinite(oppYtd)) return row;

  const myCorrected = myYtd + (myProj?.expectedCount ?? 0);
  const oppCorrected = oppYtd + (oppProj?.expectedCount ?? 0);
  const delta = myCorrected - oppCorrected;
  const winning = delta === 0 ? null : row.betterIs === 'higher' ? delta > 0 : delta < 0;

  return {
    ...row,
    myVal: formatCount(myCorrected),
    oppVal: formatCount(oppCorrected),
    winning,
  };
}

interface AvgContext {
  myYtdH: number | null;
  oppYtdH: number | null;
  daysElapsed: number;
}

function correctAvgRow(
  row: MatchupRow,
  myProj: ProjectedCategory | undefined,
  oppProj: ProjectedCategory | undefined,
  ctx: AvgContext,
): MatchupRow {
  const myYtdAvg = parseFloat(row.myVal);
  const oppYtdAvg = parseFloat(row.oppVal);
  if (!Number.isFinite(myYtdAvg) || !Number.isFinite(oppYtdAvg)) return row;

  const myCorrected = blendAvg(myYtdAvg, ctx.myYtdH, myProj, ctx.daysElapsed);
  const oppCorrected = blendAvg(oppYtdAvg, ctx.oppYtdH, oppProj, ctx.daysElapsed);

  const delta = myCorrected - oppCorrected;
  const winning = delta === 0 ? null : row.betterIs === 'higher' ? delta > 0 : delta < 0;

  return {
    ...row,
    myVal: formatAvg(myCorrected),
    oppVal: formatAvg(oppCorrected),
    winning,
  };
}

/**
 * Blend YTD AVG with projected AVG, weighted by AB share.
 *
 * Numerator/denominator path:
 *   correctedAVG = (ytdH + projH) / (ytdAB + projAB)
 *
 * The projection gives projH directly (`expectedCount`) and projAB
 * (`expectedDenom`, already scaled by AB_PER_PA at projection time).
 *
 * For YTD AB we prefer the precise H/AVG quotient when stat_id 8 (Hits) is
 * a scored category in this league. When it isn't, estimate by
 * extrapolating the projection's per-day PA pace backward across the
 * elapsed days. Imperfect but consistent with the projection's volume model.
 */
function blendAvg(
  ytdAvg: number,
  ytdH: number | null,
  proj: ProjectedCategory | undefined,
  daysElapsed: number,
): number {
  if (!proj || proj.expectedDenom <= 0) return ytdAvg;
  const projH = proj.expectedCount;
  const projAB = proj.expectedDenom;
  const projAvg = projAB > 0 ? projH / projAB : ytdAvg;

  let ytdAB: number;
  if (ytdH !== null && ytdAvg > 0) {
    ytdAB = ytdH / ytdAvg;
  } else {
    // Fall back to the projection-derived volume rate. If `daysRemaining`
    // is the projection's domain, ytdAB ≈ projAB × elapsed/remaining.
    const daysRemaining = Math.max(0.5, 7 - daysElapsed);
    const elapsedShare = Math.max(0, daysElapsed) / daysRemaining;
    ytdAB = projAB * elapsedShare;
  }

  const totalAB = ytdAB + projAB;
  if (totalAB <= 0) return ytdAvg;
  const correctedH = ytdAvg * ytdAB + projAvg * projAB;
  return correctedH / totalAB;
}

function parseRowValue(rows: MatchupRow[], statId: number, side: 'my' | 'opp'): number | null {
  const row = rows.find(r => r.statId === statId && r.hasData);
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
