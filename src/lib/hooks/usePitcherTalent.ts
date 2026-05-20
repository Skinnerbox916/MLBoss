import useSWR from 'swr';
import type { RosterEntry, FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';
import type { PitcherTalentWithMetadata } from '@/lib/mlb/players';

interface TalentResponse {
  talent: Record<string, PitcherTalentWithMetadata>;
}

function makeKey(name: string, team: string): string {
  return `${name.toLowerCase()}|${team.toLowerCase()}`;
}

/**
 * Batch-fetch canonical talent vectors for a list of pitchers.
 */
export function usePitcherTalent(players: Array<RosterEntry | FreeAgentPlayer>) {
  const entries = players.map(p => ({ name: p.name, team: p.editorial_team_abbr }));

  const cacheKey = entries.length > 0
    ? `pitcher-talent:${entries.map(p => makeKey(p.name, p.team)).sort().join(',')}`
    : null;

  const { data, isLoading, error } = useSWR<TalentResponse>(
    cacheKey,
    async () => {
      const res = await fetch('/api/mlb/pitcher-talent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ players: entries }),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      return res.json();
    },
    { revalidateOnFocus: false, refreshInterval: 15 * 60 * 1000 },
  );

  const talentMap = data?.talent ?? {};

  function getTalent(name: string, team: string): PitcherTalentWithMetadata | null {
    return talentMap[makeKey(name, team)] ?? null;
  }

  return { talentMap, getTalent, isLoading, isError: !!error };
}
