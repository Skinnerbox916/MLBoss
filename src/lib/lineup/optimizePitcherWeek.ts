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
const PITCHER_POSITIONS = new Set(['SP', 'RP', 'P']);

export interface OptimizePitcherWeekDeps {
  teamKey: string;
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
function matchProbablePitchers(roster: RosterEntry[], games: MLBGame[]): Set<string> {
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
 * Get all pitcher slots from the roster template, excluding reserves.
 * Returns a list of available slot positions that pitchers can occupy.
 */
function getPitcherSlots(rosterPositions: RosterPositionSlot[]): string[] {
  const slots: string[] = [];
  for (const entry of rosterPositions) {
    if (RESERVE_POSITIONS.has(entry.position)) continue;
    if (entry.position_type === 'P' || PITCHER_POSITIONS.has(entry.position)) {
      for (let i = 0; i < entry.count; i++) {
        slots.push(entry.position);
      }
    }
  }
  return slots;
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

  // Find which rostered pitchers have confirmed probable starts today
  const probableStarterKeys = matchProbablePitchers(roster, games);

  // Build override map: pitcher_key -> desired position
  const overrides = new Map<string, string>();

  // Get available pitcher slots
  const pitcherSlots = getPitcherSlots(deps.rosterPositions);
  const usedSlots = new Map<string, string>(); // slot name -> pitcher_key

  // Pitchers currently in active slots (not BN/IL)
  const activePitchers = roster.filter(
    p => isPitcher(p) && !RESERVE_POSITIONS.has(p.selected_position),
  );

  // Track which pitchers are probable starters
  const isProbableStarter = (p: RosterEntry) => probableStarterKeys.has(p.player_key);

  // First pass: place probable starters that are already active
  for (const pitcher of activePitchers) {
    if (isProbableStarter(pitcher)) {
      // Already in an active slot, keep them there
      usedSlots.set(pitcher.selected_position, pitcher.player_key);
    }
  }

  // Collect benched probable starters and active non-starters
  const benchedStarters = roster.filter(
    p => isPitcher(p) && RESERVE_POSITIONS.has(p.selected_position) && isProbableStarter(p),
  );
  const activeNonStarters = activePitchers.filter(p => !isProbableStarter(p));

  // Second pass: swap benched starters with active non-starters
  for (const benchedStarter of benchedStarters) {
    const eligible = benchedStarter.eligible_positions ?? [];

    // Find an active non-starter to swap with
    let swapTarget = activeNonStarters.find(
      p =>
        eligible.includes(p.selected_position) &&
        !usedSlots.has(p.selected_position),
    );

    // If no exact position match, try to find any non-starter we can move to bench
    if (!swapTarget) {
      swapTarget = activeNonStarters.find(
        p => !usedSlots.has(p.selected_position),
      );
    }

    if (swapTarget) {
      // Swap: starter goes to the non-starter's slot, non-starter goes to bench
      const starterSlot = swapTarget.selected_position;
      overrides.set(benchedStarter.player_key, starterSlot);
      overrides.set(swapTarget.player_key, 'BN');
      usedSlots.set(starterSlot, benchedStarter.player_key);
      // Remove swapTarget from available pool so we don't swap with it again
      const idx = activeNonStarters.indexOf(swapTarget);
      if (idx >= 0) activeNonStarters.splice(idx, 1);
    }
  }

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
 * Optimize pitchers for every remaining day in the fantasy week (Mon–Sun).
 * Ensures probable starters are set to active, non-starters are benched.
 * Days are processed sequentially to avoid Yahoo rate limiting.
 */
export async function optimizePitcherWeek(
  start: string,
  deps: OptimizePitcherWeekDeps,
  onProgress?: (date: string, index: number, total: number) => void,
): Promise<OptimizePitcherWeekResult> {
  const dates = datesThroughEndOfWeek(start);
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
