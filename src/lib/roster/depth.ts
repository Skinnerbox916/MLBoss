import type { RosterEntry, FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';
import type { RosterPositionSlot } from '@/lib/hooks/useRosterPositions';

export const BATTER_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'OF'] as const;
export type BatterPosition = typeof BATTER_POSITIONS[number];

export interface DepthConfig {
  matchupBonusCoeff: number;
  gapWeight: number;
  replacementTopN: number;
}

export const DEFAULT_DEPTH_CONFIG: DepthConfig = {
  matchupBonusCoeff: 0.2,
  gapWeight: 0.5,
  replacementTopN: 5,
};

export interface ScoredPlayer {
  player_key: string;
  name: string;
  eligibleBatterPositions: BatterPosition[];
  score: number;
  raw: RosterEntry | FreeAgentPlayer;
  /**
   * Current Yahoo percent_owned (0-100). Market-wide confidence signal —
   * high values mean the fantasy community still trusts this player.
   */
  percentOwned?: number;
  /**
   * Preseason average draft pick. Lower = drafted earlier = more market faith
   * heading into the season. Undrafted players are undefined.
   */
  averageDraftPick?: number;
}

export function getBatterPositions(eligible: string[]): BatterPosition[] {
  const seen = new Set<BatterPosition>();
  for (const pos of eligible) {
    if ((BATTER_POSITIONS as readonly string[]).includes(pos)) {
      seen.add(pos as BatterPosition);
    }
  }
  return Array.from(seen);
}

export interface StartingSlots {
  byPosition: Map<BatterPosition, number>;
  utilSlots: number;
}

export function parseStartingSlots(positions: RosterPositionSlot[]): StartingSlots {
  const byPosition = new Map<BatterPosition, number>();
  for (const pos of BATTER_POSITIONS) byPosition.set(pos, 0);
  let utilSlots = 0;
  for (const p of positions) {
    if ((BATTER_POSITIONS as readonly string[]).includes(p.position)) {
      const bp = p.position as BatterPosition;
      byPosition.set(bp, (byPosition.get(bp) ?? 0) + p.count);
    } else if (p.position === 'Util' || p.position === 'UTIL') {
      utilSlots += p.count;
    }
  }
  return { byPosition, utilSlots };
}

/**
 * Default preferred total roster depth per starting position.
 *
 * The value is the total number of players the user wants carried at that
 * position (starters + backups), not a backup count. Set to 0 if you don't
 * want to carry the position at all (e.g. running without a catcher).
 *
 * Defaults mirror the prior "starters + 1 backup" rule for single-slot
 * positions and "starters + 2 backups" for multi-slot positions. Override via
 * the `PreferredDepth` map to customize per roster strategy.
 */
export function getDefaultDepth(startingSlots: number): number {
  if (startingSlots <= 0) return 0;
  if (startingSlots === 1) return 2;
  return startingSlots + 2;
}

export type PreferredDepth = Map<BatterPosition, number> | Partial<Record<BatterPosition, number>>;

function resolveMinDepth(
  pos: BatterPosition,
  startingSlots: number,
  preferred?: PreferredDepth,
): number {
  if (!preferred) return getDefaultDepth(startingSlots);
  const raw = preferred instanceof Map ? preferred.get(pos) : preferred[pos];
  if (raw === undefined || raw === null || Number.isNaN(raw)) {
    return getDefaultDepth(startingSlots);
  }
  return Math.max(0, Math.floor(raw));
}

export function computePositionalDepth(
  players: ScoredPlayer[],
): Map<BatterPosition, ScoredPlayer[]> {
  const map = new Map<BatterPosition, ScoredPlayer[]>();
  for (const pos of BATTER_POSITIONS) map.set(pos, []);
  for (const p of players) {
    for (const pos of p.eligibleBatterPositions) {
      map.get(pos)!.push(p);
    }
  }
  for (const pos of BATTER_POSITIONS) {
    map.get(pos)!.sort((a, b) => b.score - a.score);
  }
  return map;
}

export function computeReplacementLevel(
  freeAgents: ScoredPlayer[],
  topN: number = 5,
): Map<BatterPosition, number> {
  const depth = computePositionalDepth(freeAgents);
  const replacement = new Map<BatterPosition, number>();
  for (const pos of BATTER_POSITIONS) {
    const list = depth.get(pos) ?? [];
    const top = list.slice(0, topN);
    if (top.length === 0) {
      replacement.set(pos, 0);
      continue;
    }
    const sorted = [...top].sort((a, b) => a.score - b.score);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? (sorted[mid - 1].score + sorted[mid].score) / 2
      : sorted[mid].score;
    replacement.set(pos, median);
  }
  return replacement;
}

// Scarcity order — scarce positions are searched first so branch-and-bound
// pruning kicks in earlier (smallest eligible pool = fewest candidates to try).
const SLOT_ORDER: BatterPosition[] = ['C', '3B', 'SS', '2B', '1B', 'OF'];

interface AssignmentResult {
  startersByPosition: Map<BatterPosition, ScoredPlayer[]>;
  utilStarters: ScoredPlayer[];
  assignedKeys: Set<string>;
  totalStarterScore: number;
}

/**
 * Optimal multi-position assignment via backtracking with alpha-beta pruning.
 *
 * Scarcity-first greedy can miss the optimum: if a 3B/OF-eligible stud gets
 * routed to 3B (scarce) when your only other 3B-eligible is decent but your
 * remaining OF pool is terrible, total roster value would've been higher with
 * the stud at OF. Backtracking tries every eligible player at every positional
 * slot, pruning branches that can't beat the current best.
 *
 * UTIL is filled greedily *after* positional slots: any batter is UTIL-eligible,
 * so the best unassigned batter always wins UTIL — no need to search.
 */
export function assignStarters(
  players: ScoredPlayer[],
  slots: StartingSlots,
): AssignmentResult {
  // Flatten positional slots into a fixed order. Each entry is one slot to fill.
  const slotList: BatterPosition[] = [];
  for (const pos of SLOT_ORDER) {
    const cap = slots.byPosition.get(pos) ?? 0;
    for (let i = 0; i < cap; i++) slotList.push(pos);
  }
  const n = slotList.length;

  // Sort once by score desc — trying high-scoring players first makes alpha-beta
  // prune more aggressively (we find the best total earlier).
  const byScore = [...players].sort((a, b) => b.score - a.score);
  const sumAll = byScore.reduce((s, p) => s + p.score, 0);

  const currentAssign: (ScoredPlayer | null)[] = new Array(n).fill(null);
  const bestAssign: (ScoredPlayer | null)[] = new Array(n).fill(null);
  const used = new Set<string>();
  let bestTotal = -Infinity;

  function backtrack(slotIdx: number, total: number, remainingUpper: number): void {
    // Upper bound: current total + sum of all still-unused player scores.
    // Loose but sound — prune if the best-case completion can't beat bestTotal.
    if (total + remainingUpper <= bestTotal) return;

    if (slotIdx === n) {
      if (total > bestTotal) {
        bestTotal = total;
        for (let i = 0; i < n; i++) bestAssign[i] = currentAssign[i];
      }
      return;
    }

    const pos = slotList[slotIdx];
    let anyEligible = false;

    for (const p of byScore) {
      if (used.has(p.player_key)) continue;
      if (!p.eligibleBatterPositions.includes(pos)) continue;
      anyEligible = true;
      used.add(p.player_key);
      currentAssign[slotIdx] = p;
      backtrack(slotIdx + 1, total + p.score, remainingUpper - p.score);
      used.delete(p.player_key);
      currentAssign[slotIdx] = null;
    }

    // No eligible player — leave slot empty and continue.
    if (!anyEligible) {
      backtrack(slotIdx + 1, total, remainingUpper);
    }
  }

  if (n > 0) backtrack(0, 0, sumAll);
  else bestTotal = 0;

  // Reconstruct positional result.
  const startersByPosition = new Map<BatterPosition, ScoredPlayer[]>();
  for (const pos of BATTER_POSITIONS) startersByPosition.set(pos, []);
  const assignedKeys = new Set<string>();
  for (let i = 0; i < n; i++) {
    const p = bestAssign[i];
    if (!p) continue;
    startersByPosition.get(slotList[i])!.push(p);
    assignedKeys.add(p.player_key);
  }
  for (const pos of BATTER_POSITIONS) {
    startersByPosition.get(pos)!.sort((a, b) => b.score - a.score);
  }

  // UTIL: greedy — best unassigned batter wins. Any batter is UTIL-eligible,
  // so no combinatorial search is required.
  const utilStarters: ScoredPlayer[] = [];
  const utilPool = byScore.filter(p =>
    !assignedKeys.has(p.player_key) && p.eligibleBatterPositions.length > 0,
  );
  for (let i = 0; i < slots.utilSlots && i < utilPool.length; i++) {
    utilStarters.push(utilPool[i]);
    assignedKeys.add(utilPool[i].player_key);
  }

  let totalStarterScore = bestTotal === -Infinity ? 0 : bestTotal;
  for (const p of utilStarters) totalStarterScore += p.score;

  return { startersByPosition, utilStarters, assignedKeys, totalStarterScore };
}

/**
 * A player ranked at a position, annotated with where they're actually
 * slotted in the optimal lineup. Lets the UI show a pure talent depth chart
 * ("best 2B on your roster is Betts") while flagging that Betts is actually
 * locked into OF so his 2B "depth" isn't free matchup insurance.
 */
export interface RankedPlayer {
  player: ScoredPlayer;
  /** Assigned starting position in the optimal lineup, or null for bench. */
  assignedSlot: BatterPosition | 'UTIL' | null;
}

export interface PositionValue {
  position: BatterPosition;
  startingSlots: number;
  /**
   * Talent-ranked list at this position — top eligible players by score,
   * regardless of where they're actually assigned to start. A multi-position
   * player will appear at every position they qualify for.
   */
  ranked: RankedPlayer[];
  /** Highest-scoring eligibles assigned to start at this position. */
  starters: ScoredPlayer[];
  startersScore: number;
  /**
   * Best eligible player at this position who isn't already starting anywhere.
   * This is the true matchup-depth backup — Betts starting at OF isn't a free
   * 2B option, because moving him costs OF.
   */
  firstBackup: ScoredPlayer | null;
  matchupBonus: number;
  eligibleCount: number;
  minDepth: number;
  depthShortfall: number;
  depthPenalty: number;
  replacement: number;
  value: number;
}

export interface RosterValue {
  total: number;
  byPosition: Map<BatterPosition, PositionValue>;
  utilScore: number;
}

export function computeRosterValue(
  players: ScoredPlayer[],
  slots: StartingSlots,
  replacement: Map<BatterPosition, number>,
  config: DepthConfig = DEFAULT_DEPTH_CONFIG,
  preferredDepth?: PreferredDepth,
): RosterValue {
  const assignment = assignStarters(players, slots);
  const depth = computePositionalDepth(players);
  const byPosition = new Map<BatterPosition, PositionValue>();
  let positionTotal = 0;

  // Build a lookup for "where is this player assigned in the optimal lineup?"
  const assignedSlotOf = new Map<string, BatterPosition | 'UTIL'>();
  for (const pos of BATTER_POSITIONS) {
    for (const p of assignment.startersByPosition.get(pos) ?? []) {
      assignedSlotOf.set(p.player_key, pos);
    }
  }
  for (const p of assignment.utilStarters) assignedSlotOf.set(p.player_key, 'UTIL');

  for (const pos of BATTER_POSITIONS) {
    const startingSlots = slots.byPosition.get(pos) ?? 0;
    const starters = assignment.startersByPosition.get(pos) ?? [];
    const startersScore = starters.reduce((s, p) => s + p.score, 0);

    // Rank all eligibles at this position by score, annotated with their optimal
    // lineup assignment so the UI can flag multi-position overlaps.
    const eligible = depth.get(pos) ?? [];
    const ranked: RankedPlayer[] = eligible.map(p => ({
      player: p,
      assignedSlot: assignedSlotOf.get(p.player_key) ?? null,
    }));

    // First backup = best eligible player who isn't starting AT THIS position.
    // We intentionally include multi-position starters assigned elsewhere: a
    // 2B/SS who starts at 2B is still real SS cover in a pinch, even though
    // moving him would open 2B. The user sees the flexibility; the optimizer
    // still discourages actually doing it because swapping a starter in costs
    // their original slot.
    const firstBackup = eligible.find(p => {
      const assignedAt = assignedSlotOf.get(p.player_key);
      return assignedAt !== pos;
    }) ?? null;

    const rep = replacement.get(pos) ?? 0;
    // Only credit a matchup bonus when the backup isn't locked into another
    // starting slot — otherwise "using" them creates a hole elsewhere.
    const backupIsFree = firstBackup && !assignment.assignedKeys.has(firstBackup.player_key);
    const matchupBonus = backupIsFree && firstBackup
      ? config.matchupBonusCoeff * Math.max(0, firstBackup.score - rep)
      : 0;

    const eligibleCount = eligible.length;
    const minDepth = resolveMinDepth(pos, startingSlots, preferredDepth);
    const depthShortfall = Math.max(0, minDepth - eligibleCount);
    const depthPenalty = config.gapWeight * depthShortfall;

    const value = startersScore + matchupBonus - depthPenalty;
    positionTotal += value;

    byPosition.set(pos, {
      position: pos,
      startingSlots,
      ranked,
      starters,
      startersScore,
      firstBackup,
      matchupBonus,
      eligibleCount,
      minDepth,
      depthShortfall,
      depthPenalty,
      replacement: rep,
      value,
    });
  }

  const utilScore = assignment.utilStarters.reduce((s, p) => s + p.score, 0);
  return { total: positionTotal + utilScore, byPosition, utilScore };
}

export type SwapReason = 'gap_fill' | 'upgrade' | 'matchup_depth';

export interface PositionChange {
  position: BatterPosition;
  valueDelta: number;
  depthShortfallDelta: number;
  matchupBonusDelta: number;
  startersScoreDelta: number;
}

export interface SwapEvaluation {
  drop: ScoredPlayer;
  add: ScoredPlayer;
  netValue: number;
  primaryReason: SwapReason;
  positionChanges: PositionChange[];
  createsGap: boolean;
  fillsGap: boolean;
}

function diffPositions(before: RosterValue, after: RosterValue): PositionChange[] {
  const changes: PositionChange[] = [];
  for (const pos of BATTER_POSITIONS) {
    const b = before.byPosition.get(pos)!;
    const a = after.byPosition.get(pos)!;
    const valueDelta = a.value - b.value;
    const depthShortfallDelta = a.depthShortfall - b.depthShortfall;
    const matchupBonusDelta = a.matchupBonus - b.matchupBonus;
    const startersScoreDelta = a.startersScore - b.startersScore;
    if (
      Math.abs(valueDelta) > 0.001 ||
      depthShortfallDelta !== 0 ||
      Math.abs(matchupBonusDelta) > 0.001 ||
      Math.abs(startersScoreDelta) > 0.001
    ) {
      changes.push({ position: pos, valueDelta, depthShortfallDelta, matchupBonusDelta, startersScoreDelta });
    }
  }
  return changes;
}

function classifyReason(changes: PositionChange[]): SwapReason {
  const fills = changes.filter(c => c.depthShortfallDelta < 0);
  if (fills.length > 0) return 'gap_fill';
  const sorted = [...changes].sort((a, b) => b.valueDelta - a.valueDelta);
  const biggest = sorted[0];
  if (biggest && biggest.matchupBonusDelta > biggest.startersScoreDelta) {
    return 'matchup_depth';
  }
  return 'upgrade';
}

export function evaluateSwap(
  rosterBefore: ScoredPlayer[],
  before: RosterValue,
  drop: ScoredPlayer,
  add: ScoredPlayer,
  slots: StartingSlots,
  replacement: Map<BatterPosition, number>,
  config: DepthConfig = DEFAULT_DEPTH_CONFIG,
  preferredDepth?: PreferredDepth,
): SwapEvaluation {
  const afterRoster = rosterBefore
    .filter(p => p.player_key !== drop.player_key)
    .concat(add);
  const after = computeRosterValue(afterRoster, slots, replacement, config, preferredDepth);
  const netValue = after.total - before.total;
  const positionChanges = diffPositions(before, after);
  const createsGap = positionChanges.some(c => c.depthShortfallDelta > 0);
  const fillsGap = positionChanges.some(c => c.depthShortfallDelta < 0);
  const primaryReason = classifyReason(positionChanges);
  return { drop, add, netValue, positionChanges, primaryReason, createsGap, fillsGap };
}

/**
 * How much "friction" to apply before recommending this player as a drop.
 *
 * Raw net-value optimization panics at 3 weeks of sample — a top-15 pick who's
 * 95%+ owned shouldn't be flagged as a drop candidate just because his
 * category blend isn't flattering in the current chase config. We subtract a
 * resistance term from `netValue` before ranking swaps, so highly-owned /
 * highly-drafted players only surface when the math *overwhelmingly* says
 * they should.
 *
 * The resistance is a sum of two independent dampeners:
 *   - Ownership: kicks in above 50% owned, maxes at ~0.25 at 100%.
 *   - Preseason pick: maxes at ~0.5 for a top-1 pick, fades to 0 by pick 150.
 *
 * Returned value is always >= 0. Undefined signals contribute 0, so free
 * agents and unknowns don't get artificially dampened.
 */
export function computeDropResistance(player: ScoredPlayer): number {
  let resistance = 0;

  if (typeof player.percentOwned === 'number' && player.percentOwned > 50) {
    // 50% → 0, 100% → 0.25
    resistance += 0.005 * (player.percentOwned - 50);
  }

  if (typeof player.averageDraftPick === 'number' && player.averageDraftPick > 0) {
    const PICK_HORIZON = 150;
    const pickFactor = Math.max(0, (PICK_HORIZON - player.averageDraftPick) / PICK_HORIZON);
    resistance += 0.5 * pickFactor;
  }

  return resistance;
}

export interface RankedSwap extends SwapEvaluation {
  /** Net value minus drop resistance — this is what we actually sort on. */
  adjustedNetValue: number;
  /** How much drop-resistance was applied (ownership + draft pedigree). */
  dropResistance: number;
}

export function generateSwapSuggestions(
  roster: ScoredPlayer[],
  freeAgents: ScoredPlayer[],
  slots: StartingSlots,
  replacement: Map<BatterPosition, number>,
  config: DepthConfig = DEFAULT_DEPTH_CONFIG,
  opts: {
    minNetValue?: number;
    limit?: number;
    preferredDepth?: PreferredDepth;
    /** Max times any single drop candidate can appear in the final list. */
    dropCap?: number;
  } = {},
): RankedSwap[] {
  const minNet = opts.minNetValue ?? 0.05;
  const dropCap = Math.max(1, opts.dropCap ?? 2);
  const before = computeRosterValue(roster, slots, replacement, config, opts.preferredDepth);

  // Pre-compute resistance per roster player — it's constant across all their swaps.
  const resistanceByDrop = new Map<string, number>();
  for (const p of roster) resistanceByDrop.set(p.player_key, computeDropResistance(p));

  const results: RankedSwap[] = [];

  for (const drop of roster) {
    const dropResistance = resistanceByDrop.get(drop.player_key) ?? 0;
    for (const add of freeAgents) {
      const evalResult = evaluateSwap(
        roster,
        before,
        drop,
        add,
        slots,
        replacement,
        config,
        opts.preferredDepth,
      );
      // Threshold on raw netValue first: no point evaluating obvious non-starters.
      if (evalResult.netValue <= minNet) continue;
      const adjustedNetValue = evalResult.netValue - dropResistance;
      results.push({ ...evalResult, adjustedNetValue, dropResistance });
    }
  }

  // Sort by adjusted net value so drop-resistant players only surface when
  // the swap is *overwhelmingly* good. Gap-fills win a tiebreaker because the
  // preferred-depth check is intentional.
  results.sort((a, b) => {
    if (a.fillsGap !== b.fillsGap) return a.fillsGap ? -1 : 1;
    return b.adjustedNetValue - a.adjustedNetValue;
  });

  // Diversity-aware dedupe:
  //   - Each `add` appears at most once (we already pick their best drop).
  //   - Each `drop` appears at most `dropCap` times (prevents one obvious
  //     drop candidate from dominating the list).
  const seenAdds = new Set<string>();
  const dropCount = new Map<string, number>();
  const deduped: RankedSwap[] = [];
  for (const s of results) {
    if (seenAdds.has(s.add.player_key)) continue;
    const cnt = dropCount.get(s.drop.player_key) ?? 0;
    if (cnt >= dropCap) continue;
    seenAdds.add(s.add.player_key);
    dropCount.set(s.drop.player_key, cnt + 1);
    deduped.push(s);
  }

  return opts.limit ? deduped.slice(0, opts.limit) : deduped;
}
