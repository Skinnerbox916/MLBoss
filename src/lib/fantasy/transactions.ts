import { YahooFantasyAPI, TransactionEntry } from '@/lib/yahoo-fantasy-api';
import { withCache, CACHE_CATEGORIES } from './cache';

/**
 * Get league transactions with caching.
 * Uses Dynamic caching (1-minute TTL) — transactions happen frequently.
 * @param type - Optional filter: 'add', 'drop', 'trade'
 */
export async function getLeagueTransactions(
  userId: string,
  leagueKey: string,
  type?: 'add' | 'drop' | 'trade',
): Promise<TransactionEntry[]> {
  const typeSuffix = type ? `:${type}` : ':all';
  return withCache(
    `${CACHE_CATEGORIES.DYNAMIC.prefix}:transactions:${leagueKey}${typeSuffix}`,
    CACHE_CATEGORIES.DYNAMIC.ttl,
    () => new YahooFantasyAPI(userId).getLeagueTransactions(leagueKey, type),
  );
}
