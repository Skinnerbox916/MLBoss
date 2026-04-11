import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';

export function useLeagueCategories(leagueKey: string | undefined) {
  const { data, error, isLoading } = useSWR(
    leagueKey ? `/api/league/${leagueKey}/categories` : null,
    fetcher,
    {
      revalidateOnFocus: false,
    }
  );

  return {
    categories: (data?.all_categories ?? []) as EnrichedLeagueStatCategory[],
    isLoading,
    isError: !!error,
  };
} 