/**
 * Replacement Upgrade Per Move (RUPM).
 *
 * Per-cat estimate of the typical per-week output gain available from
 * one realistic roster swap: drop a marginal rostered hitter, pick up
 * a top free agent at that cat.
 *
 * Used by the L6 forecast to express "closeability" in units fantasy
 * managers actually trade in (moves), rather than std-dev units which
 * mis-scale tight distributions (H, AVG). See
 * [docs/roster-strategy.md](../../../docs/roster-strategy.md).
 *
 * Computation:
 *   - For each scored batter cat:
 *     - For counting cats (HR, R, RBI, SB, etc.): the player's
 *       contribution is `expectedCount` from their neutral-week
 *       projection. Top-K FA average minus bottom-K rostered average
 *       gives a per-swap weekly count delta.
 *     - For ratio cats (AVG, OBP, etc.): the player's contribution
 *       is their *rate* (`expectedCount / expectedDenom`). Top-K FA
 *       rate avg minus bottom-K rostered rate avg gives the per-swap
 *       rate delta IF the swapped player provided 100% of team
 *       volume; scaled by `RATIO_VOLUME_SHARE` (~1 / lineup-size)
 *       to approximate the team-level rate change from one swap.
 *
 * Pitcher RUPM is not yet computed — pitcher focus still uses v1
 * z-score bands. See [forwardFocus.ts](./forwardFocus.ts).
 */

import { isRatioCat } from './forecast';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { PlayerProjection } from '@/lib/projection/batterTeam';

/**
 * Approx fraction of team-level rate that one swapped player's volume
 * accounts for. With ~10 starting batters and roughly even PA share,
 * one player ≈ 1/10 of team total. Used to scale ratio-cat RUPM from
 * "if this swap drove 100% of team rate" to "realistic team-level
 * change."
 */
const RATIO_VOLUME_SHARE = 0.1;

export function computeRupm(args: {
  rosteredProjections: PlayerProjection[];
  faProjections: PlayerProjection[];
  categories: EnrichedLeagueStatCategory[];
  /** Top-K (FAs) and bottom-K (rostered) sample size. Larger smooths
   *  but dilutes outliers. 10 is the default. */
  k: number;
}): Map<number, number> {
  const { rosteredProjections, faProjections, categories, k } = args;
  const rupm = new Map<number, number>();

  for (const cat of categories) {
    if (!cat.is_batter_stat) continue;
    const isRatio = isRatioCat(cat);

    const playerValue = (proj: PlayerProjection): number | null => {
      const c = proj.byCategory.get(cat.stat_id);
      if (!c) return null;
      if (isRatio) {
        return c.expectedDenom > 0 ? c.expectedCount / c.expectedDenom : null;
      }
      return c.expectedCount;
    };

    const faValues = faProjections
      .map(playerValue)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const rosteredValues = rosteredProjections
      .map(playerValue)
      .filter((v): v is number => v !== null && Number.isFinite(v));

    if (faValues.length === 0 || rosteredValues.length === 0) {
      rupm.set(cat.stat_id, 0);
      continue;
    }

    // Direction-aware sort. For higher-is-better, FAs sorted desc
    // (top = biggest contributors); rostered sorted asc (bottom = worst).
    // Flip for lower-is-better.
    const dir = cat.betterIs === 'higher' ? 1 : -1;
    faValues.sort((a, b) => dir * (b - a));
    rosteredValues.sort((a, b) => dir * (a - b));

    const topK = faValues.slice(0, Math.min(k, faValues.length));
    const bottomK = rosteredValues.slice(0, Math.min(k, rosteredValues.length));

    const avgTop = topK.reduce((s, v) => s + v, 0) / topK.length;
    const avgBottom = bottomK.reduce((s, v) => s + v, 0) / bottomK.length;

    // The upgrade size is always |best_available - worst_rostered|.
    // Direction was already used to pick which end of each list is
    // "best" vs "worst" — the magnitude is the absolute gap.
    let value = Math.abs(avgTop - avgBottom);
    if (isRatio) value *= RATIO_VOLUME_SHARE;

    rupm.set(cat.stat_id, value);
  }

  return rupm;
}
