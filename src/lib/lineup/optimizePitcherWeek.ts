import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import type { RosterPositionSlot } from '@/lib/hooks/useRosterPositions';
import type { MLBGame } from '@/lib/mlb/types';
import {
  normalizeTeamAbbr,
  isLikelySamePlayer,
  isPitcher,
} from '@/lib/pitching/display';
import { datesThroughEndOfWeek, fetchRoster, fetchGames, saveLineup } from './optimizeWeek';

const RESERVE_POSITIONS = new Set(['BN', 'IL', 'IL+', 'NA']);
/** Active pitching lineup slots — everything else a pitcher can hold is reserve. */
const PITCHING_SLOTS = new Set(['SP', 'RP', 'P']);

export interface OptimizePitcherWeekDeps {
  teamKey: string;
  /** Last date (YYYY-MM-DD) of the matchup week — Yahoo's real `week_end`
   *  via WeekBounds. Without it the run stops at the next Sunday. */
  weekEnd?: string;
  rosterPositions: RosterPositionSlot[];
}

export interface PitcherDayResult {
  date: string;
  saved: boolean;
  changeCount: number;
  error?: string;
}

export interface OptimizePitcherWeekResult {
  days: PitcherDayResult[];
  succeeded: number;
  failed: number;
}

/**
 * Find which rostered pitchers have probable starts in today's games.
 * Uses the same matching logic as TodayPitchers: normalize team abbr,
 * then check if pitcher name matches the probable starter.
 */
export function matchProbablePitchers(roster: RosterEntry[], games: MLBGame[]): Set<string> {
  const starters = new Set<string>();

  const pitchers = roster.filter(isPitcher);
  for (const pitcher of pitchers) {
    const abbr = normalizeTeamAbbr(pitcher.editorial_team_abbr);
    for (const g of games) {
      const homeAbbr = normalizeTeamAbbr(g.homeTeam.abbreviation);
      const awayAbbr = normalizeTeamAbbr(g.awayTeam.abbreviation);
      const isHome = homeAbbr === abbr;
      const isAway = awayAbbr === abbr;
      if (!isHome && !isAway) continue;

      const pp = isHome ? g.homeProbablePitcher : g.awayProbablePitcher;
      if (!pp) continue;

      if (!isLikelySamePlayer(pitcher.name, pp.name)) continue;

      starters.add(pitcher.player_key);
      break;
    }
  }

  return starters;
}

/**
 * Given a roster, the set of pitchers with a confirmed probable start, and the
 * league's slot template, return the slot overrides (`player_key -> position`)
 * that get every benched probable starter into an active slot it's *eligible*
 * for. For each benched starter, in order of preference:
 *
 *   1. an OPEN pitching slot (league capacity the roster hasn't filled) — the
 *      starter is activated and nobody is benched; then
 *   2. a slot held by an active NON-starter — swap them: starter in, non-starter
 *      to the bench.
 *
 * Probable starters already in an active slot are never moved and their slots
 * are never contested — the only players eligible to be benched are active
 * non-starters (each usable once). A benched starter with no open or eligible
 * non-starter slot stays benched: the only alternative would bench another
 * starter, which is net-negative. Returns an empty map when nothing changes.
 *
 * NOTE: slots are matched by eligibility, NOT by position *name*. A roster can
 * carry several slots of the same name (e.g. multiple generic `P` slots); a
 * starter already holding one must not block a benched starter from taking a
 * *different* slot of that name (open, or held by a non-starter).
 */
export function computePitcherStartOverrides(
  roster: RosterEntry[],
  probableStarterKeys: Set<string>,
  rosterPositions: RosterPositionSlot[],
): Map<string, string> {
  const overrides = new Map<string, string>();
  const isProbableStarter = (p: RosterEntry) => probableStarterKeys.has(p.player_key);

  // Benched probable starters need an active slot.
  const benchedStarters = roster.filter(
    p => isPitcher(p) && RESERVE_POSITIONS.has(p.selected_position) && isProbableStarter(p),
  );
  if (benchedStarters.length === 0) return overrides;

  // Open pitching-slot capacity per position: league slot counts minus the
  // pitchers already occupying each active slot. A positive value is an empty
  // slot a benched starter can drop straight into.
  const openByPos = new Map<string, number>();
  for (const slot of rosterPositions) {
    if (PITCHING_SLOTS.has(slot.position)) openByPos.set(slot.position, slot.count);
  }
  for (const p of roster) {
    if (isPitcher(p) && openByPos.has(p.selected_position)) {
      openByPos.set(p.selected_position, (openByPos.get(p.selected_position) ?? 0) - 1);
    }
  }

  // Active non-starters are the only players we may BENCH to make room —
  // active probable starters stay put, so their slots are off-limits.
  const swapPool = roster.filter(
    p => isPitcher(p) && !RESERVE_POSITIONS.has(p.selected_position) && !isProbableStarter(p),
  );

  for (const benchedStarter of benchedStarters) {
    const eligible = benchedStarter.eligible_positions ?? [];

    // 1. Prefer an open slot — activates the starter without benching anyone.
    const openPos = eligible.find(pos => (openByPos.get(pos) ?? 0) > 0);
    if (openPos) {
      overrides.set(benchedStarter.player_key, openPos);
      openByPos.set(openPos, (openByPos.get(openPos) ?? 0) - 1);
      continue;
    }

    // 2. Otherwise swap with the first active non-starter in a slot this
    //    starter can legally fill.
    const idx = swapPool.findIndex(p => eligible.includes(p.selected_position));
    if (idx < 0) continue; // no open or eligible slot — leave benched
    const swapTarget = swapPool[idx];
    overrides.set(benchedStarter.player_key, swapTarget.selected_position);
    overrides.set(swapTarget.player_key, 'BN');
    swapPool.splice(idx, 1); // used — don't reuse this slot for another starter
  }

  return overrides;
}

/**
 * Optimize pitchers for a single day: ensure probable starters are active,
 * by swapping them with non-starters if needed. This keeps all slots filled.
 */
async function optimizeOnePitcherDay(
  date: string,
  deps: OptimizePitcherWeekDeps,
): Promise<PitcherDayResult> {
  const [roster, games] = await Promise.all([
    fetchRoster(deps.teamKey, date),
    fetchGames(date),
  ]);

  // Find which rostered pitchers have confirmed probable starts today, then
  // compute the slot moves that activate every benched starter.
  const probableStarterKeys = matchProbablePitchers(roster, games);
  const overrides = computePitcherStartOverrides(roster, probableStarterKeys, deps.rosterPositions);

  if (overrides.size === 0) {
    return { date, saved: false, changeCount: 0 };
  }

  // Build full roster with overrides applied
  const players = roster.map(p => ({
    player_key: p.player_key,
    position: overrides.get(p.player_key) ?? p.selected_position,
  }));
  await saveLineup(deps.teamKey, date, players);
  return { date, saved: true, changeCount: overrides.size };
}

/**
 * Optimize pitchers for every remaining day in the fantasy week (through
 * `deps.weekEnd`, else next Sunday). Ensures probable starters are set to
 * active, non-starters are benched. Days are processed sequentially to
 * avoid Yahoo rate limiting.
 */
export async function optimizePitcherWeek(
  start: string,
  deps: OptimizePitcherWeekDeps,
  onProgress?: (date: string, index: number, total: number) => void,
): Promise<OptimizePitcherWeekResult> {
  const dates = datesThroughEndOfWeek(start, deps.weekEnd);
  const results: PitcherDayResult[] = [];
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    onProgress?.(date, i, dates.length);
    try {
      results.push(await optimizeOnePitcherDay(date, deps));
    } catch (e) {
      results.push({
        date,
        saved: false,
        changeCount: 0,
        error: e instanceof Error ? e.message : 'unknown error',
      });
    }
  }
  return {
    days: results,
    succeeded: results.filter(r => !r.error).length,
    failed: results.filter(r => !!r.error).length,
  };
}
