import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import type { RosterPositionSlot } from '@/lib/hooks/useRosterPositions';
import type { MLBGame, ParkData, PlayerStatLine } from '@/lib/mlb/types';
import { resolveMatchup, isWipedGame, type MatchupContext } from '@/lib/mlb/analysis';
import { getBatterRating, type Focus } from '@/lib/mlb/batterRating';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import { optimizeLineup } from './optimize';

const RESERVE_POSITIONS = new Set(['BN', 'IL', 'IL+', 'NA']);
const DH_BOOST = 1000;

interface EnrichedGame extends MLBGame {
  park: ParkData | null;
}

export interface OptimizeWeekDeps {
  teamKey: string;
  rosterPositions: RosterPositionSlot[];
  scoredBatterCategories: EnrichedLeagueStatCategory[];
  focusMap: Record<number, Focus>;
  /**
   * Looks up cached/known season stats for a player as a stratified
   * `PlayerStatLine`. Reused across days — season stats are stable
   * enough that we don't refetch per date.
   */
  getPlayerLine: (name: string, teamAbbr: string) => PlayerStatLine | null;
}

export interface DayResult {
  date: string;
  saved: boolean;
  changeCount: number;
  error?: string;
}

export interface OptimizeWeekResult {
  days: DayResult[];
  succeeded: number;
  failed: number;
}

function ymdAddDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + n);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Returns dates from `start` (inclusive) through the next Sunday (inclusive).
 * Yahoo Fantasy MLB weeks run Monday–Sunday. If `start` is already Sunday,
 * returns just [start].
 */
export function datesThroughEndOfWeek(start: string): string[] {
  const [y, m, d] = start.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dow = date.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
  const daysRemaining = dow === 0 ? 0 : 7 - dow;
  const out: string[] = [];
  for (let i = 0; i <= daysRemaining; i++) {
    out.push(ymdAddDays(start, i));
  }
  return out;
}

export async function fetchRoster(teamKey: string, date: string): Promise<RosterEntry[]> {
  const res = await fetch(`/api/fantasy/roster?teamKey=${teamKey}&date=${date}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Roster fetch failed (HTTP ${res.status})`);
  }
  const data = await res.json();
  return (data.roster ?? []) as RosterEntry[];
}

export async function fetchGames(date: string): Promise<EnrichedGame[]> {
  const res = await fetch(`/api/mlb/game-day?date=${date}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Game-day fetch failed (HTTP ${res.status})`);
  }
  const data = await res.json();
  return (data.games ?? []) as EnrichedGame[];
}

export async function saveLineup(
  teamKey: string,
  date: string,
  players: { player_key: string; position: string }[],
): Promise<void> {
  const res = await fetch('/api/fantasy/lineup', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamKey, date, players }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Save failed (HTTP ${res.status})`);
  }
}

function buildBattingSlots(
  template: RosterPositionSlot[],
): { position: string; group: 'batting' | 'pitching' | 'reserve' }[] {
  const slots: { position: string; group: 'batting' | 'pitching' | 'reserve' }[] = [];
  for (const entry of template) {
    let group: 'batting' | 'pitching' | 'reserve';
    if (RESERVE_POSITIONS.has(entry.position)) group = 'reserve';
    else if (entry.position_type === 'P') group = 'pitching';
    else if (entry.position_type === 'B') group = 'batting';
    else if (['SP', 'RP', 'P'].includes(entry.position)) group = 'pitching';
    else group = 'batting';

    for (let i = 0; i < entry.count; i++) {
      slots.push({ position: entry.position, group });
    }
  }
  return slots;
}

async function optimizeOneDay(
  date: string,
  deps: OptimizeWeekDeps,
): Promise<DayResult> {
  const [roster, games] = await Promise.all([
    fetchRoster(deps.teamKey, date),
    fetchGames(date),
  ]);

  // Build matchup index for the day.
  const matchupIndex = new Map<string, MatchupContext>();
  for (const game of games) {
    const homeCtx = resolveMatchup(games, game.park, game.homeTeam.abbreviation);
    if (homeCtx) matchupIndex.set(game.homeTeam.abbreviation.toUpperCase(), homeCtx);
    const awayCtx = resolveMatchup(games, game.park, game.awayTeam.abbreviation);
    if (awayCtx) matchupIndex.set(game.awayTeam.abbreviation.toUpperCase(), awayCtx);
  }

  // Detect doubleheader teams.
  const counts = new Map<string, number>();
  for (const game of games) {
    if (isWipedGame(game.status)) continue;
    const h = game.homeTeam.abbreviation.toUpperCase();
    const a = game.awayTeam.abbreviation.toUpperCase();
    counts.set(h, (counts.get(h) ?? 0) + 1);
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  const dhTeams = new Set<string>();
  for (const [abbr, n] of counts.entries()) {
    if (n >= 2) dhTeams.add(abbr);
  }

  const getScore = (p: RosterEntry) => {
    const abbr = p.editorial_team_abbr.toUpperCase();
    const context = matchupIndex.get(abbr) ?? null;
    if (!context) return -1;
    const rating = getBatterRating({
      context,
      stats: deps.getPlayerLine(p.name, p.editorial_team_abbr),
      scoredCategories: deps.scoredBatterCategories,
      focusMap: deps.focusMap,
      battingOrder: p.batting_order,
    });
    const boost = dhTeams.has(abbr) ? DH_BOOST : 0;
    return boost + rating.score / 100;
  };

  const slotDefs = buildBattingSlots(deps.rosterPositions);
  const overrides = optimizeLineup(slotDefs, roster, getScore);

  if (overrides.size === 0) {
    return { date, saved: false, changeCount: 0 };
  }

  const players = roster.map(p => ({
    player_key: p.player_key,
    position: overrides.get(p.player_key) ?? p.selected_position,
  }));
  await saveLineup(deps.teamKey, date, players);
  return { date, saved: true, changeCount: overrides.size };
}

/**
 * Run the lineup optimizer for every day from `start` through the end of
 * the current fantasy week (Sunday). Each day is fetched, optimized, and
 * saved sequentially so we don't burn through Yahoo's rate limit in
 * parallel and so a partial failure produces a clean per-day report.
 */
export async function optimizeWeek(
  start: string,
  deps: OptimizeWeekDeps,
  onProgress?: (date: string, index: number, total: number) => void,
): Promise<OptimizeWeekResult> {
  const dates = datesThroughEndOfWeek(start);
  const results: DayResult[] = [];
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    onProgress?.(date, i, dates.length);
    try {
      results.push(await optimizeOneDay(date, deps));
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
