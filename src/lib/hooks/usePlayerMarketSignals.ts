import useSWR from 'swr';

export interface PlayerMarketSignals {
  percent_owned?: number;
  average_draft_pick?: number;
  percent_drafted?: number;
}

async function fetchMarketSignals(
  _key: string,
  { arg }: { arg: string[] },
): Promise<Record<string, PlayerMarketSignals>> {
  if (arg.length === 0) return {};
  const res = await fetch('/api/fantasy/market-signals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player_keys: arg }),
  });
  if (!res.ok) throw new Error(`Market signals error: ${res.status}`);
  const data = await res.json();
  return (data.signals ?? {}) as Record<string, PlayerMarketSignals>;
}

/**
 * Batch-fetch market signals (current percent_owned + preseason draft data)
 * for the given player_keys. The sorted key list is part of the SWR cache
 * identity, so reorderings hit the same cache entry.
 */
export function usePlayerMarketSignals(playerKeys: string[]) {
  const sorted = [...playerKeys].sort();
  const cacheKey = sorted.length > 0 ? `market-signals:${sorted.join(',')}` : null;
  const { data, error, isLoading } = useSWR(
    cacheKey,
    () => fetchMarketSignals(cacheKey ?? '', { arg: sorted }),
    { revalidateOnFocus: false, revalidateIfStale: false, dedupingInterval: 60_000 },
  );

  return {
    signals: (data ?? {}) as Record<string, PlayerMarketSignals>,
    isLoading,
    isError: !!error,
  };
}
