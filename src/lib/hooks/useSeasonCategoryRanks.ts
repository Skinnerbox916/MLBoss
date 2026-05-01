'use client';

import { useMemo } from 'react';
import { useStandings } from './useStandings';
import { useLeagueCategories } from './useLeagueCategories';

/**
 * Per-category rank for the user's team derived from season-to-date
 * standings — the same data and ranking math as the league page's
 * "Stat Rankings" table. Use this anywhere you need "where do I sit
 * for the season" so multiple surfaces don't disagree.
 */
export interface CategoryRank {
  statId: number;
  name: string;
  displayName: string;
  betterIs: 'higher' | 'lower';
  myValue: number;
  leaderValue: number;
  myRank: number;
  teamCount: number;
  /** `leaderValue - myValue` for higher-is-better, `myValue - leaderValue` for lower. */
  delta: number;
  leagueMean: number;
  /** Population standard deviation across ranked teams. `0` when all teams are tied. */
  leagueStdDev: number;
  /**
   * Directional z-score: `(myValue - mean) / stdDev`, sign-flipped for
   * lower-is-better stats so positive always means "good". `0` when stdDev
   * is 0 (everyone tied — gap is not meaningful).
   */
  zScore: number;
}

function parseNumeric(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = parseFloat(raw);
  return isNaN(n) ? null : n;
}

/**
 * Compute the user's per-category league rank from season-to-date
 * standings. Mirrors the league page's `rankTeams` ordering so the
 * roster page shows the same number you see on /league.
 *
 * Returns an empty list when standings or categories aren't loaded yet,
 * or when the user's team isn't in the standings response.
 */
export function useSeasonCategoryRanks(
  leagueKey: string | undefined,
  teamKey: string | undefined,
) {
  const { standings, isLoading: standingsLoading, isError: standingsError } = useStandings(leagueKey);
  const { categories, isLoading: catsLoading } = useLeagueCategories(leagueKey);

  const isLoading = standingsLoading || catsLoading;

  const ranks = useMemo<CategoryRank[]>(() => {
    if (!teamKey || categories.length === 0 || standings.length === 0) return [];

    const results: CategoryRank[] = [];
    for (const cat of categories) {
      // Map (teamKey, value) for this stat. Match the league page exactly:
      // null values sink to the bottom; higher/lower-is-better drives sort.
      const scored: Array<{ teamKey: string; value: number }> = [];
      for (const t of standings) {
        const entry = (t.stats ?? []).find(s => s.stat_id === cat.stat_id);
        const v = parseNumeric(entry?.value);
        if (v === null) continue;
        scored.push({ teamKey: t.team_key, value: v });
      }
      if (scored.length === 0) continue;

      scored.sort((a, b) =>
        cat.betterIs === 'higher' ? b.value - a.value : a.value - b.value,
      );

      const mineIdx = scored.findIndex(s => s.teamKey === teamKey);
      if (mineIdx === -1) continue;

      const myEntry = scored[mineIdx];
      const leader = scored[0];
      const delta = cat.betterIs === 'higher'
        ? leader.value - myEntry.value
        : myEntry.value - leader.value;

      const n = scored.length;
      const mean = scored.reduce((s, x) => s + x.value, 0) / n;
      const variance = scored.reduce((s, x) => s + (x.value - mean) ** 2, 0) / n;
      const stdDev = Math.sqrt(variance);
      const rawZ = stdDev === 0 ? 0 : (myEntry.value - mean) / stdDev;
      const zScore = cat.betterIs === 'higher' ? rawZ : -rawZ;

      results.push({
        statId: cat.stat_id,
        name: cat.name,
        displayName: cat.display_name,
        betterIs: cat.betterIs,
        myValue: myEntry.value,
        leaderValue: leader.value,
        myRank: mineIdx + 1,
        teamCount: n,
        delta,
        leagueMean: mean,
        leagueStdDev: stdDev,
        zScore,
      });
    }

    return results;
  }, [teamKey, categories, standings]);

  return {
    ranks,
    isLoading,
    isError: standingsError,
  };
}
