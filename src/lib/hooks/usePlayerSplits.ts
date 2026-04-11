import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { BatterSplits, MLBPlayerIdentity, SplitLine } from '@/lib/mlb/types';

interface PlayerSplitsResponse {
  identity: MLBPlayerIdentity;
  splits: BatterSplits | null;
  careerVsPitcher: SplitLine | null;
}

/**
 * Fetch batter splits for a player by name + team.
 * Optionally pass pitcherId to get career stats vs that specific pitcher.
 *
 * Results cached 1 hour server-side; SWR adds client-side deduplication.
 */
export function usePlayerSplits(
  name: string | undefined,
  team: string | undefined,
  options?: { season?: number; pitcherId?: number },
) {
  const params = new URLSearchParams();
  if (name) params.set('name', name);
  if (team) params.set('team', team);
  if (options?.season) params.set('season', String(options.season));
  if (options?.pitcherId) params.set('pitcherId', String(options.pitcherId));

  const { data, error, isLoading } = useSWR<PlayerSplitsResponse>(
    name ? `/api/mlb/player-splits?${params.toString()}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  return {
    identity: data?.identity ?? null,
    splits: data?.splits ?? null,
    careerVsPitcher: data?.careerVsPitcher ?? null,
    isLoading,
    isError: !!error,
  };
}
