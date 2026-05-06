/**
 * Player stats — Model layer.
 *
 * Pure functions over the raw shapes from `../source/playerStats`. No I/O.
 * No fetch calls, no Redis, no logging side-effects beyond what callers
 * pass in.
 *
 * Hard rule: this file (and its siblings under model/) MUST NOT import from
 * ../source/. Only from ../source/playerStats's *type* exports.
 */

import { parseIPToOuts } from '@/lib/utils';
import type { SplitLine } from '../types';
import type {
  RawSplit,
  RawStat,
  RawStatsResponse,
} from '../source/playerStats';

// ---------------------------------------------------------------------------
// Generic parsers
// ---------------------------------------------------------------------------

export function parseSplitLine(raw: RawStat): SplitLine {
  const n = (v: string | undefined) => {
    if (!v) return null;
    const f = parseFloat(v);
    return isNaN(f) ? null : f;
  };
  // Reconstruct total bases from the raw line. The MLB Stats API gives us
  // doubles/triples/HR but no aggregated TB; singles are derived.
  const hits = raw.hits ?? 0;
  const doubles = raw.doubles ?? 0;
  const triples = raw.triples ?? 0;
  const homeRuns = raw.homeRuns ?? 0;
  const singles = Math.max(0, hits - doubles - triples - homeRuns);
  const totalBases = singles + doubles * 2 + triples * 3 + homeRuns * 4;
  return {
    avg: n(raw.avg),
    obp: n(raw.obp),
    slg: n(raw.slg),
    ops: n(raw.ops),
    gamesPlayed: raw.gamesPlayed ?? 0,
    homeRuns,
    runs: raw.runs ?? 0,
    rbi: raw.rbi ?? 0,
    stolenBases: raw.stolenBases ?? 0,
    strikeouts: raw.strikeOuts ?? 0,
    walks: raw.baseOnBalls ?? 0,
    atBats: raw.atBats ?? 0,
    hits,
    plateAppearances: raw.plateAppearances ?? 0,
    totalBases,
  };
}

export function findByCode(splits: RawSplit[], code: string): SplitLine | null {
  const match = splits.find(s => s.split?.code === code);
  return match ? parseSplitLine(match.stat) : null;
}

export function findGroup(resp: RawStatsResponse, typeName: string): RawSplit[] {
  const group = resp.stats?.find(g => g.type?.displayName === typeName);
  return group?.splits ?? [];
}

/**
 * Aggregate the last N entries of a chronological game log into a single
 * SplitLine. The MLB Stats API's `lastXGames` endpoint ignores the
 * `numberOfGames` parameter and always returns the full season, so we slice
 * the gameLog ourselves.
 */
export function aggregateLastN(gameLog: RawSplit[], n: number): SplitLine | null {
  const recent = gameLog.slice(-n);
  if (recent.length === 0) return null;

  let atBats = 0, hits = 0, homeRuns = 0, runs = 0, rbi = 0, stolenBases = 0;
  let strikeouts = 0, walks = 0, plateAppearances = 0;
  let totalBases = 0;

  for (const entry of recent) {
    const s = entry.stat;
    atBats += s.atBats ?? 0;
    hits += s.hits ?? 0;
    homeRuns += s.homeRuns ?? 0;
    runs += s.runs ?? 0;
    rbi += s.rbi ?? 0;
    stolenBases += s.stolenBases ?? 0;
    strikeouts += s.strikeOuts ?? 0;
    walks += s.baseOnBalls ?? 0;
    plateAppearances += s.plateAppearances ?? 0;
    const gameHits = s.hits ?? 0;
    const gameDoubles = s.doubles ?? 0;
    const gameTriples = s.triples ?? 0;
    const gameHR = s.homeRuns ?? 0;
    const gameSingles = gameHits - gameDoubles - gameTriples - gameHR;
    totalBases += gameSingles + gameDoubles * 2 + gameTriples * 3 + gameHR * 4;
  }

  // Recalculate HBP and SF from PA - AB - BB (the API often omits these in
  // game-log entries).
  const hbpAndSf = plateAppearances - atBats - walks;

  const avg = atBats > 0 ? hits / atBats : null;
  const obp = plateAppearances > 0 ? (hits + walks + Math.max(0, hbpAndSf)) / plateAppearances : null;
  const slg = atBats > 0 ? totalBases / atBats : null;
  const ops = obp !== null && slg !== null ? obp + slg : null;

  return {
    avg,
    obp,
    slg,
    ops,
    gamesPlayed: recent.length,
    homeRuns,
    runs,
    rbi,
    stolenBases,
    strikeouts,
    walks,
    atBats,
    hits,
    plateAppearances,
    totalBases,
  };
}

// ---------------------------------------------------------------------------
// Pitching parsers
// ---------------------------------------------------------------------------

/**
 * A pitcher's parsed season line, "as starter" filtering applied at the
 * source layer so IP/GS/ERA reflect starts only.
 */
export interface PitcherSeasonLine {
  era: number | null;
  whip: number | null;
  ip: number;
  strikeoutsPer9: number | null;
  strikeOuts: number | null;
  gamesStarted: number | null;
  pitchesPerInning: number | null;
  inningsPerStart: number | null;
  wins: number;
  losses: number;
  bb9: number | null;
  hr9: number | null;
  battingAvgAgainst: number | null;
  gbRate: number | null;
}

/** Parse a pitching season line from the MLB Stats API raw shape. */
export function parsePitchingLine(raw: RawStat): PitcherSeasonLine {
  const n = (v: string | undefined) => {
    if (!v) return null;
    const f = parseFloat(v);
    return isNaN(f) ? null : f;
  };
  const ip = n(raw.inningsPitched) ?? 0;
  const outs = parseIPToOuts(raw.inningsPitched ?? '0');
  const gs = raw.gamesStarted ?? null;
  const bb = raw.baseOnBalls ?? 0;
  const hr = raw.homeRuns ?? 0;
  const hitsAllowed = raw.hits ?? 0;
  const abAgainst = raw.atBats ?? 0;
  const go = raw.groundOuts ?? 0;
  const ao = raw.airOuts ?? 0;
  return {
    era: n(raw.era),
    whip: n(raw.whip),
    ip,
    strikeoutsPer9: n(raw.strikeoutsPer9Inn),
    strikeOuts: raw.strikeOuts ?? null,
    gamesStarted: gs,
    pitchesPerInning: n(raw.pitchesPerInning),
    inningsPerStart: gs && gs > 0 ? Math.round((outs / gs / 3) * 100) / 100 : null,
    wins: raw.wins ?? 0,
    losses: raw.losses ?? 0,
    bb9: ip > 0 ? Math.round((bb / ip * 9) * 100) / 100 : null,
    hr9: ip > 0 ? Math.round((hr / ip * 9) * 100) / 100 : null,
    battingAvgAgainst: abAgainst > 0 ? Math.round((hitsAllowed / abAgainst) * 1000) / 1000 : null,
    gbRate: (go + ao) > 0 ? Math.round((go / (go + ao)) * 1000) / 1000 : null,
  };
}

/**
 * A single pitcher appearance, parsed out of the game-log split shape.
 * Used for strength-of-schedule weighting in the talent estimator —
 * each appearance carries the opponent team ID + PA so the regression
 * can down-weight outings vs weak lineups (and up-weight outings vs
 * strong ones).
 */
export interface PitcherAppearance {
  /** ISO date — "2026-04-26". */
  date: string | null;
  /** Opposing team's MLB ID. */
  opponentTeamId: number;
  /** True when the pitcher's team was home. */
  isHome: boolean;
  /** Batters faced in this appearance — Savant calls this PA-against. */
  pa: number;
  /** Innings pitched in this single appearance. */
  ip: number;
  /** True for starts (`gamesStarted ≥ 1`). Relief outings are kept in
   *  the list but flagged so callers can filter — the SoS estimator
   *  weighs starts only, since opening-day-to-September relief usage
   *  isn't representative of the talent we're rating. */
  isStart: boolean;
}

/**
 * Parse a pitcher's game-log splits into typed per-appearance records.
 * Drops entries missing the opponent team ID (data corruption guard) but
 * preserves zero-PA cameos so consumers can decide their own filter.
 */
export function parsePitcherAppearances(gameLog: RawSplit[]): PitcherAppearance[] {
  const out: PitcherAppearance[] = [];
  for (const entry of gameLog) {
    const oppId = entry.opponent?.id;
    if (typeof oppId !== 'number') continue;
    const stat = entry.stat;
    out.push({
      date: entry.date ?? null,
      opponentTeamId: oppId,
      isHome: !!entry.isHome,
      pa: stat.battersFaced ?? stat.plateAppearances ?? 0,
      ip: parseFloat(stat.inningsPitched ?? '0') || 0,
      isStart: (stat.gamesStarted ?? 0) >= 1,
    });
  }
  return out;
}

/**
 * Aggregate the last N starts from a pitcher's game log into a single
 * { era, ip } entry. Only entries with GS=1 OR IP>=3 are counted as starts
 * (filters out relief appearances by swingmen).
 */
export function aggregatePitcherRecentForm(
  gameLog: RawSplit[],
  lastN: number,
): { era: number | null; ip: number } | null {
  const starts = gameLog.filter(
    e => (e.stat.gamesStarted ?? 0) >= 1 ||
         parseFloat(e.stat.inningsPitched ?? '0') >= 3,
  );
  const recent = starts.slice(-lastN);
  if (recent.length === 0) return null;

  let totalIP = 0;
  let totalER = 0;
  for (const entry of recent) {
    totalIP += parseFloat(entry.stat.inningsPitched ?? '0') || 0;
    totalER += entry.stat.earnedRuns ?? 0;
  }

  return {
    era: totalIP > 0 ? Math.round((totalER / totalIP * 9) * 100) / 100 : null,
    ip: totalIP,
  };
}
