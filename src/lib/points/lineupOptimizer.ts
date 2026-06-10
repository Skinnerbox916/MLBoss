/**
 * Daily batting lineup optimizer for points leagues.
 *
 * Reuses the shared, score-agnostic `optimizeLineup` (Hungarian slot
 * assignment, eligibility + Util + pinned/injured handling). The only
 * points-specific input is the per-player day score: expected fantasy points
 * for the target day = points-per-PA × that day's expected PA (game count ×
 * lineup-spot PA/game). A player whose team is idle scores 0 and is benched.
 *
 * Matchup quality (park / opp SP / weather) is intentionally not folded into
 * the day score: for points start/sit it's second-order vs "does he play and
 * how good is he". The score function is injected, so a matchup-adjusted
 * scorer can be swapped in later without touching this module.
 */

import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import { optimizeLineup } from '@/lib/lineup/optimize';

const RESERVE_POSITIONS = new Set(['BN', 'IL', 'IL+', 'NA']);
const PITCHER_POSITIONS = new Set(['SP', 'RP', 'P']);

export interface RosterPositionSlot {
  position: string;
  count: number;
  position_type?: string;
}

interface SlotDef {
  position: string;
  group: 'batting' | 'pitching' | 'reserve';
}

/** Expand a roster-position template into one SlotDef per slot. Mirrors
 *  `optimizeWeek.buildBattingSlots`. Exported for the week-write optimizer. */
export function buildBattingSlots(template: RosterPositionSlot[]): SlotDef[] {
  const slots: SlotDef[] = [];
  for (const entry of template) {
    let group: SlotDef['group'];
    if (RESERVE_POSITIONS.has(entry.position)) group = 'reserve';
    else if (entry.position_type === 'P') group = 'pitching';
    else if (entry.position_type === 'B') group = 'batting';
    else if (PITCHER_POSITIONS.has(entry.position)) group = 'pitching';
    else group = 'batting';
    for (let i = 0; i < entry.count; i++) slots.push({ position: entry.position, group });
  }
  return slots;
}

function isStartingBattingPos(pos: string): boolean {
  return !RESERVE_POSITIONS.has(pos) && !PITCHER_POSITIONS.has(pos);
}

export interface LineupSlotAssignment {
  name: string;
  team: string;
  fromPosition: string;
  toPosition: string;
  dayPoints: number;
  started: boolean;
  // ----- Optional display enrichment (populated by analyzePointsTeam) -----
  /** Yahoo headshot URL, if available. */
  imageUrl?: string | null;
  /** Opponent label for the day, e.g. "vs ARI" / "@ DET" / "no game". */
  oppLabel?: string;
  /** Opposing probable starter name, if posted. */
  oppArm?: string | null;
  /** True when the player is on IL — row dims, score → IL badge. */
  injured?: boolean;
  /** Talent-neutral expected points per game (for the expanded breakdown). */
  perGamePts?: number;
  /** Talent-neutral weekly points. */
  weeklyPts?: number;
}

export interface PointsLineupResult {
  /** Expected points of the current (as-set) batting lineup for the day. */
  currentPoints: number;
  /** Expected points of the optimal batting lineup for the day. */
  optimalPoints: number;
  /** optimalPoints − currentPoints (≥ 0). */
  deltaPoints: number;
  /** Number of slot changes the optimizer recommends. */
  moveCount: number;
  /** Per-player view: final slot + whether started + the day score. Sorted
   *  by day points desc for readability. */
  lineup: LineupSlotAssignment[];
}

/**
 * Optimize the batting lineup for one day. `getDayPoints` returns a player's
 * expected fantasy points for that day (0 if idle).
 */
export function optimizePointsLineup(
  roster: RosterEntry[],
  rosterPositions: RosterPositionSlot[],
  getDayPoints: (player: RosterEntry) => number,
): PointsLineupResult {
  const slots = buildBattingSlots(rosterPositions);
  const overrides = optimizeLineup(slots, roster, getDayPoints);

  const batters = roster.filter(p => !isPitcher(p));
  let currentPoints = 0;
  let optimalPoints = 0;
  const lineup: LineupSlotAssignment[] = [];

  for (const p of batters) {
    const pts = getDayPoints(p);
    const finalPos = overrides.get(p.player_key) ?? p.selected_position;
    const startedNow = isStartingBattingPos(p.selected_position);
    const startedOptimal = isStartingBattingPos(finalPos);
    if (startedNow) currentPoints += pts;
    if (startedOptimal) optimalPoints += pts;
    lineup.push({
      name: p.name,
      team: p.editorial_team_abbr,
      fromPosition: p.selected_position,
      toPosition: finalPos,
      dayPoints: Number(pts.toFixed(2)),
      started: startedOptimal,
    });
  }

  lineup.sort((a, b) => b.dayPoints - a.dayPoints);

  return {
    currentPoints: Number(currentPoints.toFixed(1)),
    optimalPoints: Number(optimalPoints.toFixed(1)),
    deltaPoints: Number((optimalPoints - currentPoints).toFixed(1)),
    moveCount: overrides.size,
    lineup,
  };
}

function isPitcher(p: RosterEntry): boolean {
  return (
    p.eligible_positions.includes('P') ||
    p.eligible_positions.includes('SP') ||
    p.eligible_positions.includes('RP') ||
    PITCHER_POSITIONS.has(p.display_position)
  );
}
