// Utility functions and types for stats handling

export interface CategoryStat {
  name: string;
  displayName: string;
  id?: string;
  myStat: string | number;
  opponentStat: string | number;
  winning: boolean | null;
  isHigherBetter: boolean;
  delta?: number;
}

export type StatGroup = 'batting' | 'pitching';

export interface GroupedStats {
  batting: CategoryStat[];
  pitching: CategoryStat[];
}

/**
 * Calculate if a team is winning in a category based on stat values and whether higher is better
 */
export function calculateWinning(myStat: string | number, opponentStat: string | number, isHigherBetter: boolean): boolean | null {
  // Convert values to numbers for comparison
  const myValue = typeof myStat === 'string' ? parseFloat(myStat) : myStat;
  const opponentValue = typeof opponentStat === 'string' ? parseFloat(String(opponentStat)) : opponentStat;
  
  // Handle invalid values
  if (isNaN(myValue) || isNaN(opponentValue) || myStat === '-' || opponentStat === '-') return null;
  
  // Handle ties
  if (myValue === opponentValue) return null;
  
  // Determine winning based on isHigherBetter flag
  if (isHigherBetter) {
    return myValue > opponentValue;
  } else {
    return myValue < opponentValue;
  }
}

/**
 * Calculate the delta between my stat and opponent stat
 */
export function calculateDelta(myStat: string | number, opponentStat: string | number, isHigherBetter: boolean): number {
  // Handle percentage stats (strings with decimal points)
  if (typeof myStat === 'string' && myStat.includes('.') && !myStat.startsWith('0')) {
    const myValue = parseFloat(myStat);
    const opponentValue = parseFloat(String(opponentStat));
    
    // Always use the simple difference (my - opponent) without inversion
    return myValue - opponentValue;
  }
  
  // Handle number stats
  const myValue = typeof myStat === 'string' ? parseInt(myStat, 10) : myStat;
  const opponentValue = typeof opponentStat === 'string' ? parseInt(String(opponentStat), 10) : opponentStat;
  
  // Always use the simple difference (my - opponent) without inversion
  return myValue - opponentValue;
}

/**
 * Process all categories to add delta values and ensure winning flag is set properly
 */
export function processCategoryStats(categories: CategoryStat[]): CategoryStat[] {
  return categories.map(cat => {
    // Skip categories that don't contribute to scoring
    if (cat.name === 'H/AB') return cat;
    
    // Calculate delta (with appropriate sign inversion for display)
    const delta = calculateDelta(cat.myStat, cat.opponentStat, cat.isHigherBetter);
    
    // Always calculate winning here (single source of truth)
    const winning = calculateWinning(cat.myStat, cat.opponentStat, cat.isHigherBetter);
    
    return {
      ...cat,
      delta,
      winning
    };
  });
}

/**
 * Group categories into batting and pitching
 */
export function groupCategoriesByType(categories: CategoryStat[]): GroupedStats {
  // Default groups
  const grouped: GroupedStats = {
    batting: [],
    pitching: []
  };

  // Process all categories
  categories.forEach(cat => {
    // Skip non-scoring categories
    if (cat.name === 'H/AB') return;
    
    // Handle special case for Ks - we need to differentiate between batter and pitcher Ks
    if (cat.name === 'K' || cat.name === 'SO') {
      // Batter Ks - lower is better
      if (cat.displayName === 'Batter Ks' || cat.isHigherBetter === false) {
        grouped.batting.push(cat);
      }
      // Pitcher Ks - higher is better
      else if (cat.displayName === 'Pitcher Ks' || cat.isHigherBetter === true) {
        grouped.pitching.push(cat);
      }
      // If not explicitly classified, use a best guess
      else {
        if (cat.isHigherBetter) {
          grouped.pitching.push({...cat, displayName: 'Pitcher Ks'});
        } else {
          grouped.batting.push({...cat, displayName: 'Batter Ks'});
        }
      }
      return;
    }
    
    // Standard categorization
    if (['R', 'H', 'HR', 'RBI', 'SB', 'BB', 'AVG', 'OBP', 'SLG', 'OPS', 'TB'].includes(cat.name)) {
      grouped.batting.push(cat);
    } else if (['W', 'SV', 'ERA', 'WHIP', 'QS', 'IP', 'BS', 'HD'].includes(cat.name)) {
      grouped.pitching.push(cat);
    }
  });
  
  return grouped;
}

/**
 * Calculate win-loss-tie record based on category comparisons
 */
export function calculateRecord(categories: CategoryStat[]): { wins: number, losses: number, ties: number } {
  const record = {
    wins: 0,
    losses: 0,
    ties: 0
  };
  
  categories.forEach(cat => {
    // Skip non-scoring categories
    if (cat.name === 'H/AB') return;
    
    if (cat.winning === true) record.wins++;
    else if (cat.winning === false) record.losses++;
    else record.ties++;
  });
  
  return record;
} 