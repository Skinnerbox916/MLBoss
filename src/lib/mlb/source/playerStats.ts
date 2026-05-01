/**
 * Player stats — Source layer.
 *
 * Pure I/O. Talks to the MLB Stats API via the cached fetch primitives in
 * ../client. Returns raw shapes (`RawStatsResponse`, `RawSplit`) — the
 * model layer is responsible for parsing them into typed entities.
 *
 * Hard rule: this file (and its siblings under source/) MUST NOT import from
 * ../model/. Anything that needs both fetched data and modeling lives in
 * the orchestrator (`../players.ts`, `../schedule.ts`).
 */

import { mlbFetchSplits } from '../client';

// ---------------------------------------------------------------------------
// MLB Stats API response shapes
// ---------------------------------------------------------------------------

export interface RawStat {
  avg?: string;
  obp?: string;
  slg?: string;
  ops?: string;
  gamesPlayed?: number;
  homeRuns?: number;
  doubles?: number;
  triples?: number;
  runs?: number;
  rbi?: number;
  stolenBases?: number;
  strikeOuts?: number;
  baseOnBalls?: number;
  atBats?: number;
  hits?: number;
  plateAppearances?: number;
  // Pitching-side fields
  era?: string;
  whip?: string;
  inningsPitched?: string;
  strikeoutsPer9Inn?: string;
  gamesStarted?: number;
  pitchesPerInning?: string;
  wins?: number;
  losses?: number;
  groundOuts?: number;
  airOuts?: number;
  earnedRuns?: number;
}

export interface RawSplit {
  split?: { code: string; description: string };
  season?: string;
  isHome?: boolean;
  stat: RawStat;
}

export interface RawStatsGroup {
  type?: { displayName: string };
  group?: { displayName: string };
  splits: RawSplit[];
}

export interface RawStatsResponse {
  stats?: RawStatsGroup[];
}

// ---------------------------------------------------------------------------
// Hitting fetchers
// ---------------------------------------------------------------------------

/**
 * Fetch vs-L/R, home/away, day/night, and season totals for one season.
 * Uses /people/{id}/stats?stats=statSplits,season&sitCodes=vl,vr,h,a,d,n
 *
 * Returns null on API failure (network timeout, 5xx, etc.). The caller is
 * expected to handle the absence — usually by falling back to prior-year
 * data or skipping the player entry.
 */
export async function fetchStatSplitsForSeason(
  mlbId: number,
  season: number,
): Promise<RawStatsResponse | null> {
  const params = new URLSearchParams({
    stats: 'statSplits,season',
    group: 'hitting',
    season: String(season),
    sitCodes: 'vl,vr,h,a,d,n',
    gameType: 'R',
  });
  const path = `/people/${mlbId}/stats?${params.toString()}`;

  try {
    return await mlbFetchSplits<RawStatsResponse>(path, `statsplits:${mlbId}:${season}`);
  } catch (err) {
    console.error(`fetchStatSplitsForSeason(${mlbId}, ${season}) failed:`, err);
    return null;
  }
}

/**
 * Fetch the full game log for a player+season. Cached 1 hour.
 * Returns individual game entries sorted chronologically by the API.
 *
 * Throws on fetch failure — game-log is non-essential, callers wrap in
 * try/catch. Returning the raw response so the model layer can decide how
 * to slice it (last 7, last 14, last 30, etc.).
 */
export async function fetchHittingGameLog(
  mlbId: number,
  season: number,
): Promise<RawStatsResponse> {
  const params = new URLSearchParams({
    stats: 'gameLog',
    group: 'hitting',
    season: String(season),
    gameType: 'R',
  });
  const path = `/people/${mlbId}/stats?${params.toString()}`;
  return mlbFetchSplits<RawStatsResponse>(path, `gamelog:${mlbId}:${season}`);
}

/**
 * Fetch career-vs-pitcher stats for a batter.
 * Uses stats=vsPlayer; the response groups are vsPlayer (year-by-year) and
 * vsPlayerTotal (lifetime). Caller picks the group it wants.
 */
export async function fetchCareerVsPitcher(
  batterId: number,
  pitcherId: number,
): Promise<RawStatsResponse | null> {
  const params = new URLSearchParams({
    stats: 'vsPlayer',
    group: 'hitting',
    opposingPlayerId: String(pitcherId),
  });
  const path = `/people/${batterId}/stats?${params.toString()}`;

  try {
    return await mlbFetchSplits<RawStatsResponse>(path, `career-vs:${batterId}:${pitcherId}`);
  } catch (err) {
    console.error(`fetchCareerVsPitcher(${batterId}, ${pitcherId}) failed:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pitching fetchers
// ---------------------------------------------------------------------------

/**
 * Fetch a single season of pitching stats filtered to "as starter" (sitCode
 * = sp). Filtering at the API level avoids the swingman-inflation problem
 * where stats=season aggregates starts + relief into nonsense IP/GS ratios.
 */
export async function fetchPitcherStarterLine(
  mlbId: number,
  season: number,
): Promise<RawStatsResponse | null> {
  const params = new URLSearchParams({
    stats: 'statSplits',
    group: 'pitching',
    sitCodes: 'sp',
    season: String(season),
    gameType: 'R',
  });
  const path = `/people/${mlbId}/stats?${params.toString()}`;

  try {
    return await mlbFetchSplits<RawStatsResponse>(path, `pitching-sp:${mlbId}:${season}`);
  } catch (err) {
    console.error(`fetchPitcherStarterLine(${mlbId}, ${season}) failed:`, err);
    return null;
  }
}

/** Fetch a pitcher's vs-L / vs-R OPS-allowed splits. */
export async function fetchPitcherPlatoon(
  mlbId: number,
  season: number,
): Promise<RawStatsResponse | null> {
  const params = new URLSearchParams({
    stats: 'statSplits',
    group: 'pitching',
    season: String(season),
    sitCodes: 'vl,vr',
    gameType: 'R',
  });
  const path = `/people/${mlbId}/stats?${params.toString()}`;

  try {
    return await mlbFetchSplits<RawStatsResponse>(path, `pitcher-platoon:${mlbId}:${season}`);
  } catch {
    return null;
  }
}

/** Fetch a pitcher's full game log (all appearances). */
export async function fetchPitcherGameLog(
  mlbId: number,
  season: number,
): Promise<RawStatsResponse | null> {
  const params = new URLSearchParams({
    stats: 'gameLog',
    group: 'pitching',
    season: String(season),
    gameType: 'R',
  });
  const path = `/people/${mlbId}/stats?${params.toString()}`;

  try {
    return await mlbFetchSplits<RawStatsResponse>(path, `pitcher-gamelog:${mlbId}:${season}`);
  } catch {
    return null;
  }
}
