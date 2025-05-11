/**
 * Adds ordinal suffix to a number (1st, 2nd, 3rd, etc.)
 */
export function getOrdinalSuffix(rank: string | number): string {
  const n = typeof rank === 'string' ? parseInt(rank, 10) : rank;
  if (isNaN(n)) return String(rank);
  
  const j = n % 10;
  const k = n % 100;
  
  if (j === 1 && k !== 11) return `${n}st`;
  if (j === 2 && k !== 12) return `${n}nd`;
  if (j === 3 && k !== 13) return `${n}rd`;
  return `${n}th`;
} 