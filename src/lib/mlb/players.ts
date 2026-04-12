import { mlbFetchSplits, mlbFetchIdentity } from './client';
import { withCache, CACHE_CATEGORIES } from '@/lib/fantasy/cache';
import { fetchStatcastPitchers, fetchStatcastBatters } from './savant';
import type { BatterSeasonStats, BatterSplits, MLBPlayerIdentity, PitcherQuality, PitcherTier, SplitLine } from './types';

// ---------------------------------------------------------------------------
// MLB Stats API response shapes
// ---------------------------------------------------------------------------

interface RawStat {
  avg?: string;
  obp?: string;
  slg?: string;
  ops?: string;
  homeRuns?: number;
  doubles?: number;
  triples?: number;
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
/**
 * Fetch the full game log for a player+season, cached for 1 hour.
 * Returns individual game entries sorted chronologically by the API.
 */
async function fetchGameLog(mlbId: number, season: number): Promise<RawSplit[]> {
  const params = new URLSearchParams({
    stats: 'gameLog',
    group: 'hitting',
    season: String(season),
    gameType: 'R',
  });
  const path = `/people/${mlbId}/stats?${params.toString()}`;
  const raw = await mlbFetchSplits<RawStatsResponse>(path, `gamelog:${mlbId}:${season}`);
  const group = findGroup(raw, 'gameLog');
  return group;
}

/**
 * Aggregate the last N games from a game log into a single SplitLine.
 *
 * The MLB Stats API's `lastXGames` endpoint ignores `numberOfGames` and always
 * returns the full season, so we fetch the gameLog once and slice it ourselves.
 */
function aggregateLastN(gameLog: RawSplit[], n: number): SplitLine | null {
  // Game log is chronological; take the last N entries
  const recent = gameLog.slice(-n);
  if (recent.length === 0) return null;

  let atBats = 0, hits = 0, homeRuns = 0, rbi = 0, stolenBases = 0;
  let strikeouts = 0, walks = 0, plateAppearances = 0;
  let totalBases = 0;

  for (const entry of recent) {
    const s = entry.stat;
    atBats += s.atBats ?? 0;
    hits += s.hits ?? 0;
    homeRuns += s.homeRuns ?? 0;
    rbi += s.rbi ?? 0;
    stolenBases += s.stolenBases ?? 0;
    strikeouts += s.strikeOuts ?? 0;
    walks += s.baseOnBalls ?? 0;
    plateAppearances += s.plateAppearances ?? 0;
    // Compute total bases from individual game components
    const gameHits = s.hits ?? 0;
    const gameDoubles = s.doubles ?? 0;
    const gameTriples = s.triples ?? 0;
    const gameHR = s.homeRuns ?? 0;
    const gameSingles = gameHits - gameDoubles - gameTriples - gameHR;
    totalBases += gameSingles + gameDoubles * 2 + gameTriples * 3 + gameHR * 4;
  }

  // Recalculate the hit-by-pitch and sacrifice flies from PA - AB - BB
  // (the API doesn't always provide these in game log entries)
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
    homeRuns,
    rbi,
    stolenBases,
    strikeouts,
    walks,
    atBats,
    hits,
    plateAppearances,
  };
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

  // Recent form always comes from the current season.
  // We fetch the game log once and slice it for each window.
  let last7: SplitLine | null = null;
  let last14: SplitLine | null = null;
  let last30: SplitLine | null = null;
  try {
    const gameLog = await fetchGameLog(mlbId, season);
    last7 = aggregateLastN(gameLog, 7);
    last14 = aggregateLastN(gameLog, 14);
    last30 = aggregateLastN(gameLog, 30);
  } catch (err) {
    console.error(`fetchGameLog(${mlbId}, ${season}) failed:`, err);
  }

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
}

/** Parse a pitching season line from the MLB Stats API. */
function parsePitchingLine(raw: RawStat): PitcherSeasonLine {
  const n = (v: string | undefined) => {
    if (!v) return null;
    const f = parseFloat(v);
    return isNaN(f) ? null : f;
  };
  const ip = n(raw.inningsPitched) ?? 0;
  const gs = raw.gamesStarted ?? null;
  return {
    era: n(raw.era),
    whip: n(raw.whip),
    ip,
    strikeoutsPer9: n(raw.strikeoutsPer9Inn),
    strikeOuts: raw.strikeOuts ?? null,
    gamesStarted: gs,
    pitchesPerInning: n(raw.pitchesPerInning),
    inningsPerStart: gs && gs > 0 ? Math.round((ip / gs) * 100) / 100 : null,
    wins: raw.wins ?? 0,
    losses: raw.losses ?? 0,
  };
}

/**
 * Classify a pitcher into a tier using ERA (or xERA when available), WHIP,
 * and K/9.
 *
 * When `xera` is supplied it replaces actual ERA as the primary signal.
 * xERA strips out luck and team defense and stabilises much faster (~50 BIP
 * vs ~200 IP for ERA), so it's a better classifier at any sample size.
 *
 * Base tiers (ERA + WHIP):
 * - ace:     ERA ≤ 2.75 AND WHIP ≤ 1.05
 * - tough:   ERA ≤ 3.50 AND WHIP ≤ 1.20
 * - bad:     ERA ≥ 5.00 AND WHIP ≥ 1.45
 * - weak:    ERA ≥ 4.25 OR  WHIP ≥ 1.36
 * - average: everything in between
 *
 * K/9 adjustments:
 * - tough + K/9 ≥ 10.0 → ace (elite K rate = dominant)
 * - average + K/9 ≤ 5.5 → weak (can't miss bats, vulnerable to hard contact)
 *
 * Caller is responsible for enforcing the IP/BIP sample gate.
 */
function classifyPitcherTier(
  era: number | null,
  whip: number | null,
  k9: number | null = null,
  xera: number | null = null,
): PitcherTier {
  // Use xERA as primary when available — it's more predictive than actual ERA
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

/**
 * Fetch a single season of pitching stats for a pitcher.
 * Returns null on API failure.
 */
async function fetchPitcherSeasonLine(
  mlbId: number,
  season: number,
): Promise<PitcherSeasonLine | null> {
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
 * When available, xERA from the Baseball Savant leaderboard is used as the
 * primary ERA signal in the tier classifier — it strips out luck and team
 * defense and stabilises much faster than actual ERA. If the pitcher is not
 * in the Savant dataset (too few BIP, e.g. < 10 PA in their system), the
 * classifier falls back to actual ERA as before.
 *
 * IP sample gates still apply to the Stats API data:
 *   - current season: IP ≥ 25
 *   - prior season fallback: IP ≥ 60
 *
 * Cached via mlbFetchSplits (1 hour) at the underlying fetch level.
 */
export async function getPitcherQuality(
  mlbId: number,
  season: number = new Date().getFullYear(),
): Promise<PitcherQuality> {
  // Fetch traditional stats + Savant data in parallel
  const [current, savantMap] = await Promise.all([
    fetchPitcherSeasonLine(mlbId, season),
    fetchStatcastPitchers(season),
  ]);

  const savant = savantMap.get(mlbId) ?? null;
  // Only use xERA when Savant has a meaningful sample (≥ 10 BIP)
  const xera = (savant && savant.bip >= 10) ? savant.xera : null;

  if (current && current.ip >= MIN_IP_CURRENT) {
    return {
      tier: classifyPitcherTier(current.era, current.whip, current.strikeoutsPer9, xera),
      era: current.era,
      whip: current.whip,
      inningsPitched: current.ip,
      season,
    };
  }

  // Fall back to prior season for IP gate, but keep current-season xERA
  // (Savant always reflects the current season leaderboard)
  const prior = await fetchPitcherSeasonLine(mlbId, season - 1);
  if (prior && prior.ip >= MIN_IP_PRIOR) {
    return {
      tier: classifyPitcherTier(prior.era, prior.whip, prior.strikeoutsPer9, xera),
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
 * Fetch a full pitcher season line for enrichment purposes.
 * Tries current season first, then falls back to prior season.
 * Used to back-fill ProbablePitcher objects when the schedule hydration
 * returns no stats (common in the first weeks of the season).
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

// ---------------------------------------------------------------------------
// Batch season stats for roster-level talent baseline
// ---------------------------------------------------------------------------

interface RosterPlayer {
  name: string;
  team: string;
}

/**
 * Fetch lightweight season stats (OPS, AVG, HR, SB, PA) for a list of
 * roster players.  Resolves Yahoo names → MLB IDs (all individually cached
 * 24 h) then fetches each player's current-season hitting line (cached 1 h).
 * Falls back to the prior season when current-year PA < 30.
 *
 * The result is keyed by `"name|team"` (lowercased) so the caller can look
 * up stats without needing MLB IDs.
 *
 * The entire assembled map is itself cached for 10 minutes to avoid
 * re-running the fan-out on every page navigation.
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
  const cacheKey = `${CACHE_CATEGORIES.SEMI_DYNAMIC.prefix}:roster-stats:${season}:${hashCode(sortedKey)}`;

  return withCache(cacheKey, CACHE_CATEGORIES.SEMI_DYNAMIC.ttlMedium, async () => {
    const results: Record<string, BatterSeasonStats> = {};

    // Fetch Savant batter leaderboard once for all players (24h cached)
    const savantMap = await fetchStatcastBatters(season);

    await Promise.all(
      players.map(async ({ name, team }) => {
        const key = `${name.toLowerCase()}|${team.toLowerCase()}`;
        try {
          const identity = await resolveMLBId(name, team);
          if (!identity) return;

          const current = await fetchStatSplitsForSeason(identity.mlbId, season);
          if (!current) return;

          const seasonGroup = findGroup(current.raw, 'season');
          const first = seasonGroup[0];
          let line = first ? parseSplitLine(first.stat) : null;
          let usedSeason = season;

          // Fall back to prior year when current PA is too thin
          if (!line || line.plateAppearances < 30) {
            const fallback = await fetchStatSplitsForSeason(identity.mlbId, season - 1);
            if (fallback) {
              const fbGroup = findGroup(fallback.raw, 'season');
              const fbFirst = fbGroup[0];
              if (fbFirst) {
                const fbLine = parseSplitLine(fbFirst.stat);
                if (fbLine.plateAppearances >= 30) {
                  line = fbLine;
                  usedSeason = season - 1;
                }
              }
            }
          }

          if (line) {
            // xwOBA and wOBA from Savant — always current season, null when
            // the player has too few BIP for Savant to compute expected stats
            const savant = savantMap.get(identity.mlbId);
            const xwoba = (savant && savant.bip >= 5) ? savant.xwoba : null;
            const woba = (savant && savant.bip >= 5) ? savant.woba : null;

            results[key] = {
              mlbId: identity.mlbId,
              ops: line.ops,
              avg: line.avg,
              hr: line.homeRuns,
              sb: line.stolenBases,
              pa: line.plateAppearances,
              season: usedSeason,
              xwoba,
              woba,
            };
          }
        } catch (err) {
          console.error(`getRosterSeasonStats: failed for ${name} (${team}):`, err);
        }
      }),
    );

    return results;
  });
}

function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

