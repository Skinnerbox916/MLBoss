import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { ScoringProfile } from '@/lib/fantasy/scoringProfile';

/**
 * Fetch the active league's full ScoringProfile (mode + per-stat point
 * weights) for client-side points scoring. Deferred until a points league is
 * known (null key for categories / unset), since categories scoring needs no
 * weights. Static-tier cached server-side, so this is cheap.
 */
export function useScoringProfile(
  leagueKey: string | undefined,
  scoringType: string | undefined,
  enabled: boolean,
) {
  const url = enabled && leagueKey
    ? `/api/points/profile?leagueKey=${encodeURIComponent(leagueKey)}&scoringType=${encodeURIComponent(scoringType ?? '')}`
    : null;
  const { data, error, isLoading } = useSWR<ScoringProfile>(url, fetcher, { revalidateOnFocus: false });
  return { profile: data, isLoading, isError: !!error };
}
