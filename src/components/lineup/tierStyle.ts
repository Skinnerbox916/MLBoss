/**
 * Shared row tier → border/background tint. One source of truth for both the
 * categories lineup (matchup-rating tier) and the points lineup (value tier),
 * so the two surfaces tint identically and a future change hits one place.
 */
export type RowTier = 'great' | 'good' | 'neutral' | 'poor' | 'bad';

export function tierStyle(tier: RowTier): { border: string; bg: string } {
  switch (tier) {
    case 'great':   return { border: 'border-l-success',    bg: 'bg-success/5' };
    case 'good':    return { border: 'border-l-success/50', bg: 'bg-success/5' };
    case 'neutral': return { border: 'border-l-border',     bg: '' };
    case 'poor':    return { border: 'border-l-error/50',   bg: 'bg-error/5' };
    case 'bad':     return { border: 'border-l-error',      bg: 'bg-error/5' };
  }
}

/**
 * Map a points-per-game projection to the same 5-tier scale categories uses
 * for matchup quality, so a strong points bat reads "green" like a strong
 * matchup does. Anchored to the ~6.6 pts/game league-average regular.
 */
export function pointsTierForPerGame(perGame: number): RowTier {
  if (perGame >= 9) return 'great';
  if (perGame >= 7.5) return 'good';
  if (perGame >= 6) return 'neutral';
  if (perGame >= 4.5) return 'poor';
  return 'bad';
}
