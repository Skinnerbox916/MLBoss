import clsx, { type ClassValue } from 'clsx';

/**
 * Utility function for concatenating and conditionally applying CSS classes.
 * 
 * This is a common pattern in React applications, especially when using Tailwind CSS.
 * It combines clsx functionality for conditional classes.
 * 
 * @param classes - Class values to concatenate
 * @returns A string of concatenated class names
 * 
 * @example
 * ```tsx
 * cn('base-class', condition && 'conditional-class', 'another-class')
 * // Result: 'base-class conditional-class another-class' (if condition is true)
 * ```
 */
export function cn(...classes: ClassValue[]) {
  return clsx(classes);
}

// Baseball IP is stored in "thirds" notation: "58.1" = 58⅓ innings, "58.2" = 58⅔.
// parseFloat gives nonsense for arithmetic (58.1 - 34.2 = 23.9... but .toFixed gives 23.9).
// Yahoo sometimes returns decimal fractions like "34.1125" for partial IP, so we normalize
// via outs to get correct math. Both MLB Stats API and Yahoo use the same thirds convention.
/**
 * Yahoo/MLB IP string → decimal innings, for arithmetic that mixes a
 * matchup-to-date IP total with a projected one (`103.2` is 103⅔ innings,
 * not 103.2 — `parseFloat` silently under-counts by up to ⅔ IP per side).
 * Display keeps the thirds notation; only math goes through here.
 */
export function parseYahooIP(ip: string): number {
  return parseIPToOuts(ip) / 3;
}

export function parseIPToOuts(ip: string): number {
  const val = parseFloat(ip);
  if (isNaN(val)) return 0;
  const innings = Math.floor(val);
  const rem = Math.round((val - innings) * 10);
  return innings * 3 + Math.min(rem, 2);
}
