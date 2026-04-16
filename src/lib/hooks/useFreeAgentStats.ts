import useSWR from 'swr';
import type { FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';
import type { BatterSeasonStats } from '@/lib/mlb/types';

interface StatsResponse {
  stats: Record<string, BatterSeasonStats>;
}

function makeKey(name: string, team: string): string {
  return `${name.toLowerCase()}|${team.toLowerCase()}`;
}

export function useFreeAgentStats(players: FreeAgentPlayer[]) {
  const entries = players.map(p => ({ name: p.name, team: p.editorial_team_abbr }));

  const cacheKey = entries.length > 0
    ? `fa-stats:${entries.map(p => makeKey(p.name, p.team)).sort().join(',')}`
    : null;

  const { data, isLoading, error } = useSWR<StatsResponse>(
    cacheKey,
    async () => {
      const res = await fetch('/api/mlb/roster-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ players: entries }),
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

  return { statsMap, getPlayerStats, isLoading, isError: !!error };
}
