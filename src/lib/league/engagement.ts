/**
 * Manager engagement multiplier.
 *
 * Captures a real source of variance the talent model alone can't see:
 * how often a fantasy manager actually fills their starting lineup
 * slots. A "set and forget" manager leaves slots empty when players
 * are sitting / when MLB teams have off days / when a roster move
 * was available — those missed PAs become lost counting-cat output
 * that no talent model can recover.
 *
 * **Signal:** team's YTD plate appearances accumulated through their
 * starting slots, normalized against the most-engaged team in the
 * league. The top team is treated as 100% engagement; others
 * proportionally less. We don't need absolute calibration to a
 * theoretical max — relative engagement is what matters for league
 * comparison.
 *
 * **Applied to:** counting cats only (HR, R, RBI, SB, BB, K, TB, H).
 * Rate cats (AVG, OBP, ERA, WHIP) are volume-invariant — a low-
 * engagement team has fewer ABs but the same AVG rate on those ABs.
 *
 * **PA derivation:** Yahoo's team_stats endpoint doesn't surface PA
 * as a top-level stat in standard leagues, but H and AVG are always
 * there. Back into AB via `AB = H / AVG`, then `PA ≈ AB / 0.91`
 * (walks + HBP + SF are ~9% of PA league-wide).
 *
 * **Empirical spread:** in a typical 10-team league, we see ~10-15%
 * spread between the most and least engaged managers — meaningful
 * enough that ignoring it would mis-rank teams whose manager habits
 * differ materially.
 */

import type { TeamStats } from '@/lib/yahoo-fantasy-api';

/** AB ≈ PA × 0.91 league-wide. Walks + HBP + SF are ~9% of PA. */
const AB_PER_PA = 0.91;

/** Stat IDs Yahoo uses for hits and batting average. Stable across
 *  leagues — these are part of the standard MLB stat ID set. */
const H_STAT_ID = 8;
const AVG_STAT_ID = 3;

export interface TeamEngagement {
  teamKey: string;
  teamName: string;
  /** Back-calculated YTD PA from `H / AVG / 0.91`. NaN when H or AVG
   *  isn't present / parseable. */
  estimatedPA: number;
  /** Engagement ratio vs the most-engaged team in the league. 1.0 =
   *  league leader; below 1.0 = proportionally less engaged. 0 when
   *  PA couldn't be derived (treated as "no signal," not "zero
   *  engagement" — the multiplier is left at 1.0 in that case
   *  downstream). */
  engagementRatio: number;
}

/**
 * Compute per-team engagement ratios from each team's YTD stats.
 * Returns one entry per team in the input order.
 *
 * The top team in PA is set to 1.0; others < 1.0. Teams with missing
 * or unparseable H/AVG get `estimatedPA: NaN, engagementRatio: 0` —
 * callers should treat 0 as "no signal" and skip the multiplier.
 */
export function computeTeamEngagements(
  teams: Array<{ teamKey: string; teamName: string; stats: TeamStats | null }>,
): TeamEngagement[] {
  const raw = teams.map(t => {
    const h = parseStat(t.stats, H_STAT_ID);
    const avg = parseStat(t.stats, AVG_STAT_ID);
    const ab = avg > 0 && Number.isFinite(h) ? h / avg : NaN;
    const pa = Number.isFinite(ab) ? ab / AB_PER_PA : NaN;
    return { teamKey: t.teamKey, teamName: t.teamName, estimatedPA: pa };
  });

  const validPAs = raw.map(r => r.estimatedPA).filter(p => Number.isFinite(p) && p > 0);
  const maxPA = validPAs.length > 0 ? Math.max(...validPAs) : 0;

  return raw.map(r => ({
    ...r,
    engagementRatio: maxPA > 0 && Number.isFinite(r.estimatedPA)
      ? r.estimatedPA / maxPA
      : 0,
  }));
}

function parseStat(stats: TeamStats | null, statId: number): number {
  if (!stats) return NaN;
  const entry = stats.stats.find(s => s.stat_id === statId);
  if (!entry) return NaN;
  const value = String(entry.value).replace(/^\./, '0.');
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : NaN;
}
