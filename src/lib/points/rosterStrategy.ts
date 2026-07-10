/**
 * Points roster strategy — the CLIENT-side half of the points roster page.
 *
 * The facts/preferences boundary (docs/points-leagues.md): the server
 * (`analyzePointsTeam`) computes cacheable projection facts — per-player
 * weekly points, per-stat point contributions, VOR. This module applies
 * the user's preferences (target-depth steppers) and runs the shared
 * position-aware machinery over those facts:
 *
 *   - moves: `generateSwapSuggestions` (roster/depth.ts) fed pts/wk —
 *     multi-position shuffles, gap weighting, drop resistance, pure adds
 *     against open slots
 *   - depth: `computeRosterValue` position values
 *   - open slots: shared Yahoo cap + placement gate
 *
 * Pure functions — a stepper click re-solves in a memo, no refetch, no
 * per-preference server cache variants. Mirrors how the categories page
 * splits the same work between the forecast route and `RosterManager`.
 */

import {
  parseStartingSlots,
  getBatterPositions,
  computeReplacementLevel,
  computeRosterValue,
  generateSwapSuggestions,
  type ScoredPlayer,
} from '@/lib/roster/depth';
import { computeOpenSlotCount } from '@/lib/roster/openSlots';
import type { PreferredDepthMap } from '@/lib/roster/preferredDepth';
import type { RosterPositionSlot } from '@/lib/hooks/useRosterPositions';
import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import { COMMON_MLB_STATS } from '@/constants/statCategories';
import type { PointsPlayerRow } from './analyzeTeam';

/** One side of a suggested batter move. */
export interface PointsMovePlayer {
  name: string;
  team: string;
  playerKey: string;
  displayPosition: string;
  percentOwned?: number;
  averageDraftPick?: number;
  /** Role-share-adjusted expected points per typical week. */
  weeklyPoints: number;
}

/** Position-aware suggested batter move (drop → add, or pure add). */
export interface PointsBatterMove {
  add: PointsMovePlayer;
  drop: PointsMovePlayer | null;
  /** Net roster value change in pts/wk (position-gap weighted). */
  netValue: number;
  primaryReason: 'gap_fill' | 'upgrade' | 'matchup_depth';
  /** Per-position roster value deltas, for the positional impact strip. */
  positionChanges: Array<{ position: string; valueDelta: number; depthShortfallDelta?: number }>;
  /** Top per-stat pts/wk deltas (add − drop) — the components of netValue. */
  impacts: Array<{ statId: number; label: string; delta: number }>;
}

/** Positional-depth row for the shared depth table. */
export interface PointsDepthRow {
  position: string;
  startingSlots: number;
  eligibleCount: number;
  minDepth: number;
  depthShortfall: number;
  starters: string[];
  firstBackup: string | null;
}

export interface PointsRosterStrategy {
  moves: PointsBatterMove[];
  depth: PointsDepthRow[];
  openSlots: number;
}

const round1 = (n: number) => Number(n.toFixed(1));

/** Impacts smaller than this (pts/wk) don't render in the delta strip. */
const IMPACT_FLOOR = 0.3;

export function buildPointsRosterStrategy(args: {
  /** Batter rows from `analyzePointsTeam` (owned + FA, with statPoints). */
  batterRows: PointsPlayerRow[];
  /** Full roster entries (selected_position for open slots; drop-side
   *  display fields). */
  roster: RosterEntry[];
  /** League slot template. */
  leaguePositions: RosterPositionSlot[];
  /** Target-depth overrides from the steppers. */
  preferredDepth?: PreferredDepthMap;
}): PointsRosterStrategy {
  const { batterRows, roster, leaguePositions, preferredDepth } = args;
  if (batterRows.length === 0 || leaguePositions.length === 0) {
    return { moves: [], depth: [], openSlots: 0 };
  }

  const startingSlots = parseStartingSlots(leaguePositions);
  const openSlots = computeOpenSlotCount(roster, leaguePositions);
  const rosterEntryByKey = new Map(roster.map(p => [p.player_key, p]));
  const rowByKey = new Map(batterRows.map(b => [b.playerKey, b]));

  const toScored = (b: PointsPlayerRow): ScoredPlayer | null => {
    const eligibleBatterPositions = getBatterPositions(b.positions);
    if (eligibleBatterPositions.length === 0) return null;
    // The swap engine only reads `raw` at display sites; rostered rows get
    // the real entry, FA rows a minimal stand-in (their display fields are
    // re-derived from the row in `toMovePlayer` below).
    const raw = (rosterEntryByKey.get(b.playerKey) ??
      { name: b.name, editorial_team_abbr: b.team }) as ScoredPlayer['raw'];
    return {
      player_key: b.playerKey,
      name: b.name,
      eligibleBatterPositions,
      score: b.weeklyPoints,
      raw,
      percentOwned: b.percentOwned,
    };
  };

  const scoredRoster = batterRows
    .filter(b => b.owned && !b.injured)
    .map(toScored)
    .filter((x): x is ScoredPlayer => x !== null);
  // FA `injured` = on a real IL (server sets it) — stash candidates stay
  // on the boards but can't be swap adds.
  const scoredFAs = batterRows
    .filter(b => !b.owned && !b.injured)
    .map(toScored)
    .filter((x): x is ScoredPlayer => x !== null);

  if (scoredRoster.length === 0) return { moves: [], depth: [], openSlots };

  const replacement = computeReplacementLevel(scoredFAs);

  const depthResult = computeRosterValue(
    scoredRoster,
    startingSlots,
    replacement,
    undefined,
    preferredDepth,
  );
  const depth: PointsDepthRow[] = Array.from(depthResult.byPosition.values())
    .filter(pv => pv.startingSlots > 0)
    .map(pv => ({
      position: pv.position,
      startingSlots: pv.startingSlots,
      eligibleCount: pv.eligibleCount,
      minDepth: pv.minDepth,
      depthShortfall: pv.depthShortfall,
      starters: pv.starters.map(x => x.name),
      firstBackup: pv.firstBackup?.name ?? null,
    }));

  const ranked = scoredFAs.length > 0
    ? generateSwapSuggestions(scoredRoster, scoredFAs, startingSlots, replacement, undefined, {
        // pts/wk units: below a point a week the move is churn, not an upgrade.
        minNetValue: 1.0,
        limit: 10,
        preferredDepth,
        openSlotCount: openSlots,
      })
    : [];

  const toMovePlayer = (sp: ScoredPlayer): PointsMovePlayer => {
    const row = rowByKey.get(sp.player_key);
    const entry = rosterEntryByKey.get(sp.player_key);
    return {
      name: sp.name,
      team: row?.team ?? '',
      playerKey: sp.player_key,
      displayPosition:
        entry?.display_position ?? sp.eligibleBatterPositions.join(','),
      percentOwned: sp.percentOwned,
      averageDraftPick: entry?.average_draft_pick,
      weeklyPoints: round1(sp.score),
    };
  };

  const moves: PointsBatterMove[] = ranked.map(m => {
    const addPts = rowByKey.get(m.add.player_key)?.statPoints ?? {};
    const dropPts = m.drop ? rowByKey.get(m.drop.player_key)?.statPoints ?? {} : {};
    const statIds = new Set([...Object.keys(addPts), ...Object.keys(dropPts)].map(Number));
    const impacts = Array.from(statIds)
      .map(id => ({
        statId: id,
        label: COMMON_MLB_STATS[id]?.display ?? String(id),
        delta: round1((addPts[id] ?? 0) - (dropPts[id] ?? 0)),
      }))
      .filter(i => Math.abs(i.delta) >= IMPACT_FLOOR)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return {
      add: toMovePlayer(m.add),
      drop: m.drop ? toMovePlayer(m.drop) : null,
      netValue: round1(m.netValue),
      primaryReason: m.primaryReason,
      positionChanges: m.positionChanges.map(c => ({
        position: c.position,
        valueDelta: round1(c.valueDelta),
        depthShortfallDelta: c.depthShortfallDelta,
      })),
      impacts,
    };
  });

  return { moves, depth, openSlots };
}
