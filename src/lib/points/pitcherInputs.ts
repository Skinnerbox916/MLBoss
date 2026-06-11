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
import { withCacheGated, CACHE_CATEGORIES } from '@/lib/fantasy/cache';

/** Small stable hash for the cache key (avoids multi-KB keys for the FA pool). */
function hashKey(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

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
 * resolution are omitted.
 *
 * Cached as a batch (10 min, gated on ≥70% resolution): each pitcher needs an
 * identity resolve + season + overall line fetch (the per-pitcher lines are
 * uncached upstream), and this is called for the roster + the ~40-pitcher FA
 * pool — the dominant cost behind the points pitchers tab / pipeline rebuild.
 */
export async function getPointsPitcherInputs(
  players: Array<{ name: string; team: string }>,
  season: number = new Date().getFullYear(),
): Promise<Record<string, PointsPitcherInput>> {
  if (players.length === 0) return {};
  const sortedKey = players.map(p => key(p.name, p.team)).sort().join(',');
  const cacheKey = `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:points-pitcher-inputs:${season}:${hashKey(sortedKey)}`;
  const minCoverage = Math.max(1, Math.ceil(players.length * 0.7));
  return withCacheGated(
    cacheKey,
    CACHE_CATEGORIES.SEMI_DYNAMIC.ttlMedium,
    () => computePointsPitcherInputs(players, season),
    result => Object.keys(result).length >= minCoverage,
  );
}

async function computePointsPitcherInputs(
  players: Array<{ name: string; team: string }>,
  season: number,
): Promise<Record<string, PointsPitcherInput>> {
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
