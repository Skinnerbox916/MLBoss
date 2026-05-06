import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { EnrichedGame } from '@/lib/mlb/types';

export type { EnrichedGame };

interface GameDayResponse {
  date: string;
  games: EnrichedGame[];
}

/**
 * Fetch all MLB games for a given date with probable pitchers, weather, and park data.
 * Refreshes every 5 minutes — probable pitchers get confirmed close to game time.
 */
export function useGameDay(date: string | undefined) {
  const { data, error, isLoading } = useSWR<GameDayResponse>(
    date ? `/api/mlb/game-day?date=${date}` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 5 * 60 * 1000 },
  );

  return {
    games: data?.games ?? [],
    date: data?.date,
    isLoading,
    isError: !!error,
  };
}

/**
 * Find the game for a specific team abbreviation on the given date.
 */
export function useTeamGame(teamAbbr: string | undefined, date: string | undefined) {
  const { games, isLoading, isError } = useGameDay(date);

  const abbr = teamAbbr?.toUpperCase();
  const game = abbr
    ? games.find(
        g =>
          g.homeTeam.abbreviation.toUpperCase() === abbr ||
          g.awayTeam.abbreviation.toUpperCase() === abbr,
      ) ?? null
    : null;

  return { game, isLoading, isError };
}
