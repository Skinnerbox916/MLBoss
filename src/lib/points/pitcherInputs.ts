/**
 * Points-league pitcher input assembly.
 *
 * The shared `getPitcherTalentBatch` (categories) fetches only the SP-filtered
 * season line, which leaves `talent.role` unreliable AND makes relievers look
 * like 0-IP ghosts — fine for the categories roster page, fatal for points
 * (closers, worth 8 pts/save, vanish entirely). Rather than change that shared
 * function (and shift categories `/roster` behavior), the points module owns
 * its own pitcher assembly: it fetches the OVERALL line too, so
 * `computePitcherTalent` gets correct role + reliever-workload signals
 * (`appearancesPerWeek`), and it surfaces season saves for the closer signal.
 *
 * Mirrors the assembly in `/api/projection/pitcher-team` (the proven path),
 * keyed by `name|team` like `getRosterSeasonStats` / `getPitcherTalentBatch`.
 */

import type { PitcherTalent } from '@/lib/pitching/talent';
import { computePitcherTalent } from '@/lib/pitching/talent';
import { resolveMLBId } from '@/lib/mlb/identity';
import { getPitcherSeasonLines, getPitcherOverallLines } from '@/lib/mlb/players';
import { fetchStatcastPitchers } from '@/lib/mlb/savant';

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

function key(name: string, team: string): string {
  return `${name.toLowerCase()}|${team.toLowerCase()}`;
}

/**
 * Assemble talent + role + save signal for a list of pitchers.
 * Result keyed by `name|team` (lowercased); pitchers that fail identity
 * resolution are omitted. The underlying line / Savant fetches are all
 * cached, so repeated calls within a session are cheap.
 */
export async function getPointsPitcherInputs(
  players: Array<{ name: string; team: string }>,
  season: number = new Date().getFullYear(),
): Promise<Record<string, PointsPitcherInput>> {
  if (players.length === 0) return {};

  const [savantCurrent, savantPrior] = await Promise.all([
    fetchStatcastPitchers(season),
    fetchStatcastPitchers(season - 1),
  ]);

  const results: Record<string, PointsPitcherInput> = {};

  await Promise.all(
    players.map(async ({ name, team }) => {
      try {
        const identity = await resolveMLBId(name, team);
        if (!identity) return;

        const [seasonLines, overallLines] = await Promise.all([
          getPitcherSeasonLines(identity.mlbId, season),
          getPitcherOverallLines(identity.mlbId, season),
        ]);

        const talent = computePitcherTalent({
          mlbId: identity.mlbId,
          throws: identity.throws,
          currentLine: seasonLines.current,
          priorLine: seasonLines.prior,
          currentSavant: savantCurrent.get(identity.mlbId) ?? null,
          priorSavant: savantPrior.get(identity.mlbId) ?? null,
          currentOverall: overallLines.current,
          priorOverall: overallLines.prior,
        });

        const oc = overallLines.current;
        const op = overallLines.prior;
        const curIP = oc?.ip ?? 0;
        const curGS = oc?.gamesStarted ?? 0;

        // Role from current overall line, with prior-season fallback for
        // stashed / IL arms (probable starter who hasn't pitched yet).
        let role: 'starter' | 'reliever' | 'inactive';
        if (curGS > 0) role = 'starter';
        else if (curIP > 0) role = 'reliever';
        else if ((op?.gamesStarted ?? 0) > 0) role = 'starter';
        else if ((op?.ip ?? 0) > 0) role = 'reliever';
        else role = 'inactive';

        results[key(name, team)] = {
          talent,
          role,
          isGhost: curIP === 0,
          seasonSaves: oc?.saves ?? 0,
          seasonGames: oc?.gamesPitched ?? 0,
        };
      } catch (err) {
        console.error(`getPointsPitcherInputs: failed for ${name} (${team}):`, err);
      }
    }),
  );

  return results;
}
