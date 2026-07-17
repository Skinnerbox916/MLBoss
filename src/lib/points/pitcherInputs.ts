/**
 * Points-league pitcher input assembly.
 *
 * Historically this module owned its own fetch pipeline because the shared
 * `getPitcherTalentBatch` (categories) fetched only the SP-filtered season
 * line — leaving `talent.role` unreliable and relievers looking like 0-IP
 * ghosts. That fork ended 2026-07: the shared batch now fetches the OVERALL
 * line too (correct role/liveness, reliever workload signals, save pace),
 * so this module is a thin adapter over it. See docs/history.md
 * (2026-07 reliever-ghost entry).
 */

import type { PitcherTalent } from '@/lib/pitching/talent';
import { getPitcherTalentBatch } from '@/lib/mlb/players';

export interface PointsPitcherInput {
  talent: PitcherTalent;
  /** Authoritative role from the OVERALL line (starts + relief), with a
   *  prior-season fallback for stashed/IL arms. */
  role: 'starter' | 'reliever' | 'inactive';
  /** True when the pitcher has 0 current-season IP (not pitching now). */
  isGhost: boolean;
  /** Current-season saves (closer signal). */
  seasonSaves: number;
  /** Current-season appearances (denominator for observed save pace). */
  seasonGames: number;
}

/**
 * Assemble talent + role + save signal for a list of pitchers.
 * Result keyed by `name|team` (lowercased); pitchers that fail identity
 * resolution are omitted. Caching lives in `getPitcherTalentBatch`
 * (10 min, gated on ≥70% resolution) — no second cache layer here.
 */
export async function getPointsPitcherInputs(
  players: Array<{ name: string; team: string }>,
  season: number = new Date().getFullYear(),
): Promise<Record<string, PointsPitcherInput>> {
  if (players.length === 0) return {};
  const batch = await getPitcherTalentBatch(players, season);
  const results: Record<string, PointsPitcherInput> = {};
  for (const [key, entry] of Object.entries(batch)) {
    results[key] = {
      talent: entry.talent,
      role: entry.metadata.role,
      isGhost: entry.metadata.isGhost,
      seasonSaves: entry.metadata.seasonSaves,
      seasonGames: entry.metadata.seasonGames,
    };
  }
  return results;
}
