export type PositionType = 'B' | 'P';

export interface StatMeta {
  id: number;
  name: string;
  display: string;
  positions: PositionType[];
  sortOrder?: '0' | '1'; // 0 = lower is better, 1 = higher is better
}

/**
 * Common MLB stat_id mappings for quick reference.
 * This is a subset of the full Yahoo stat categories.
 * For complete data, use the Yahoo API stat_categories endpoint.
 */
export const COMMON_MLB_STATS: Record<number, StatMeta> = {
  // Batting Statistics
  3:  { id: 3,  name: 'Batting Average',   display: 'AVG',  positions: ['B'], sortOrder: '1' },
  7:  { id: 7,  name: 'Runs',              display: 'R',    positions: ['B'], sortOrder: '1' },
  8:  { id: 8,  name: 'Hits',              display: 'H',    positions: ['B'], sortOrder: '1' },
  12: { id: 12, name: 'Home Runs',         display: 'HR',   positions: ['B'], sortOrder: '1' },
  13: { id: 13, name: 'Runs Batted In',    display: 'RBI',  positions: ['B'], sortOrder: '1' },
  16: { id: 16, name: 'Stolen Bases',      display: 'SB',   positions: ['B'], sortOrder: '1' },
  18: { id: 18, name: 'Walks',             display: 'BB',   positions: ['B'], sortOrder: '1' },
  21: { id: 21, name: 'Strikeouts',        display: 'K',    positions: ['B'], sortOrder: '0' },
  23: { id: 23, name: 'Total Bases',       display: 'TB',   positions: ['B'], sortOrder: '1' },

  // Pitching Statistics
  25: { id: 25, name: 'Games Started',      display: 'GS',   positions: ['P'], sortOrder: '1' },
  26: { id: 26, name: 'Earned Run Average', display: 'ERA',  positions: ['P'], sortOrder: '0' },
  27: { id: 27, name: 'WHIP',              display: 'WHIP', positions: ['P'], sortOrder: '0' },
  28: { id: 28, name: 'Wins',              display: 'W',    positions: ['P'], sortOrder: '1' },
  29: { id: 29, name: 'Losses',            display: 'L',    positions: ['P'], sortOrder: '0' },
  30: { id: 30, name: 'Complete Games',    display: 'CG',   positions: ['P'], sortOrder: '1' },
  32: { id: 32, name: 'Saves',             display: 'SV',   positions: ['P'], sortOrder: '1' },
  42: { id: 42, name: 'Strikeouts',        display: 'K',    positions: ['P'], sortOrder: '1' },
  48: { id: 48, name: 'Holds',             display: 'HLD',  positions: ['P'], sortOrder: '1' },
  50: { id: 50, name: 'Innings Pitched',   display: 'IP',   positions: ['P'], sortOrder: '1' },
  83: { id: 83, name: 'Quality Starts',    display: 'QS',   positions: ['P'], sortOrder: '1' },
  84: { id: 84, name: 'Blown Saves',       display: 'BSV',  positions: ['P'], sortOrder: '0' },

  // Shared Statistics
  0:  { id: 0,  name: 'Games Played',      display: 'GP',   positions: ['P', 'B'], sortOrder: '1' }
};

/**
 * Check if a stat_id is for batters.
 * 
 * @example
 *   import { isBatterStat } from '@/constants/statCategories';
 *   if (isBatterStat(21)) console.log('Batter strikeouts');
 */
export function isBatterStat(statId: number): boolean {
  return COMMON_MLB_STATS[statId]?.positions.includes('B') ?? false;
}

/**
 * Check if a stat_id is for pitchers.
 * 
 * @example
 *   import { isPitcherStat } from '@/constants/statCategories';
 *   if (isPitcherStat(42)) console.log('Pitcher strikeouts');
 */
export function isPitcherStat(statId: number): boolean {
  return COMMON_MLB_STATS[statId]?.positions.includes('P') ?? false;
}

/**
 * Get display name for a stat_id.
 * 
 * @example
 *   import { getStatDisplay } from '@/constants/statCategories';
 *   console.log(getStatDisplay(12)); // "HR"
 */
export function getStatDisplay(statId: number): string {
  return COMMON_MLB_STATS[statId]?.display ?? `stat_${statId}`;
}

/**
 * Disambiguate stats with same name by position.
 * 
 * @example
 *   import { disambiguateStatName } from '@/constants/statCategories';
 *   console.log(disambiguateStatName(21)); // "Batter K"
 *   console.log(disambiguateStatName(42)); // "Pitcher K"
 */
export function disambiguateStatName(statId: number): string {
  const stat = COMMON_MLB_STATS[statId];
  if (!stat) return `Unknown stat ${statId}`;
  
  if (stat.positions.length === 1) {
    const prefix = stat.positions[0] === 'B' ? 'Batter' : 'Pitcher';
    return `${prefix} ${stat.display}`;
  }
  
  return stat.display; // Shared stats don't need disambiguation
} 