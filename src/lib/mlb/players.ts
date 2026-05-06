/**
 * Player stats — Compose / orchestrator layer.
 *
 * Pulls together identity resolution + raw fetches + pure parsers + Savant
 * data into the high-level functions consumed by the rest of the codebase.
 *
 * Layer rules:
 *   - This file may import from `./source/`, `./model/`, `./identity`,
 *     `./savant`, `./talentModel`, `@/lib/fantasy/cache`.
 *   - Pure modeling helpers go in `./model/`. Pure fetchers go in `./source/`.
 *   - Anything that combines fetch + transform belongs HERE (or in a similar
 *     compose-shaped module).
 */

import { CACHE_CATEGORIES, withCacheGated } from '@/lib/fantasy/cache';
import {
  fetchHittingGameLog,
  fetchCareerVsPitcher as sourceFetchCareerVsPitcher,
  fetchPitcherStarterLine,
  fetchPitcherPlatoon,
  fetchPitcherGameLog,
  fetchStatSplitsForSeason,
} from './source';
import {
  aggregateLastN,
  aggregatePitcherRecentForm,
  findByCode,
  findGroup,
  parsePitchingLine,
  parsePitcherAppearances,
  parseSplitLine,
  type PitcherAppearance,
  type PitcherSeasonLine,
} from './model';
import { fetchPlayerName, resolveMLBId } from './identity';
import { fetchStatcastBatters } from './savant';
import { blendRateOrNull, computeBatterTalentXwoba } from './talentModel';
import type { BatterSeasonStats, BatterSplits, SplitLine } from './types';

// Re-exports kept for back-compat with import sites elsewhere in the repo.
// New code should import these from their canonical homes.
export { resolveMLBId } from './identity';
export type { PitcherSeasonLine } from './model';

// ---------------------------------------------------------------------------
// Batter splits (vs-L/R, home/away, day/night, last 7/14/30)
// ---------------------------------------------------------------------------

/**
 * Fetch all relevant batting splits for a player.
 *
 * Early-season fallback: if the current season has < 20 PA in the season
 * totals, we fall back to the previous season for handedness/venue/day-night
 * splits (form stats stay on the current season). The displayed
 * `currentSeason` line is always the real current-year line, even when
 * splits fall back, so the UI can show "(prior year)" badges where it makes
 * sense.
 */
export async function getBatterSplits(
  mlbId: number,
  season: number = new Date().getFullYear(),
): Promise<BatterSplits | null> {
  const current = await fetchStatSplitsForSeason(mlbId, season);
  if (!current) return null;

  const currentSeasonLine = (() => {
    const seasonGroup = findGroup(current, 'season');
    const first = seasonGroup[0];
    return first ? parseSplitLine(first.stat) : null;
  })();

  // Early-season guardrail: thin current-season → prior-year handedness/venue.
  const currentPA = currentSeasonLine?.plateAppearances ?? 0;
  const EARLY_SEASON_PA = 30;
  const useFallback = currentPA < EARLY_SEASON_PA;

  let splitSource = findGroup(current, 'statSplits');
  let seasonTotalsForCompare = currentSeasonLine;
  let sourceSeason = season;

  if (useFallback) {
    const fallback = await fetchStatSplitsForSeason(mlbId, season - 1);
    if (fallback) {
      const fbSplits = findGroup(fallback, 'statSplits');
      if (fbSplits.length > 0) {
        splitSource = fbSplits;
        sourceSeason = season - 1;
        const fbSeasonGroup = findGroup(fallback, 'season');
        const fbFirst = fbSeasonGroup[0];
        if (fbFirst) seasonTotalsForCompare = parseSplitLine(fbFirst.stat);
      }
    }
  }

  // Recent form always comes from the current season's gameLog, sliced by
  // the model layer.
  let last7: SplitLine | null = null;
  let last14: SplitLine | null = null;
  let last30: SplitLine | null = null;
  try {
    const gameLogResp = await fetchHittingGameLog(mlbId, season);
    const gameLog = findGroup(gameLogResp, 'gameLog');
    last7 = aggregateLastN(gameLog, 7);
    last14 = aggregateLastN(gameLog, 14);
    last30 = aggregateLastN(gameLog, 30);
  } catch (err) {
    console.error(`fetchHittingGameLog(${mlbId}, ${season}) failed:`, err);
  }

  const name = (await fetchPlayerName(mlbId)) ?? '';

  return {
    mlbId,
    name,
    season: sourceSeason,
    vsLeft: findByCode(splitSource, 'vl'),
    vsRight: findByCode(splitSource, 'vr'),
    home: findByCode(splitSource, 'h'),
    away: findByCode(splitSource, 'a'),
    day: findByCode(splitSource, 'd'),
    night: findByCode(splitSource, 'n'),
    last7,
    last14,
    last30,
    monthly: {},
    seasonTotals: seasonTotalsForCompare,
    currentSeason: currentSeasonLine,
  };
}

// ---------------------------------------------------------------------------
// Pitcher line fetchers
// ---------------------------------------------------------------------------

/**
 * Fetch a single season's pitching starter line and parse it. Returns null
 * if the pitcher has no qualifying starts.
 */
async function fetchPitcherSeasonLine(
  mlbId: number,
  season: number,
): Promise<PitcherSeasonLine | null> {
  const raw = await fetchPitcherStarterLine(mlbId, season);
  if (!raw) return null;
  const splits = findGroup(raw, 'statSplits');
  const sp = splits.find(s => s.split?.code === 'sp');
  return sp ? parsePitchingLine(sp.stat) : null;
}

/**
 * Fetch a full pitcher season line for enrichment purposes — tries current
 * season first, then prior. Used to back-fill ProbablePitcher objects when
 * the schedule hydration returns no stats (common in the first weeks of
 * the season).
 */
export async function fetchPitcherFullLine(
  mlbId: number,
  season: number = new Date().getFullYear(),
): Promise<PitcherSeasonLine | null> {
  const current = await fetchPitcherSeasonLine(mlbId, season);
  if (current && current.ip > 0) return current;
  const prior = await fetchPitcherSeasonLine(mlbId, season - 1);
  return prior && prior.ip > 0 ? prior : null;
}

// ---------------------------------------------------------------------------
// Pitcher platoon + recent form
// ---------------------------------------------------------------------------

export interface PitcherPlatoonSplits {
  vsLeft: { ops: number | null } | null;
  vsRight: { ops: number | null } | null;
}

export async function fetchPitcherPlatoonSplits(
  mlbId: number,
  season: number = new Date().getFullYear(),
): Promise<PitcherPlatoonSplits | null> {
  const raw = await fetchPitcherPlatoon(mlbId, season);
  if (!raw) return null;
  const splits = findGroup(raw, 'statSplits');

  let vsLeft: { ops: number | null } | null = null;
  let vsRight: { ops: number | null } | null = null;

  for (const s of splits) {
    const code = s.split?.code;
    const ops = s.stat.ops ? parseFloat(s.stat.ops) : null;
    if (code === 'vl') vsLeft = { ops };
    else if (code === 'vr') vsRight = { ops };
  }

  return { vsLeft, vsRight };
}

export async function fetchPitcherRecentForm(
  mlbId: number,
  lastN: number = 3,
  season: number = new Date().getFullYear(),
): Promise<{ era: number | null; ip: number } | null> {
  const raw = await fetchPitcherGameLog(mlbId, season);
  if (!raw) return null;
  const log = findGroup(raw, 'gameLog');
  return aggregatePitcherRecentForm(log, lastN);
}

/**
 * Fetch a pitcher's per-appearance gamelog entries with opponent team IDs
 * and PA counts. Used by the talent layer for strength-of-schedule
 * weighting — outings vs weak lineups get sample-shrunk so the Bayesian
 * regression pulls the talent estimate harder toward the prior.
 *
 * Returns an empty array on fetch failure (rather than null) — talent
 * computation degrades to no-SoS gracefully when appearances are
 * unavailable. Underlying gamelog fetch is cached 1h.
 */
export async function getPitcherAppearances(
  mlbId: number,
  season: number = new Date().getFullYear(),
): Promise<PitcherAppearance[]> {
  const raw = await fetchPitcherGameLog(mlbId, season);
  if (!raw) return [];
  const log = findGroup(raw, 'gameLog');
  return parsePitcherAppearances(log);
}

/**
 * Fetch a pitcher's parsed season starter line (or prior fallback).
 * Exposed so the talent orchestrator can reuse the same source the
 * legacy `getPitcherQuality` consumed without re-parsing. Returns
 * { current, prior } — both can be null.
 */
export async function getPitcherSeasonLines(
  mlbId: number,
  season: number = new Date().getFullYear(),
): Promise<{ current: PitcherSeasonLine | null; prior: PitcherSeasonLine | null }> {
  const [current, prior] = await Promise.all([
    fetchPitcherSeasonLine(mlbId, season),
    fetchPitcherSeasonLine(mlbId, season - 1),
  ]);
  return { current, prior };
}

// ---------------------------------------------------------------------------
// Career vs pitcher
// ---------------------------------------------------------------------------

/**
 * Get a batter's career stats against a specific pitcher.
 * Uses the vsPlayerTotal response group (lifetime, all game types).
 * Returns null if there's no meaningful history (< 5 PA).
 */
export async function getCareerVsPitcher(
  batterId: number,
  pitcherId: number,
): Promise<SplitLine | null> {
  const raw = await sourceFetchCareerVsPitcher(batterId, pitcherId);
  if (!raw) return null;

  const total = findGroup(raw, 'vsPlayerTotal');
  const source = total.length > 0 ? total : findGroup(raw, 'vsPlayer');
  if (source.length === 0) return null;

  const line = parseSplitLine(source[0].stat);
  return (line.plateAppearances ?? 0) >= 5 ? line : null;
}

// ---------------------------------------------------------------------------
// Roster-level batch season stats
// ---------------------------------------------------------------------------

interface RosterPlayer {
  name: string;
  team: string;
}

/**
 * Fetch lightweight season stats (OPS, AVG, HR, SB, PA) for a list of
 * roster players. Resolves Yahoo names -> MLB IDs (each cached 24h) then
 * fans out current + prior splits + Savant data in parallel.
 *
 * Result map is keyed by `"name|team"` (lowercased) so callers can look up
 * stats without needing MLB IDs. Cache is gated: a run that resolves fewer
 * than 70% of input players is treated as a transient outage and not
 * cached, so the next request retries instead of being stuck on partial
 * data for the full TTL. See docs/data-architecture.md.
 *
 * When the current-season splits fetch fails for a player but the prior
 * year succeeded, we surface a row with prior-year totals (`season =
 * season - 1`) rather than dropping the player. Keeping IL'd players and
 * timeout victims visible in the UI is more important than always showing
 * current-year numbers.
 */
export async function getRosterSeasonStats(
  players: RosterPlayer[],
  season: number = new Date().getFullYear(),
): Promise<Record<string, BatterSeasonStats>> {
  if (players.length === 0) return {};

  const sortedKey = players
    .map(p => `${p.name.toLowerCase()}|${p.team.toLowerCase()}`)
    .sort()
    .join(',');
  // v7: bumped when prior-year fallback was restored (entries for IL'd /
  // timeout-victim players now appear with `season = season - 1` data).
  const cacheKey = `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:roster-stats-v7:${season}:${hashCode(sortedKey)}`;

  const minCoverage = Math.max(1, Math.ceil(players.length * 0.7));

  return withCacheGated(
    cacheKey,
    CACHE_CATEGORIES.SEMI_DYNAMIC.ttlMedium,
    async () => buildResults(),
    (result) => Object.keys(result).length >= minCoverage,
  );

  async function buildResults(): Promise<Record<string, BatterSeasonStats>> {
    const results: Record<string, BatterSeasonStats> = {};

    // Savant batter leaderboards for current + prior season are 24h cached
    // and serve every player in this batch — fetch once up front.
    const [savantMap, priorSavantMap] = await Promise.all([
      fetchStatcastBatters(season),
      fetchStatcastBatters(season - 1),
    ]);

    await Promise.all(
      players.map(async ({ name, team }) => {
        const key = `${name.toLowerCase()}|${team.toLowerCase()}`;
        try {
          const identity = await resolveMLBId(name, team);
          if (!identity) return;

          const [currentRaw, fallbackRaw] = await Promise.all([
            fetchStatSplitsForSeason(identity.mlbId, season),
            fetchStatSplitsForSeason(identity.mlbId, season - 1),
          ]);

          // If both fetches failed (network outage / unknown player), drop
          // the entry. If only the current-year fetch failed we still
          // produce a row from prior-year data (see the `else if` branch).
          if (!currentRaw && !fallbackRaw) return;

          let line: SplitLine | null = null;
          if (currentRaw) {
            const seasonGroup = findGroup(currentRaw, 'season');
            const first = seasonGroup[0];
            if (first) line = parseSplitLine(first.stat);
          }

          let priorLine: SplitLine | null = null;
          if (fallbackRaw) {
            const fbGroup = findGroup(fallbackRaw, 'season');
            const fbFirst = fbGroup[0];
            if (fbFirst) priorLine = parseSplitLine(fbFirst.stat);
          }

          if (line && currentRaw) {
            const currentSplits = findGroup(currentRaw, 'statSplits');
            const fallbackSplits = fallbackRaw ? findGroup(fallbackRaw, 'statSplits') : [];

            const currentSavant = savantMap.get(identity.mlbId);
            const priorSavant = priorSavantMap.get(identity.mlbId);
            const talent = computeBatterTalentXwoba(currentSavant, priorSavant);
            const xwoba = talent?.xwoba ?? null;
            const woba = blendRateOrNull({
              current: currentSavant?.woba ?? null,
              currentN: currentSavant?.bip ?? 0,
              prior: priorSavant?.woba ?? null,
              priorN: priorSavant?.bip ?? 0,
              leagueMean: 0,
              leaguePriorN: 0,
              priorCap: 150,
            });

            // Prior-only talent xwOBA — feed prior data through the same
            // component model with no current-year input. The Rising bonus
            // compares this to the raw current xwOBA to detect genuine
            // in-season skill jumps.
            const xwobaTalentPrior = priorSavant
              ? computeBatterTalentXwoba(priorSavant, undefined)?.xwoba ?? null
              : null;

            // Per-hand platoon fallback. Platoon skill is sticky (60-70%
            // YoY correlation), so a 15-PA current-season split vs LHP is a
            // worse estimate than a 400-PA prior sample. We rescale the
            // prior split to current-year talent level by preserving the
            // prior platoon ratio (priorVsL / priorOverall) and applying it
            // to the current overall OPS — keeping observedOPS / overallOPS
            // (which drives the downstream regression) internally
            // consistent. Gate: < 50 PA on the current side triggers it.
            const MIN_HAND_PA = 50;
            const currentVsL = findByCode(currentSplits, 'vl');
            const currentVsR = findByCode(currentSplits, 'vr');
            const priorVsL = findByCode(fallbackSplits, 'vl');
            const priorVsR = findByCode(fallbackSplits, 'vr');
            const priorOverallOps = priorLine?.ops ?? null;
            const primaryOverallOps = line.ops;

            const resolveHand = (
              curr: SplitLine | null,
              prior: SplitLine | null,
            ): { ops: number | null; pa: number } => {
              if (curr && curr.plateAppearances >= MIN_HAND_PA && curr.ops !== null) {
                return { ops: curr.ops, pa: curr.plateAppearances };
              }
              if (
                prior && prior.plateAppearances >= MIN_HAND_PA && prior.ops !== null &&
                priorOverallOps !== null && priorOverallOps > 0 &&
                primaryOverallOps !== null
              ) {
                const priorRatio = prior.ops / priorOverallOps;
                return { ops: primaryOverallOps * priorRatio, pa: prior.plateAppearances };
              }
              return { ops: curr?.ops ?? null, pa: curr?.plateAppearances ?? 0 };
            };

            const vsL = resolveHand(currentVsL, priorVsL);
            const vsR = resolveHand(currentVsR, priorVsR);

            const priorSeasonBlock =
              priorLine && priorLine.plateAppearances > 0
                ? {
                    season: season - 1,
                    pa: priorLine.plateAppearances,
                    gp: priorLine.gamesPlayed,
                    hr: priorLine.homeRuns,
                    sb: priorLine.stolenBases,
                    runs: priorLine.runs,
                    rbi: priorLine.rbi,
                    hits: priorLine.hits,
                    walks: priorLine.walks,
                    strikeouts: priorLine.strikeouts,
                    totalBases: priorLine.totalBases,
                    avg: priorLine.avg,
                  }
                : null;

            results[key] = {
              mlbId: identity.mlbId,
              ops: line.ops,
              avg: line.avg,
              hr: line.homeRuns,
              sb: line.stolenBases,
              pa: line.plateAppearances,
              gp: line.gamesPlayed,
              runs: line.runs,
              hits: line.hits,
              rbi: line.rbi,
              walks: line.walks,
              strikeouts: line.strikeouts,
              totalBases: line.totalBases,
              season,
              xwoba,
              woba,
              xwobaEffectivePA: talent?.effectivePA ?? 0,
              xwobaCurrent: currentSavant?.xwoba ?? null,
              xwobaCurrentBip: currentSavant?.bip ?? 0,
              xwobaTalentPrior,
              bats: identity.bats ?? null,
              opsVsL: vsL.ops,
              paVsL: vsL.pa,
              opsVsR: vsR.ops,
              paVsR: vsR.pa,
              priorSeason: priorSeasonBlock,
            };
          } else if (priorLine && priorLine.plateAppearances > 0) {
            // Current splits missing (IL stint, no-show rookie, upstream
            // timeout); fall back to prior totals so the player still
            // appears in the table. `season` set to `season - 1` so the UI
            // can flag the row.
            const priorSavant = priorSavantMap.get(identity.mlbId);
            const priorTalent = priorSavant
              ? computeBatterTalentXwoba(priorSavant, undefined)
              : null;

            results[key] = {
              mlbId: identity.mlbId,
              ops: priorLine.ops,
              avg: priorLine.avg,
              hr: priorLine.homeRuns,
              sb: priorLine.stolenBases,
              pa: priorLine.plateAppearances,
              gp: priorLine.gamesPlayed,
              runs: priorLine.runs,
              hits: priorLine.hits,
              rbi: priorLine.rbi,
              walks: priorLine.walks,
              strikeouts: priorLine.strikeouts,
              totalBases: priorLine.totalBases,
              season: season - 1,
              xwoba: priorTalent?.xwoba ?? null,
              woba: priorSavant?.woba ?? null,
              xwobaEffectivePA: priorTalent?.effectivePA ?? 0,
              xwobaCurrent: null,
              xwobaCurrentBip: 0,
              xwobaTalentPrior: priorTalent?.xwoba ?? null,
              bats: identity.bats ?? null,
              opsVsL: null,
              paVsL: 0,
              opsVsR: null,
              paVsR: 0,
              priorSeason: null,
            };
          }
        } catch (err) {
          console.error(`getRosterSeasonStats: failed for ${name} (${team}):`, err);
        }
      }),
    );

    return results;
  }
}

function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
