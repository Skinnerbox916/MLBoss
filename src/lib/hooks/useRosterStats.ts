import useSWR from 'swr';
import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import type { BatterSeasonStats, PlayerStatLine } from '@/lib/mlb/types';
import { fromBatterSeasonStats } from '@/lib/mlb/adapters';

interface RosterStatsResponse {
  stats: Record<string, BatterSeasonStats>;
}

function makeKey(name: string, team: string): string {
  return `${name.toLowerCase()}|${team.toLowerCase()}`;
}

/**
 * Batch-fetch season stats (OPS, AVG, HR, SB, PA) for all players on the
 * roster.  Returns a lookup function that maps (name, team) → BatterSeasonStats.
 *
 * Uses SWR with a POST fetcher; the cache key is derived from the sorted
 * list of player names so identical rosters share the cache entry.
 */
export function useRosterStats(roster: RosterEntry[]) {
  const players = roster.map(p => ({ name: p.name, team: p.editorial_team_abbr }));

  const cacheKey = players.length > 0
    ? `roster-stats:${players.map(p => makeKey(p.name, p.team)).sort().join(',')}`
    : null;

  const { data, isLoading, error } = useSWR<RosterStatsResponse>(
    cacheKey,
    async () => {
      const res = await fetch('/api/mlb/roster-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ players }),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      return res.json();
    },
    { revalidateOnFocus: false, refreshInterval: 10 * 60 * 1000 },
  );

  const statsMap = data?.stats ?? {};

  function getPlayerStats(name: string, team: string): BatterSeasonStats | null {
    return statsMap[makeKey(name, team)] ?? null;
  }

  /**
   * Stratified `PlayerStatLine` view of the same data. New consumers should
   * prefer this over `getPlayerStats` — `current` / `prior` / `talent` /
   * `statcast` / `splits` make the field's stat level explicit.
   */
  function getPlayerLine(name: string, team: string): PlayerStatLine | null {
    const stats = statsMap[makeKey(name, team)];
    return stats ? fromBatterSeasonStats(stats) : null;
  }

  function getPlayerOPS(name: string, team: string): number | null {
    return getPlayerStats(name, team)?.ops ?? null;
  }

  /**
   * Returns xwOBA when Savant has enough data, otherwise falls back to OPS.
   * xwOBA is on a ~0.250-0.400 scale; we map it to OPS-equivalent (multiply
   * by ~2.4) so downstream comparisons stay consistent.
   */
  function getPlayerTalentOPS(name: string, team: string): number | null {
    const stats = getPlayerStats(name, team);
    if (!stats) return null;
    if (stats.xwoba !== null) return stats.xwoba * 2.4;
    return stats.ops;
  }

  return {
    statsMap,
    getPlayerStats,
    getPlayerLine,
    getPlayerOPS,
    getPlayerTalentOPS,
    isLoading,
    isError: !!error,
  };
}
