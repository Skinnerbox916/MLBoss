/**
 * Pitcher quality — Model layer.
 *
 * Pure functions that classify a pitcher into a tier from already-fetched
 * stats. The orchestrator (../players.ts:getPitcherQuality) is responsible
 * for fetching the inputs and deciding which season's sample to feed in.
 *
 * IMPORTANT: this is NOT the canonical pitcher-talent score for streaming
 * decisions — that lives in src/lib/pitching/quality.ts (`pitcherTalentScore`)
 * and is a richer continuous score over Savant data. The tier here is a
 * coarse 5-bucket categorical signal used by the matchup UI to surface
 * "you're facing an ace today" / "you're facing a bad pitcher today".
 *
 * Hard rule: this file MUST NOT import from ../source/.
 */

import type { PitcherTier } from '../types';

/**
 * Minimum innings-pitched gates for trusting the season sample. The
 * orchestrator falls back from current to prior season when current IP
 * is below the current threshold.
 */
export const MIN_IP_CURRENT = 25;   // ~ 4-5 starts before current sample is usable
export const MIN_IP_PRIOR = 60;     // rough cut for a meaningful prior season

/**
 * Minimum BIP for Savant xERA to be trusted as the primary ERA signal.
 * Below this threshold the classifier falls back to actual ERA.
 */
export const MIN_BIP_FOR_XERA = 10;

/**
 * Classify a pitcher into a tier using ERA (or xERA when available), WHIP,
 * and K/9.
 *
 * When `xera` is supplied it replaces actual ERA as the primary signal.
 * xERA strips out luck and team defense and stabilises much faster (~50 BIP
 * vs ~200 IP for ERA), so it's a better classifier at any sample size.
 *
 * Base tiers (effectiveERA + WHIP):
 *   ace:     ERA <= 2.75 AND WHIP <= 1.05
 *   tough:   ERA <= 3.50 AND WHIP <= 1.20
 *   bad:     ERA >= 5.00 AND WHIP >= 1.45
 *   weak:    ERA >= 4.25 OR  WHIP >= 1.36
 *   average: everything in between
 *
 * K/9 adjustments:
 *   tough + K/9 >= 10.0 -> ace (elite K rate = dominant)
 *   average + K/9 <= 5.5 -> weak (can't miss bats, vulnerable to hard contact)
 *
 * Caller is responsible for enforcing the IP/BIP sample gate before invoking.
 */
export function classifyPitcherTier(
  era: number | null,
  whip: number | null,
  k9: number | null = null,
  xera: number | null = null,
): PitcherTier {
  const effectiveEra = xera ?? era;
  if (effectiveEra === null || whip === null) return 'unknown';

  if (effectiveEra <= 2.75 && whip <= 1.05) return 'ace';
  if (effectiveEra >= 5.00 && whip >= 1.45) return 'bad';
  if (effectiveEra <= 3.50 && whip <= 1.20) {
    if (k9 !== null && k9 >= 10.0) return 'ace';
    return 'tough';
  }
  if (effectiveEra >= 4.25 || whip >= 1.36) return 'weak';
  if (k9 !== null && k9 <= 5.5) return 'weak';
  return 'average';
}
