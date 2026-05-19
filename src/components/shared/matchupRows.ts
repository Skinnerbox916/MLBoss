import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';

/**
 * Head-to-head category row — single source of truth for Boss scoreboard UI,
 * W/L tally, and matchup analysis input.
 *
 * Two independent notions (do not conflate):
 *
 * 1. **`countsTowardRecord`** — Whether this category contributes to the
 *    headline W/L/T. When only one side has a parseable number, we still count
 *    the cat: whoever has the number leads (missing side is behind). That
 *    covers counting stats and ratio cats (ERA, WHIP) the same way.
 *
 * 2. **Comparable pair** — Use `rowHasComparablePair(row)`: both `myVal` and
 *    `oppVal` parse as finite numbers. Required for margins, leverage, and
 *    `composeCorrectedRows` blending. Asymmetric record rows intentionally
 *    fail this so the recommendation engine does not invent a gap from "5 vs —".
 */
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
  /** Whether this category counts toward the H2H W/L/T headline. */
  countsTowardRecord: boolean;
  /** Whether this is a batter or pitcher category — useful when the consumer
   *  splits the rail visually. */
  isBatterStat: boolean;
  isPitcherStat: boolean;
  /** Sort direction from the league's category settings. "lower" for stats
   *  like ERA/WHIP, "higher" for the rest. Carried through so downstream
   *  analysis (margin, suggested focus) doesn't have to re-look it up. */
  betterIs: 'higher' | 'lower';
}

/** True when the cell should show a formatted number (not our placeholder em-dash). */
export function matchupCellShowsNumeric(val: string): boolean {
  if (val === '—') return false;
  return Number.isFinite(parseFloat(val));
}

/** Both sides have finite values — use for margins, signal, and projection compose. */
export function rowHasComparablePair(row: MatchupRow): boolean {
  return matchupCellShowsNumeric(row.myVal) && matchupCellShowsNumeric(row.oppVal);
}

function parseSide(raw: string | undefined): { n: number; live: boolean } {
  if (raw === undefined) return { n: NaN, live: false };
  const n = parseFloat(raw);
  return { n, live: Number.isFinite(n) };
}

/**
 * Build a category-by-category head-to-head row set from two stat maps.
 *
 * Yahoo sometimes omits stats (ratio cats with 0 IP, early-week counting gaps).
 * We always emit a row per league category: each side shows a raw string or
 * "—", `countsTowardRecord` follows the rules in the `MatchupRow` docblock, and
 * `rowHasComparablePair` tells you when two-sided math is safe.
 */
export function buildMatchupRows(
  cats: EnrichedLeagueStatCategory[],
  myMap: Map<number, string>,
  oppMap: Map<number, string>,
): MatchupRow[] {
  return cats.map(cat => {
    const myRaw = myMap.get(cat.stat_id);
    const oppRaw = oppMap.get(cat.stat_id);
    const { n: myNum, live: myLive } = parseSide(myRaw);
    const { n: oppNum, live: oppLive } = parseSide(oppRaw);

    if (!myLive || !oppLive) {
      let winning: boolean | null = null;
      let countsTowardRecord = false;
      // One-sided row: whoever has a parseable number leads the cat (missing
      // side is behind). Same for higher- and lower-is-better; `betterIs`
      // only matters when both sides are live (delta below).
      if (myLive && !oppLive) {
        winning = true;
        countsTowardRecord = true;
      } else if (!myLive && oppLive) {
        winning = false;
        countsTowardRecord = true;
      }
      return {
        label: cat.display_name,
        name: cat.display_name,
        statId: cat.stat_id,
        myVal: myLive ? myRaw! : '—',
        oppVal: oppLive ? oppRaw! : '—',
        winning,
        countsTowardRecord,
        isBatterStat: cat.is_batter_stat,
        isPitcherStat: cat.is_pitcher_stat,
        betterIs: cat.betterIs,
      };
    }

    const delta = myNum - oppNum;
    const winning = delta === 0 ? null : cat.betterIs === 'higher' ? delta > 0 : delta < 0;
    return {
      label: cat.display_name,
      name: cat.display_name,
      statId: cat.stat_id,
      myVal: myRaw!,
      oppVal: oppRaw!,
      winning,
      countsTowardRecord: true,
      isBatterStat: cat.is_batter_stat,
      isPitcherStat: cat.is_pitcher_stat,
      betterIs: cat.betterIs,
    };
  });
}

/** Tally W/L/T from a row set. Only rows with `countsTowardRecord` contribute. */
export function tallyMatchupRows(rows: MatchupRow[]): { wins: number; losses: number; ties: number } {
  const live = rows.filter(r => r.countsTowardRecord);
  return {
    wins: live.filter(r => r.winning === true).length,
    losses: live.filter(r => r.winning === false).length,
    ties: live.filter(r => r.winning === null).length,
  };
}
