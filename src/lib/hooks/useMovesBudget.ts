import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { MovesBudget } from '@/lib/fantasy/limits';

export type MovesBudgetResponse = MovesBudget & {
  leagueKey: string;
  teamKey: string;
};

/**
 * Weekly transaction budget (league add cap, adds used, adds left) for the
 * active team. Mode-agnostic — any page can surface "moves left" with this.
 * `used` comes from a ~10-min-cached team fetch, so treat it as display
 * context, not a gate.
 */
export function useMovesBudget(
  leagueKey: string | undefined,
  teamKey: string | undefined,
) {
  const canFetch = Boolean(leagueKey && teamKey);
  const url = canFetch
    ? `/api/fantasy/moves?leagueKey=${encodeURIComponent(leagueKey!)}&teamKey=${encodeURIComponent(teamKey!)}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<MovesBudgetResponse>(url, fetcher, {
    revalidateOnFocus: false,
  });

  return { data, isLoading, isError: !!error, mutate };
}
