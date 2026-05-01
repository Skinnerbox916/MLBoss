/**
 * Migration adapters between the legacy flat `BatterSeasonStats` and the
 * stratified `PlayerStatLine` shapes. Both directions are provided so we
 * can migrate consumers and producers independently.
 *
 * These adapters are MIGRATION-ONLY. Once Phase 4 of the data layer
 * foundation work has migrated /lineup and /streaming to consume
 * `PlayerStatLine` directly, this file is deleted.
 */

import type {
  BatterSeasonStats,
  PlayerSeasonCounting,
  PlayerStatLine,
  PriorSeasonLine,
} from './types';

/**
 * Convert a stratified `PlayerStatLine` to the flat `BatterSeasonStats`
 * shape. Used to bridge a hook that's already returning `PlayerStatLine[]`
 * into a consumer that hasn't migrated yet.
 *
 * Field mapping:
 *   - counting fields read from `line.current ?? line.prior` (a row backed
 *     by prior-year data sets `season = prior.season`)
 *   - talent fields come from `line.talent`
 *   - raw Statcast fields come from `line.statcast`
 *   - platoon fields come from `line.splits`
 *   - `priorSeason` is a copy of `line.prior` when it exists AND `current`
 *     is also populated (so we don't double-count prior data on rows where
 *     prior IS the primary source)
 */
export function toBatterSeasonStats(line: PlayerStatLine): BatterSeasonStats {
  const primary = line.current ?? line.prior;

  if (!primary) {
    // No counting data at all — should never happen for a hook entry, but
    // keep a coherent zeroed shape rather than throwing.
    return {
      mlbId: line.identity.mlbId,
      ops: null,
      avg: null,
      hr: 0,
      sb: 0,
      pa: 0,
      gp: 0,
      runs: 0,
      hits: 0,
      rbi: 0,
      walks: 0,
      strikeouts: 0,
      totalBases: 0,
      season: 0,
      xwoba: line.talent?.xwoba ?? null,
      woba: line.talent?.woba ?? null,
      xwobaEffectivePA: line.talent?.effectivePA ?? 0,
      xwobaCurrent: line.statcast?.xwobaCurrent ?? null,
      xwobaCurrentBip: line.statcast?.xwobaCurrentBip ?? 0,
      xwobaTalentPrior: line.talent?.xwobaTalentPrior ?? null,
      bats: line.identity.bats,
      opsVsL: line.splits?.opsVsL ?? null,
      paVsL: line.splits?.paVsL ?? 0,
      opsVsR: line.splits?.opsVsR ?? null,
      paVsR: line.splits?.paVsR ?? 0,
      priorSeason: null,
    };
  }

  const priorSeason: PriorSeasonLine | null =
    line.current !== null && line.prior !== null && line.prior.pa > 0
      ? {
          season: line.prior.season,
          pa: line.prior.pa,
          gp: line.prior.gp,
          hr: line.prior.hr,
          sb: line.prior.sb,
          runs: line.prior.runs,
          rbi: line.prior.rbi,
          hits: line.prior.hits,
          walks: line.prior.walks,
          strikeouts: line.prior.strikeouts,
          totalBases: line.prior.totalBases,
          avg: line.prior.avg,
        }
      : null;

  return {
    mlbId: line.identity.mlbId,
    ops: primary.ops,
    avg: primary.avg,
    hr: primary.hr,
    sb: primary.sb,
    pa: primary.pa,
    gp: primary.gp,
    runs: primary.runs,
    hits: primary.hits,
    rbi: primary.rbi,
    walks: primary.walks,
    strikeouts: primary.strikeouts,
    totalBases: primary.totalBases,
    season: primary.season,
    xwoba: line.talent?.xwoba ?? null,
    woba: line.talent?.woba ?? null,
    xwobaEffectivePA: line.talent?.effectivePA ?? 0,
    xwobaCurrent: line.statcast?.xwobaCurrent ?? null,
    xwobaCurrentBip: line.statcast?.xwobaCurrentBip ?? 0,
    xwobaTalentPrior: line.talent?.xwobaTalentPrior ?? null,
    bats: line.identity.bats,
    opsVsL: line.splits?.opsVsL ?? null,
    paVsL: line.splits?.paVsL ?? 0,
    opsVsR: line.splits?.opsVsR ?? null,
    paVsR: line.splits?.paVsR ?? 0,
    priorSeason,
  };
}

/**
 * Convert a legacy flat `BatterSeasonStats` to the stratified
 * `PlayerStatLine`. Used to bridge a producer that's still emitting the
 * old shape into a consumer that's already on the new one.
 */
export function fromBatterSeasonStats(stats: BatterSeasonStats): PlayerStatLine {
  // The old shape collapses current and prior into the same scalar
  // counting fields; we put them under `current` regardless of which
  // season they're actually from. Consumers that need to know read
  // `current.season` to disambiguate (it'll be `season - 1` in the
  // prior-year fallback case).
  const current: PlayerSeasonCounting = {
    season: stats.season,
    pa: stats.pa,
    gp: stats.gp,
    hr: stats.hr,
    sb: stats.sb,
    runs: stats.runs,
    rbi: stats.rbi,
    hits: stats.hits,
    walks: stats.walks,
    strikeouts: stats.strikeouts,
    totalBases: stats.totalBases,
    avg: stats.avg,
    ops: stats.ops,
  };

  const prior: PlayerSeasonCounting | null = stats.priorSeason
    ? {
        season: stats.priorSeason.season,
        pa: stats.priorSeason.pa,
        gp: stats.priorSeason.gp,
        hr: stats.priorSeason.hr,
        sb: stats.priorSeason.sb,
        runs: stats.priorSeason.runs,
        rbi: stats.priorSeason.rbi,
        hits: stats.priorSeason.hits,
        walks: stats.priorSeason.walks,
        strikeouts: stats.priorSeason.strikeouts,
        totalBases: stats.priorSeason.totalBases,
        avg: stats.priorSeason.avg,
        ops: null,
      }
    : null;

  return {
    identity: { mlbId: stats.mlbId, bats: stats.bats },
    current,
    prior,
    talent:
      stats.xwoba !== null
        ? {
            xwoba: stats.xwoba,
            effectivePA: stats.xwobaEffectivePA,
            xwobaTalentPrior: stats.xwobaTalentPrior,
            woba: stats.woba,
          }
        : null,
    statcast:
      stats.xwobaCurrent !== null || stats.xwobaCurrentBip > 0
        ? {
            xwobaCurrent: stats.xwobaCurrent,
            xwobaCurrentBip: stats.xwobaCurrentBip,
          }
        : null,
    splits:
      stats.paVsL > 0 || stats.paVsR > 0 || stats.opsVsL !== null || stats.opsVsR !== null
        ? {
            opsVsL: stats.opsVsL,
            paVsL: stats.paVsL,
            opsVsR: stats.opsVsR,
            paVsR: stats.paVsR,
          }
        : null,
  };
}
