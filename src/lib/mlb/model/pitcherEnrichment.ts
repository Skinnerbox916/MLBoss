/**
 * Pitcher enrichment — Model layer.
 *
 * Pure functions that take fetched data (Stats API line, Savant snapshot,
 * platoon, recent form) and apply it to a `ProbablePitcher` object. No I/O.
 *
 * The orchestrator (`../schedule.ts:enrichPitcher`) does the fetching;
 * these helpers do the math.
 */

import type { PitcherSeasonLine } from './playerStats';
import { blendRateOrNull, computePitcherTalentXwobaAllowed } from '../talentModel';
import type { ProbablePitcher, StatcastPitcher } from '../types';

/** Apply a freshly-fetched Stats API line to a ProbablePitcher in place. */
export function applyPitcherStatsLine(p: ProbablePitcher, line: PitcherSeasonLine | null): void {
  if (!line) return;
  p.era = line.era ?? p.era;
  p.whip = line.whip ?? p.whip;
  p.wins = line.wins || p.wins;
  p.losses = line.losses || p.losses;
  p.inningsPitched = line.ip || p.inningsPitched;
  p.strikeoutsPer9 = line.strikeoutsPer9 ?? p.strikeoutsPer9;
  p.strikeOuts = line.strikeOuts ?? p.strikeOuts;
  p.gamesStarted = line.gamesStarted ?? p.gamesStarted;
  p.pitchesPerInning = line.pitchesPerInning ?? p.pitchesPerInning;
  p.inningsPerStart = line.inningsPerStart ?? p.inningsPerStart;
  p.bb9 = line.bb9 ?? p.bb9;
  p.hr9 = line.hr9 ?? p.hr9;
  p.battingAvgAgainst = line.battingAvgAgainst ?? p.battingAvgAgainst;
  p.gbRate = line.gbRate ?? p.gbRate;
}

/**
 * Apply Savant-derived signals to a ProbablePitcher in place.
 *
 * - `xera` uses the simple sample-weighted `blendRateOrNull` (UI-only
 *   secondary). No league anchor — UI shows "—" when both years are null.
 * - `xwoba` (the primary "how good is this pitcher" signal) uses the
 *   component talent model — decompose to K%/BB%/xwOBACON-allowed,
 *   regress each independently, recompose.
 * - `avgFastballVelo` is current-only (with prior exposed for YoY delta).
 * - `runValuePer100` uses tighter blend defaults than xERA (priorCap=80,
 *   leagueMean=0, leaguePriorN=150). RV/100 is consumed as PRIMARY talent
 *   in getPitcherRating, so a thin-current blend that leans 90% on last
 *   year is worse than useless (e.g. the 12-ERA 2026 Mikolas case showing
 *   -1.45 RV/100 because the default 150-BIP cap let prior dominate).
 */
export function applySavantSignals(
  p: ProbablePitcher,
  currentSavant: StatcastPitcher | undefined,
  priorSavant: StatcastPitcher | undefined,
): void {
  p.xera = blendRateOrNull({
    current: currentSavant?.xera ?? null,
    currentN: currentSavant?.bip ?? 0,
    prior: priorSavant?.xera ?? null,
    priorN: priorSavant?.bip ?? 0,
    leagueMean: 0,
    leaguePriorN: 0,
    priorCap: 150,
  });
  const pitcherTalent = computePitcherTalentXwobaAllowed(currentSavant, priorSavant);
  p.xwoba = pitcherTalent?.xwoba ?? null;
  p.avgFastballVelo = currentSavant?.avgFastballVelo ?? null;
  p.avgFastballVeloPrior = priorSavant?.avgFastballVelo ?? null;
  p.runValuePer100 = blendRateOrNull({
    current: currentSavant?.runValuePer100 ?? null,
    currentN: currentSavant?.pa ?? 0,
    prior: priorSavant?.runValuePer100 ?? null,
    priorN: priorSavant?.pa ?? 0,
    leagueMean: 0,
    leaguePriorN: 150,
    priorCap: 80,
  });
}

/** Apply platoon splits to a ProbablePitcher in place. */
export function applyPitcherPlatoon(
  p: ProbablePitcher,
  platoon: { vsLeft: { ops: number | null } | null; vsRight: { ops: number | null } | null } | null,
): void {
  p.platoonOpsVsLeft = platoon?.vsLeft?.ops ?? null;
  p.platoonOpsVsRight = platoon?.vsRight?.ops ?? null;
}

/** Apply last-N-starts ERA to a ProbablePitcher in place. */
export function applyPitcherRecentForm(
  p: ProbablePitcher,
  recentForm: { era: number | null; ip: number } | null,
): void {
  p.recentFormEra = recentForm?.era ?? null;
}
