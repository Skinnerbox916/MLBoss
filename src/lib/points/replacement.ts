/**
 * Replacement-level value for points leagues.
 *
 * "Value over replacement" answers the question every roster/streaming
 * decision reduces to: is this player worth more than what I could grab for
 * free at his position? Replacement level = the weekly points of a readily
 * available player at that position (default: the ~3rd-best free agent, a
 * stable "you can always get this" floor — the single best overstates it
 * since you can only claim one).
 *
 * Inputs are talent-neutral weekly values (Phase 1 `*PointsValue.weeklyPoints`)
 * so the baseline reflects sustainable role value, not a hot week.
 */

const OF_ALIASES = new Set(['OF', 'LF', 'CF', 'RF']);
/** Generic / non-scoring slots that don't define a talent pool. */
const SKIP_POSITIONS = new Set(['UTIL', 'BN', 'IL', 'IL+', 'NA', 'DH', 'P']);

/** Collapse Yahoo position variants to canonical pool keys. */
export function canonicalPositions(eligible: string[]): string[] {
  const out = new Set<string>();
  for (const p of eligible) {
    const up = p.toUpperCase();
    if (SKIP_POSITIONS.has(up)) continue;
    out.add(OF_ALIASES.has(up) ? 'OF' : up);
  }
  return [...out];
}

/** The position used for a player's headline VOR — first canonical position,
 *  else 'UTIL' for bat-only / 'P' for arm-only. */
export function primaryPosition(eligible: string[], isPitcher: boolean): string {
  const canon = canonicalPositions(eligible);
  if (canon.length > 0) return canon[0];
  return isPitcher ? 'SP' : 'UTIL';
}

export interface ReplacementCandidate {
  /** Canonical-or-raw eligible positions (we canonicalize internally). */
  positions: string[];
  /** Talent-neutral weekly points (the readily-available value). */
  weeklyPoints: number;
}

/**
 * Replacement-level weekly points per position. For each position, sort the
 * available candidates eligible there by weekly points (desc) and take the
 * `rank`-th (default 3rd). Positions with fewer than `rank` candidates use the
 * worst available there (or 0 when none).
 */
export function replacementByPosition(
  candidates: ReplacementCandidate[],
  rank = 3,
): Record<string, number> {
  const byPos = new Map<string, number[]>();
  for (const c of candidates) {
    for (const pos of canonicalPositions(c.positions)) {
      const arr = byPos.get(pos) ?? [];
      arr.push(c.weeklyPoints);
      byPos.set(pos, arr);
    }
  }
  const out: Record<string, number> = {};
  for (const [pos, vals] of byPos) {
    vals.sort((a, b) => b - a);
    const idx = Math.min(rank - 1, vals.length - 1);
    out[pos] = idx >= 0 ? vals[idx] : 0;
  }
  return out;
}

/**
 * Value over replacement for one player at his primary position. Positive =
 * worth rostering over the freely-available alternative; ≤ 0 = a drop
 * candidate (you can replace his production for free).
 */
export function valueOverReplacement(
  weeklyPoints: number,
  position: string,
  replacement: Record<string, number>,
): number {
  return weeklyPoints - (replacement[position] ?? 0);
}
