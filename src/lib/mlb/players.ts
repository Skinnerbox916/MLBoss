import { mlbFetchSplits, mlbFetchIdentity } from './client';
import type { BatterSplits, MLBPlayerIdentity, PitcherQuality, PitcherTier, SplitLine } from './types';

// ---------------------------------------------------------------------------
// MLB Stats API response shapes
// ---------------------------------------------------------------------------

interface RawStat {
  avg?: string;
  obp?: string;
  slg?: string;
  ops?: string;
  homeRuns?: number;
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
}

interface RawSplit {
  split?: { code: string; description: string };
  season?: string;
  isHome?: boolean;
  stat: RawStat;
}

interface RawStatsGroup {
  type?: { displayName: string };
  group?: { displayName: string };
  splits: RawSplit[];
}

// /people/{id}/stats?... returns { stats: [...] } directly
interface RawStatsResponse {
  stats?: RawStatsGroup[];
}

// /people/{id} and /people/search return { people: [...] }
interface RawPerson {
  id: number;
  fullName: string;
  currentTeam?: { abbreviation?: string };
  batSide?: { code: string };
  pitchHand?: { code: string };
  primaryPosition?: { abbreviation: string };
  active?: boolean;
}

interface RawPersonResponse {
  people?: RawPerson[];
}

interface RawSearchResponse {
  people?: Array<{
    id: number;
    fullName: string;
    currentTeam?: { name?: string; abbreviation?: string };
    active?: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseSplitLine(raw: RawStat): SplitLine {
  const n = (v: string | undefined) => {
    if (!v) return null;
    const f = parseFloat(v);
    return isNaN(f) ? null : f;
  };
  return {
    avg: n(raw.avg),
    obp: n(raw.obp),
    slg: n(raw.slg),
    ops: n(raw.ops),
    homeRuns: raw.homeRuns ?? 0,
    rbi: raw.rbi ?? 0,
    stolenBases: raw.stolenBases ?? 0,
    strikeouts: raw.strikeOuts ?? 0,
    walks: raw.baseOnBalls ?? 0,
    atBats: raw.atBats ?? 0,
    hits: raw.hits ?? 0,
    plateAppearances: raw.plateAppearances ?? 0,
  };
}

function findByCode(splits: RawSplit[], code: string): SplitLine | null {
  const match = splits.find(s => s.split?.code === code);
  return match ? parseSplitLine(match.stat) : null;
}

function findGroup(resp: RawStatsResponse, typeName: string): RawSplit[] {
  const group = resp.stats?.find(g => g.type?.displayName === typeName);
  return group?.splits ?? [];
}

// ---------------------------------------------------------------------------
// Player identity resolution (name → MLB ID)
// ---------------------------------------------------------------------------

/**
 * Fetch the full /people/{id} record with currentTeam hydrated (cached 24h).
 *
 * The currentTeam hydrate is critical: without it, the response omits team
 * info entirely, which means two players with identical names (e.g. the two
 * Max Muncys — 571970 on LAD and 691777 on ATH) can't be told apart.
 */
async function fetchPersonRecord(mlbId: number): Promise<RawPerson | null> {
  const raw = await mlbFetchIdentity<RawPersonResponse>(
    `/people/${mlbId}?hydrate=currentTeam`,
    `person-full:${mlbId}`,
  );
  return raw.people?.[0] ?? null;
}

/**
 * Search for a player by name and resolve to a single MLB identity.
 *
 * Disambiguation order when multiple candidates share a name (e.g. two
 * Max Muncys):
 *   1. Hydrate every active candidate via /people/{id} (cached)
 *   2. Pick the one whose currentTeam matches the supplied teamAbbr
 *   3. If no team match, pick the first active candidate
 *
 * Cached 24 hours at the fetch layer — player IDs don't change.
 */
export async function resolveMLBId(
  fullName: string,
  teamAbbr?: string,
): Promise<MLBPlayerIdentity | null> {
  const cacheKey = `resolve:${fullName.toLowerCase().replace(/\s+/g, '-')}`;

  try {
    const encoded = encodeURIComponent(fullName);
    const raw = await mlbFetchIdentity<RawSearchResponse>(
      `/people/search?names=${encoded}&sportIds=1`,
      cacheKey,
    );

    if (!raw.people || raw.people.length === 0) return null;

    // Prefer active players
    const activeCandidates = raw.people.filter(p => p.active !== false);
    const candidates = activeCandidates.length > 0 ? activeCandidates : raw.people;

    // Hydrate every candidate in parallel so we can match on currentTeam.
    // /people/search doesn't return team info, so this second call is the
    // only way to disambiguate same-name players.
    const hydrated = await Promise.all(
      candidates.map(async c => {
        try {
          return await fetchPersonRecord(c.id);
        } catch {
          return null;
        }
      }),
    );
    const people = hydrated.filter((p): p is NonNullable<typeof p> => p !== null);
    if (people.length === 0) return null;

    // Pick the one whose current team matches the supplied abbr
    let best = people[0];
    if (teamAbbr) {
      const wanted = teamAbbr.toUpperCase();
      const teamMatch = people.find(
        p => p.currentTeam?.abbreviation?.toUpperCase() === wanted,
      );
      if (teamMatch) best = teamMatch;
    }

    return {
      mlbId: best.id,
      fullName: best.fullName,
      currentTeamAbbr: best.currentTeam?.abbreviation ?? teamAbbr ?? '',
      bats: (best.batSide?.code ?? 'R') as 'L' | 'R' | 'S',
      throws: (best.pitchHand?.code ?? 'R') as 'L' | 'R' | 'S',
      primaryPosition: best.primaryPosition?.abbreviation ?? '',
      active: best.active ?? true,
    };
  } catch (err) {
    console.error(`resolveMLBId failed for "${fullName}":`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Batter splits
// ---------------------------------------------------------------------------

/**
 * Fetch vs-L/R, home/away, day/night, and season totals for one season.
 * Uses /people/{id}/stats?stats=statSplits,season&sitCodes=vl,vr,h,a,d,n
 */
async function fetchStatSplitsForSeason(
  mlbId: number,
  season: number,
): Promise<{ raw: RawStatsResponse; splits: RawSplit[] } | null> {
  const params = new URLSearchParams({
    stats: 'statSplits,season',
    group: 'hitting',
    season: String(season),
    sitCodes: 'vl,vr,h,a,d,n',
    gameType: 'R',
  });
  const path = `/people/${mlbId}/stats?${params.toString()}`;

  try {
    const raw = await mlbFetchSplits<RawStatsResponse>(path, `statsplits:${mlbId}:${season}`);
    const splits = findGroup(raw, 'statSplits');
    return { raw, splits };
  } catch (err) {
    console.error(`fetchStatSplitsForSeason(${mlbId}, ${season}) failed:`, err);
    return null;
  }
}

/** Fetch a single last-N-games aggregated stat line. */
async function fetchLastXGames(mlbId: number, n: number, season: number): Promise<SplitLine | null> {
  const params = new URLSearchParams({
    stats: 'lastXGames',
    group: 'hitting',
    numberOfGames: String(n),
    season: String(season),
    gameType: 'R',
  });
  const path = `/people/${mlbId}/stats?${params.toString()}`;

  try {
    const raw = await mlbFetchSplits<RawStatsResponse>(path, `lastx:${mlbId}:${season}:${n}`);
    const group = findGroup(raw, 'lastXGames');
    // Response contains duplicates across team contexts; use the first non-empty line
    const first = group.find(s => s.stat && (s.stat.plateAppearances ?? 0) > 0) ?? group[0];
    return first ? parseSplitLine(first.stat) : null;
  } catch (err) {
    console.error(`fetchLastXGames(${mlbId}, ${n}, ${season}) failed:`, err);
    return null;
  }
}

/**
 * Fetch all relevant batting splits for a player.
 *
 * Early-season fallback: if the current season has < 20 PA in the
 * season totals, we fall back to the previous season for handedness/
 * venue/day-night splits (form stats stay on the current season).
 */
export async function getBatterSplits(
  mlbId: number,
  season: number = new Date().getFullYear(),
): Promise<BatterSplits | null> {
  // Fetch current season stat splits + totals in one call
  const current = await fetchStatSplitsForSeason(mlbId, season);
  if (!current) return null;

  // Always preserve the current calendar year line — even if we fall back to
  // prior year for handedness/venue splits, we still want to surface "how is
  // this player hitting THIS year" prominently in the UI.
  const currentSeasonLine = (() => {
    const seasonGroup = findGroup(current.raw, 'season');
    const first = seasonGroup[0];
    return first ? parseSplitLine(first.stat) : null;
  })();

  // Early-season guardrail: if current season is too thin, look up last year
  // for handedness/venue/day-night splits. seasonTotals (the comparison
  // baseline) follows the same source as splitSource for internal consistency.
  const currentPA = currentSeasonLine?.plateAppearances ?? 0;
  const EARLY_SEASON_PA = 30;
  const useFallback = currentPA < EARLY_SEASON_PA;

  let splitSource = current.splits;
  let seasonTotalsForCompare = currentSeasonLine;
  let sourceSeason = season;

  if (useFallback) {
    const fallback = await fetchStatSplitsForSeason(mlbId, season - 1);
    if (fallback && fallback.splits.length > 0) {
      splitSource = fallback.splits;
      sourceSeason = season - 1;
      const fbSeasonGroup = findGroup(fallback.raw, 'season');
      const fbFirst = fbSeasonGroup[0];
      if (fbFirst) seasonTotalsForCompare = parseSplitLine(fbFirst.stat);
    }
  }

  // Recent form always comes from the current season
  const [last7, last14, last30] = await Promise.all([
    fetchLastXGames(mlbId, 7, season),
    fetchLastXGames(mlbId, 14, season),
    fetchLastXGames(mlbId, 30, season),
  ]);

  // Resolve name from the shared person record (cheap, cached)
  let name = '';
  try {
    const person = await fetchPersonRecord(mlbId);
    name = person?.fullName ?? '';
  } catch {
    /* non-fatal */
  }

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
// Pitcher quality
// ---------------------------------------------------------------------------

const MIN_IP_CURRENT = 25;   // ≈ 4–5 starts before current-season sample is usable
const MIN_IP_PRIOR = 60;     // rough cut for a meaningful prior season

/** Parse a pitching season line into (era, whip, ip). */
function parsePitchingLine(raw: RawStat): { era: number | null; whip: number | null; ip: number } {
  const n = (v: string | undefined) => {
    if (!v) return null;
    const f = parseFloat(v);
    return isNaN(f) ? null : f;
  };
  return {
    era: n(raw.era),
    whip: n(raw.whip),
    ip: n(raw.inningsPitched) ?? 0,
  };
}

/**
 * Classify a pitcher into a tier using ERA + WHIP.
 *
 * - ace:     ERA ≤ 2.75 AND WHIP ≤ 1.05
 * - tough:   ERA ≤ 3.50 AND WHIP ≤ 1.20
 * - bad:     ERA ≥ 5.00 AND WHIP ≥ 1.45
 * - weak:    ERA ≥ 4.25 OR  WHIP ≥ 1.36
 * - average: everything in between
 * - unknown: null stats
 *
 * Caller is responsible for enforcing the IP sample gate.
 */
function classifyPitcherTier(era: number | null, whip: number | null): PitcherTier {
  if (era === null || whip === null) return 'unknown';

  if (era <= 2.75 && whip <= 1.05) return 'ace';
  if (era >= 5.00 && whip >= 1.45) return 'bad';
  if (era <= 3.50 && whip <= 1.20) return 'tough';
  if (era >= 4.25 || whip >= 1.36) return 'weak';
  return 'average';
}

/**
 * Fetch a single season of pitching stats for a pitcher.
 * Returns null on API failure.
 */
async function fetchPitcherSeasonLine(
  mlbId: number,
  season: number,
): Promise<{ era: number | null; whip: number | null; ip: number } | null> {
  const params = new URLSearchParams({
    stats: 'season',
    group: 'pitching',
    season: String(season),
    gameType: 'R',
  });
  const path = `/people/${mlbId}/stats?${params.toString()}`;

  try {
    const raw = await mlbFetchSplits<RawStatsResponse>(path, `pitching:${mlbId}:${season}`);
    const group = findGroup(raw, 'season');
    const first = group[0];
    return first ? parsePitchingLine(first.stat) : null;
  } catch (err) {
    console.error(`fetchPitcherSeasonLine(${mlbId}, ${season}) failed:`, err);
    return null;
  }
}

/**
 * Get a pitcher's tiered quality snapshot.
 *
 * Uses current season when IP ≥ 25 (enough of a sample), otherwise falls back
 * to the prior season. If both are too thin, returns tier='unknown' so the UI
 * can omit the pill.
 *
 * Cached via mlbFetchSplits (1 hour) at the underlying fetch level.
 */
export async function getPitcherQuality(
  mlbId: number,
  season: number = new Date().getFullYear(),
): Promise<PitcherQuality> {
  const current = await fetchPitcherSeasonLine(mlbId, season);

  if (current && current.ip >= MIN_IP_CURRENT) {
    return {
      tier: classifyPitcherTier(current.era, current.whip),
      era: current.era,
      whip: current.whip,
      inningsPitched: current.ip,
      season,
    };
  }

  // Fall back to prior season
  const prior = await fetchPitcherSeasonLine(mlbId, season - 1);
  if (prior && prior.ip >= MIN_IP_PRIOR) {
    return {
      tier: classifyPitcherTier(prior.era, prior.whip),
      era: prior.era,
      whip: prior.whip,
      inningsPitched: prior.ip,
      season: season - 1,
    };
  }

  // No reliable sample in either year
  return {
    tier: 'unknown',
    era: current?.era ?? prior?.era ?? null,
    whip: current?.whip ?? prior?.whip ?? null,
    inningsPitched: current?.ip ?? prior?.ip ?? 0,
    season: (current?.ip ?? 0) > 0 ? season : season - 1,
  };
}

/**
 * Get a batter's career stats against a specific pitcher.
 * Uses the vsPlayerTotal response group (all-time, all game types).
 * Returns null if no meaningful history (< 5 PA).
 */
export async function getCareerVsPitcher(
  batterId: number,
  pitcherId: number,
): Promise<SplitLine | null> {
  const params = new URLSearchParams({
    stats: 'vsPlayer',
    group: 'hitting',
    opposingPlayerId: String(pitcherId),
  });
  const path = `/people/${batterId}/stats?${params.toString()}`;

  try {
    const raw = await mlbFetchSplits<RawStatsResponse>(
      path,
      `career-vs:${batterId}:${pitcherId}`,
    );
    // Prefer vsPlayerTotal (lifetime) over vsPlayer (year-by-year)
    const total = findGroup(raw, 'vsPlayerTotal');
    const source = total.length > 0 ? total : findGroup(raw, 'vsPlayer');
    if (source.length === 0) return null;

    const line = parseSplitLine(source[0].stat);
    return (line.plateAppearances ?? 0) >= 5 ? line : null;
  } catch (err) {
    console.error(`getCareerVsPitcher(${batterId}, ${pitcherId}) failed:`, err);
    return null;
  }
}

