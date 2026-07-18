/**
 * Fantasy points earned by an ACTUAL game line — the grading twin of the
 * forecast dot-product in src/lib/points/pointsValue.ts. Same stat_id
 * vocabulary as src/lib/points/rateVector.ts; same unit conventions
 * (stat 33 is scored per OUT — rateVector pins perIP[33] = 3, so the
 * Yahoo weight is per out, and actual outs multiply it directly).
 *
 * Weights cover only what the league scores; missing ids contribute 0.
 * Keys of the line objects match the jsonb shapes score.ts materializes
 * into player_game_actuals.
 */

export function actualBatterPoints(
  weights: Record<number, number>,
  b: Record<string, number>,
): number {
  const w = (id: number) => weights[id] ?? 0;
  return (
    w(7) * (b.r ?? 0) +
    w(8) * (b.h ?? 0) +
    w(9) * (b.singles ?? 0) +
    w(10) * (b.doubles ?? 0) +
    w(11) * (b.triples ?? 0) +
    w(12) * (b.hr ?? 0) +
    w(13) * (b.rbi ?? 0) +
    w(16) * (b.sb ?? 0) +
    w(18) * (b.bb ?? 0) +
    w(20) * (b.hbp ?? 0) +
    w(21) * (b.k ?? 0) +
    w(23) * (b.tb ?? 0)
  );
}

export function actualPitcherPoints(
  weights: Record<number, number>,
  p: Record<string, number>,
): number {
  const w = (id: number) => weights[id] ?? 0;
  return (
    w(28) * (p.w ?? 0) +
    w(32) * (p.sv ?? 0) +
    w(33) * (p.outs ?? 0) +
    w(34) * (p.h ?? 0) +
    w(37) * (p.er ?? 0) +
    w(39) * (p.bb ?? 0) +
    w(41) * (p.hb ?? 0) +
    w(42) * (p.k ?? 0)
  );
}
