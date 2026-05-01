const RATE_STATS = new Set(['AVG', 'OBP', 'SLG', 'OPS']);
const TWO_DECIMAL_STATS = new Set(['ERA', 'WHIP']);

function isRateStat(name: string): boolean {
  return RATE_STATS.has(name);
}

function isTwoDecimalStat(name: string): boolean {
  return TWO_DECIMAL_STATS.has(name);
}

export function formatStatValue(value: number | null | string, name: string): string {
  if (value === null || value === undefined) return '-';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return typeof value === 'string' ? value : '-';
  if (isRateStat(name)) return num.toFixed(3).replace(/^0\./, '.');
  if (isTwoDecimalStat(name)) return num.toFixed(2);
  if (name === 'IP') return num.toFixed(1);
  return Number.isInteger(num) ? num.toString() : num.toFixed(2);
}

export function formatStatDelta(delta: number, name: string): string {
  if (delta === 0) return '0';
  if (isRateStat(name)) {
    const abs = Math.abs(delta);
    return (delta < 0 ? '-' : '+') + abs.toFixed(3).replace(/^0\./, '.');
  }
  const sign = delta > 0 ? '+' : '';
  if (isTwoDecimalStat(name)) return sign + delta.toFixed(2);
  if (name === 'IP') return sign + delta.toFixed(1);
  return sign + (Number.isInteger(delta) ? delta.toString() : delta.toFixed(3));
}
