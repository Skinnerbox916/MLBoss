/**
 * Move recommendations for points leagues — "drop X, add Y for +Z points".
 *
 * Greedy upgrade matcher: within a player kind (batter / pitcher), pair the
 * best available free agent with the weakest rostered player whose value he
 * beats, repeat until no upgrade clears the threshold. Each rostered player is
 * dropped at most once and each FA added at most once.
 *
 * `value` is a points-per-week figure — pass the talent-neutral weekly value
 * (Phase 1) for season-long roster construction, or a horizon expected-points
 * value (Phase 2) for this-week streaming. The engine is agnostic; the caller
 * decides which lens by what it puts in `value`.
 *
 * Position scarcity (e.g. only one C slot) is NOT enforced here — batters are
 * treated as competing for batting/UTIL slots and pitchers for pitching slots.
 * That's correct for the UTIL-heavy default points roster; refine with a
 * slot-aware matcher if a league has tight single-position slots.
 */

export type PlayerKind = 'B' | 'P';

export interface MoveCandidate {
  name: string;
  team: string;
  kind: PlayerKind;
  /** Points-per-week value (talent-neutral weekly, or horizon expected). */
  value: number;
  /** Extra context surfaced back on the suggestion (role, positions, etc.). */
  meta?: Record<string, unknown>;
}

export interface SuggestedSwap {
  kind: PlayerKind;
  add: { name: string; team: string; value: number; meta?: Record<string, unknown> };
  drop: { name: string; team: string; value: number; meta?: Record<string, unknown> };
  /** Expected weekly-points gain from the swap (add.value − drop.value). */
  gain: number;
}

export interface RecommendOpts {
  /** Minimum gain (points/week) to bother suggesting a swap. */
  minGain?: number;
  /** Max swaps to return per kind. */
  maxPerKind?: number;
}

function greedyUpgrades(
  roster: MoveCandidate[],
  available: MoveCandidate[],
  kind: PlayerKind,
  minGain: number,
  maxPerKind: number,
): SuggestedSwap[] {
  const rosterSorted = roster.filter(r => r.kind === kind).sort((a, b) => a.value - b.value); // worst first
  const faSorted = available.filter(a => a.kind === kind).sort((a, b) => b.value - a.value);   // best first

  const swaps: SuggestedSwap[] = [];
  const usedRoster = new Set<number>();
  let faIdx = 0;

  for (const fa of faSorted) {
    if (swaps.length >= maxPerKind) break;
    faIdx += 1;
    // Find the weakest rostered player this FA still beats and that we
    // haven't already dropped.
    let dropIdx = -1;
    for (let i = 0; i < rosterSorted.length; i++) {
      if (usedRoster.has(i)) continue;
      if (fa.value - rosterSorted[i].value >= minGain) { dropIdx = i; break; }
      // rosterSorted is ascending; once the FA doesn't beat this one by
      // minGain, it won't beat any stronger one either.
      break;
    }
    if (dropIdx === -1) continue;
    const drop = rosterSorted[dropIdx];
    usedRoster.add(dropIdx);
    swaps.push({
      kind,
      add: { name: fa.name, team: fa.team, value: fa.value, meta: fa.meta },
      drop: { name: drop.name, team: drop.team, value: drop.value, meta: drop.meta },
      gain: Number((fa.value - drop.value).toFixed(1)),
    });
  }

  return swaps.sort((a, b) => b.gain - a.gain);
}

/**
 * Recommend roster upgrades: the best available free agents that beat your
 * weakest rostered players, paired greedily by value. Returns batter and
 * pitcher swaps separately so the caller can present them per side.
 */
export function recommendSwaps(
  roster: MoveCandidate[],
  available: MoveCandidate[],
  opts: RecommendOpts = {},
): { batters: SuggestedSwap[]; pitchers: SuggestedSwap[] } {
  const minGain = opts.minGain ?? 1.0;
  const maxPerKind = opts.maxPerKind ?? 5;
  return {
    batters: greedyUpgrades(roster, available, 'B', minGain, maxPerKind),
    pitchers: greedyUpgrades(roster, available, 'P', minGain, maxPerKind),
  };
}
