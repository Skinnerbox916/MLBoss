import useSWR from 'swr';

interface LineupSpotsResponse {
  spots: Record<number, number>;
}

/**
 * Read the cached typical lineup spots for a set of mlbIds. Resolves to
 * a Map<mlbId, spot> that the projection engine can consume directly.
 *
 * Cache key sorts the input ids so the same set produces the same SWR
 * key regardless of input order. Stable: the underlying Redis cache has
 * a 7-day TTL and only changes when getGameDay observes a new posted
 * lineup, so a 5-minute SWR refresh is plenty.
 */
export function useLineupSpots(mlbIds: number[]) {
  const valid = mlbIds.filter(id => Number.isFinite(id) && id > 0);
  const cacheKey = valid.length > 0
    ? `lineup-spots:${[...valid].sort((a, b) => a - b).join(',')}`
    : null;

  const { data, isLoading, error } = useSWR<LineupSpotsResponse>(
    cacheKey,
    async () => {
      const res = await fetch('/api/mlb/lineup-spots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mlbIds: valid }),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      return res.json();
    },
    { revalidateOnFocus: false, refreshInterval: 5 * 60 * 1000 },
  );

  const spots = new Map<number, number>();
  for (const [id, spot] of Object.entries(data?.spots ?? {})) {
    spots.set(Number(id), spot);
  }
  return { spots, isLoading, isError: !!error };
}
