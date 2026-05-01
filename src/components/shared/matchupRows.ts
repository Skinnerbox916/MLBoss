import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';

export interface MatchupRow {
  /** Display label (e.g. "HR", "ERA"). */
  label: string;
  /** Yahoo stat short name (e.g. "AVG"). Used by `formatStatValue` / `formatStatDelta`. */
  name: string;
  /** Numeric stat id. */
  statId: number;
  /** Raw value strings as Yahoo returned them, or em-dashes when missing. */
  myVal: string;
  oppVal: string;
  /** True when the user is winning this category, false when losing, null when tied. */
  winning: boolean | null;
  /** False when either side is missing data — render the row as a placeholder. */
  hasData: boolean;
  /** Whether this is a batter or pitcher category — useful when the consumer
   *  splits the rail visually. */
  isBatterStat: boolean;
  isPitcherStat: boolean;
  /** Sort direction from the league's category settings. "lower" for stats
   *  like ERA/WHIP, "higher" for the rest. Carried through so downstream
   *  analysis (margin, suggested focus) doesn't have to re-look it up. */
  betterIs: 'higher' | 'lower';
}

/**
 * Build a category-by-category head-to-head row set from two stat maps.
 *
 * The `myMap` and `oppMap` are both keyed by `stat_id`. Yahoo sometimes omits
 * ratio stats (ERA / WHIP) when 0 IP and occasionally drops counting stats
 * entirely; in those cases we still render the category with em-dash
 * placeholders rather than vanishing the tile.
 *
 * Lifted out of `MatchupPulse` so the dashboard `BossCard` (and any future
 * consumer) can share the same win/loss math instead of re-deriving it.
 */
export function buildMatchupRows(
  cats: EnrichedLeagueStatCategory[],
  myMap: Map<number, string>,
  oppMap: Map<number, string>,
): MatchupRow[] {
  return cats.map(cat => {
    const myRaw = myMap.get(cat.stat_id);
    const oppRaw = oppMap.get(cat.stat_id);
    const myNum = myRaw !== undefined ? parseFloat(myRaw) : NaN;
    const oppNum = oppRaw !== undefined ? parseFloat(oppRaw) : NaN;

    if (isNaN(myNum) || isNaN(oppNum)) {
      return {
        label: cat.display_name,
        name: cat.display_name,
        statId: cat.stat_id,
        myVal: '—',
        oppVal: '—',
        winning: null,
        hasData: false,
        isBatterStat: cat.is_batter_stat,
        isPitcherStat: cat.is_pitcher_stat,
        betterIs: cat.betterIs,
      };
    }

    const delta = myNum - oppNum;
    const winning = delta === 0 ? null : cat.betterIs === 'higher' ? delta > 0 : delta < 0;
    return {
      label: cat.display_name,
      // display_name is Yahoo's abbreviation ("IP", "AVG", "ERA", …).
      // formatStatValue and bossBrief rules both key off the abbreviation,
      // not the full name that Yahoo stores in `name` ("Innings Pitched", …).
      name: cat.display_name,
      statId: cat.stat_id,
      myVal: myRaw!,
      oppVal: oppRaw!,
      winning,
      hasData: true,
      isBatterStat: cat.is_batter_stat,
      isPitcherStat: cat.is_pitcher_stat,
      betterIs: cat.betterIs,
    };
  });
}

/** Tally W/L/T from a row set. Rows missing data don't count either way. */
export function tallyMatchupRows(rows: MatchupRow[]): { wins: number; losses: number; ties: number } {
  const live = rows.filter(r => r.hasData);
  return {
    wins: live.filter(r => r.winning === true).length,
    losses: live.filter(r => r.winning === false).length,
    ties: live.filter(r => r.winning === null).length,
  };
}
