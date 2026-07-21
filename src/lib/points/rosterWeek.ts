/**
 * Roster week projection — the ONE engine for "what does this batting
 * lineup actually score over a window of days", used everywhere a points
 * weekly batting total or per-day coverage is needed:
 *
 *   - `analyzeTeam` — the dashboard marquee / roster week projection
 *     (`weekProjectedPoints`, batting portion).
 *   - `analyzePointsStreaming` — the /streaming coverage strip + the base
 *     lineups its batter-plug marginals compare against.
 *
 * It owns only the AGGREGATION: solve the optimal batting lineup per day
 * (daily cadence) or once for the locked week (weekly cadence), and read
 * off per-day coverage + the window total. The per-player day SCORE is
 * injected — callers price a batter-day however their context demands
 * (matchup-adjusted, posted vs observed lineup spot, injury zeroing) —
 * mirroring `optimizePointsLineup`'s injected-scorer contract.
 *
 * Pitchers are NOT included: they're priced by actual probable starts,
 * summed separately by the caller. This is batting only.
 *
 * Known approximation: weekly cadence solves the window as if the lineup
 * can still be set — exact for next-week windows (set before Monday),
 * a mild overestimate for a CURRENT locked week (both sides of a
 * matchup equally). If a truthful mid-week locked projection is ever
 * needed, add a 'locked' mode that sums the current lineup instead.
 *
 * Registered in docs/engines.md. Before this existed, `analyzeTeam`
 * summed per-player week volume capped at slot count (a position-blind,
 * off-day-blind approximation) while streaming solved it exactly one file
 * away — see docs/history.md 2026-07.
 */

import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import type { WeekDay } from '@/lib/dashboard/weekRange';
import type { LineupCadence } from '@/lib/fantasy/scoringMode';
import { hasUnavailableStatus } from '@/lib/roster/playerPool';
import {
  optimizePointsLineup,
  type PointsLineupResult,
  type LineupSlotAssignment,
  type RosterPositionSlot,
} from './lineupOptimizer';

const round1 = (n: number) => Number(n.toFixed(1));
const key = (name: string, team: string) => `${name.toLowerCase()}|${team.toLowerCase()}`;

const RESERVE_SLOTS = new Set(['IL', 'IL+', 'NA']);

/**
 * A future-window projection assumes lineups are settable: today's Yahoo
 * editability locks don't apply to days that haven't started (and other
 * teams' rosters are never editable to us — without this, an opponent's
 * "optimal" silently degrades to their current lineup, since the solver
 * pins every non-editable player). Status-injured players sitting in an
 * ACTIVE slot are benched — the solver would otherwise pin them into the
 * slot, masking the coverage hole (and collecting phantom points under a
 * scorer that doesn't zero injured). Players in reserve slots (IL/IL+/NA)
 * keep them: activating a stashed player costs a roster move, so a
 * projection must not count him.
 */
function toProjectableRoster(roster: RosterEntry[]): RosterEntry[] {
  return roster.map(p => ({
    ...p,
    is_editable: true,
    starting_status: undefined,
    selected_position:
      !RESERVE_SLOTS.has(p.selected_position) && hasUnavailableStatus(p)
        ? 'BN'
        : p.selected_position,
  }));
}

export interface RosterWeekDay {
  day: WeekDay;
  /** Points the optimal batting lineup collects THIS day. */
  optimalPoints: number;
  /** Optimal-lineup batters who started AND have a game this day — the
   *  coverage rows (count = filled batting slots). */
  startedRows: LineupSlotAssignment[];
  /** Daily cadence: the independent day solve — the base a marginal
   *  (add-an-FA) re-solve compares against. Null for weekly (use
   *  `weekSolve`). */
  daySolve: PointsLineupResult | null;
}

export interface RosterWeekProjection {
  cadence: LineupCadence;
  /** Optimal batting points over the whole window — the canonical weekly
   *  batting projection. Daily = Σ per-day optima (you re-set the lineup
   *  each day); weekly = the single locked-lineup solve. */
  battingPoints: number;
  days: RosterWeekDay[];
  /** Weekly cadence only: the single whole-week solve, the base for weekly
   *  marginal re-solves. Null for daily. */
  weekSolve: PointsLineupResult | null;
}

/**
 * Project a roster's optimal batting output over `days`.
 *
 * `dayScore(player, day)` returns a batter's expected fantasy points that
 * day (0 if idle OR injured — the caller's scorer must zero injured
 * players; the lineup optimizer pins, not benches, an injured starter).
 */
export function projectRosterWeek(args: {
  roster: RosterEntry[];
  rosterPositions: RosterPositionSlot[];
  days: WeekDay[];
  dayScore: (player: RosterEntry, day: WeekDay) => number;
  cadence: LineupCadence;
}): RosterWeekProjection {
  const { rosterPositions, days, dayScore, cadence } = args;
  const roster = toProjectableRoster(args.roster);

  if (cadence === 'weekly') {
    // Locked lineup: one solve where a bat's week value is the sum of his
    // day values (schedule density + series contexts are part of the bat).
    const weekScore = (pl: RosterEntry): number => {
      let sum = 0;
      for (const day of days) sum += dayScore(pl, day);
      return sum;
    };
    const weekSolve = optimizePointsLineup(roster, rosterPositions, weekScore);
    const rosterByKey = new Map(roster.map(p => [key(p.name, p.editorial_team_abbr), p]));
    const startedRows = weekSolve.lineup.filter(r => r.started && r.dayPoints > 0);
    const dayViews: RosterWeekDay[] = days.map(day => {
      const playing = startedRows.filter(r => {
        const entry = rosterByKey.get(key(r.name, r.team));
        return entry ? dayScore(entry, day) > 0 : false;
      });
      const optimalPoints = playing.reduce((s, r) => {
        const entry = rosterByKey.get(key(r.name, r.team));
        return s + (entry ? dayScore(entry, day) : 0);
      }, 0);
      return { day, optimalPoints: round1(optimalPoints), startedRows: playing, daySolve: null };
    });
    return { cadence, battingPoints: weekSolve.optimalPoints, days: dayViews, weekSolve };
  }

  // Daily: independent per-day solves; window total = Σ day optima.
  let battingPoints = 0;
  const dayViews: RosterWeekDay[] = days.map(day => {
    const solve = optimizePointsLineup(roster, rosterPositions, pl => dayScore(pl, day));
    battingPoints += solve.optimalPoints;
    const startedRows = solve.lineup.filter(r => r.started && r.dayPoints > 0);
    return { day, optimalPoints: solve.optimalPoints, startedRows, daySolve: solve };
  });
  return { cadence, battingPoints: round1(battingPoints), days: dayViews, weekSolve: null };
}
