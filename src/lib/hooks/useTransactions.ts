import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { TransactionEntry } from '@/lib/yahoo-fantasy-api';

/**
 * Get league transactions with optional type filter.
 */
export function useTransactions(leagueKey: string | undefined, type?: 'add' | 'drop' | 'trade') {
  const typeParam = type ? `&type=${type}` : '';
  const { data, error, isLoading } = useSWR(
    leagueKey ? `/api/fantasy/transactions?leagueKey=${leagueKey}${typeParam}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  return {
    transactions: (data?.transactions ?? []) as TransactionEntry[],
    isLoading,
    isError: !!error,
  };
}
