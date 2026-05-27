import { mlbFetchSchedule, mlbFetchTeamStats } from './client';
import {
  applyPitcherPlatoon,
  applyPitcherRecentForm,
  applyPitcherStatsLine,
  applySavantSignals,
} from './model';
import { getParkByVenueId } from './parks';
import {
  fetchPitcherFullLine,
  fetchPitcherOverallSeasonEra,
  fetchPitcherPlatoonSplits,
  fetchPitcherRecentForm,
  resolveMLBId,
  getPitcherSeasonLines,
} from './players';
import { fetchStatcastPitchers } from './savant';
import { computePitcherTalent } from '../pitching/talent';
import { fetchESPNScoreboard, extractPitchersFromEvent } from '../espn/client';
import { recordPostedLineup } from './lineupSpots';
import type {
  MLBGame, ProbablePitcher, GameWeather, LineupEntry,
  RolePitchingLine, TeamStaffSplits,
} from './types';
import {
  LEAGUE_SB_ALLOWED_PER_IP_FALLBACK,
  setLeagueSbAllowedPerIp,
} from './leagueRates';

// ---------------------------------------------------------------------------
// MLB Stats API response shapes (internal — not exported)
// ---------------------------------------------------------------------------

interface RawTeam {
  id: number;
  name: string;
  abbreviation?: string;
  teamName?: string;
}

interface RawVenue {
  id: number;
  name: string;
}

interface RawWeather {
  temp?: string;       // MLB API returns this as 'temp', not 'temperature'
  condition?: string;
  wind?: string;
}

interface RawLineupPlayer {
  id: number;
  fullName: string;
  primaryPosition?: {
    abbreviation?: string;
  };
}

interface RawGame {
  gamePk: number;
  gameDate: string;
  status: { detailedState: string };
  teams: {
    home: { team: RawTeam };
    away: { team: RawTeam };
  };
  venue?: RawVenue;
  weather?: RawWeather;
  lineups?: {
    homePlayers?: RawLineupPlayer[];
    awayPlayers?: RawLineupPlayer[];
  };
}

interface RawScheduleResponse {
  dates?: Array<{
    date: string;
    games: RawGame[];
  }>;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseWind(raw: string | undefined): { speed: number | null; direction: string | null } {
  if (!raw) return { speed: null, direction: null };
  // Typical format: "12 mph, Out To CF" or "Calm"
  const match = raw.match(/^(\d+)\s*mph,?\s*(.*)$/i);
  if (!match) return { speed: 0, direction: raw.trim() || null };
  return {
    speed: parseInt(match[1], 10),
    direction: match[2].trim() || null,
  };
}

function parseWeather(raw: RawWeather | undefined): GameWeather {
  if (!raw) return { temperature: null, condition: null, wind: null, windSpeed: null, windDirection: null };
  const { speed, direction } = parseWind(raw.wind);
  return {
    temperature: raw.temp ? parseInt(raw.temp, 10) : null,
    condition: raw.condition ?? null,
    wind: raw.wind ?? null,
    windSpeed: speed,
    windDirection: direction,
  };
}

function parseLineup(players: RawLineupPlayer[] | undefined): LineupEntry[] {
  if (!players) return [];
  return players.map((p, i) => ({
    mlbId: p.id,
    fullName: p.fullName,
    battingOrder: i + 1,
    position: p.primaryPosition?.abbreviation ?? '',
  }));
}

function parseGame(raw: RawGame): MLBGame {
  const venueId = raw.venue?.id ?? 0;
  const park = getParkByVenueId(venueId);

  return {
    gamePk: raw.gamePk,
    gameDate: raw.gameDate,
    status: raw.status.detailedState,
    homeTeam: {
      mlbId: raw.teams.home.team.id,
      name: raw.teams.home.team.name,
      abbreviation: raw.teams.home.team.abbreviation ?? raw.teams.home.team.teamName ?? '',
    },
    awayTeam: {
      mlbId: raw.teams.away.team.id,
      name: raw.teams.away.team.name,
      abbreviation: raw.teams.away.team.abbreviation ?? raw.teams.away.team.teamName ?? '',
    },
    venue: {
      mlbId: venueId,
      name: raw.venue?.name ?? park?.name ?? 'Unknown Venue',
    },
    weather: parseWeather(raw.weather),
    // Pitchers come from ESPN, spliced in by getGameDay after this parse.
    // MLB's probablePitcher hydrate is no longer requested, so there's
    // nothing to parse here.
    homeProbablePitcher: null,
    awayProbablePitcher: null,
    homeLineup: parseLineup(raw.lineups?.homePlayers),
    awayLineup: parseLineup(raw.lineups?.awayPlayers),
  };
}

// ---------------------------------------------------------------------------
// Team aggregate pitching stats (for opposing staff quality)
// ---------------------------------------------------------------------------

interface RawTeamStatsResponse {
  stats?: Array<{
    type?: { displayName: string };
    splits: Array<{
      team: { id: number; name: string };
      stat: { era?: string };
    }>;
  }>;
}

/**
 * Fetch all MLB teams' season pitching ERA in a single call. Cached 24h —
 * team aggregates barely move game-to-game. Returns teamId → ERA map.
 */
async function fetchTeamStaffEra(
  season: number = new Date().getFullYear(),
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  try {
    const raw = await mlbFetchTeamStats<RawTeamStatsResponse>(
      `/teams/stats?stats=season&group=pitching&sportId=1&season=${season}&gameType=R`,
      `team-pitching:${season}`,
    );
    const group = raw.stats?.find(g => g.type?.displayName === 'season');
    if (group) {
      for (const split of group.splits) {
        const era = split.stat.era ? parseFloat(split.stat.era) : null;
        if (era !== null && !isNaN(era)) {
          map.set(split.team.id, era);
        }
      }
    }
  } catch (err) {
    console.error('fetchTeamStaffEra failed:', err);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Team SP/RP split aggregates
// ---------------------------------------------------------------------------

interface RawRoleStat {
  inningsPitched?: string;
  battersFaced?: number;
  strikeOuts?: number;
  baseOnBalls?: number;
  hits?: number;
  homeRuns?: number;
  stolenBases?: number;
  avg?: string;
  era?: string;
}

interface RawTeamStaffSplitsResponse {
  stats?: Array<{
    type?: { displayName: string };
    splits: Array<{
      team: { id: number; name: string };
      split?: { code?: string };
      stat: RawRoleStat;
    }>;
  }>;
}

/**
 * Parse "865.2" (innings.outs) into 865.667 decimal IP. MLB API uses
 * baseball notation for innings — the digit after the decimal is OUTS
 * (0, 1, or 2) not tenths.
 */
function parseInnings(ip: string | undefined): number {
  if (!ip) return 0;
  const [whole, outs] = ip.split('.');
  return parseInt(whole, 10) + (outs ? parseInt(outs, 10) / 3 : 0);
}

function parseRoleLine(stat: RawRoleStat): RolePitchingLine | null {
  const ip = parseInnings(stat.inningsPitched);
  const bf = stat.battersFaced ?? 0;
  if (ip <= 0 || bf <= 0) return null;
  const baa = stat.avg ? parseFloat(stat.avg) : 0;
  const era = stat.era ? parseFloat(stat.era) : 0;
  return {
    ip,
    battersFaced: bf,
    kPerPA: (stat.strikeOuts ?? 0) / bf,
    bbPerPA: (stat.baseOnBalls ?? 0) / bf,
    hitsPerPA: (stat.hits ?? 0) / bf,
    hrPerPA: (stat.homeRuns ?? 0) / bf,
    baa: isNaN(baa) ? 0 : baa,
    era: isNaN(era) ? 0 : era,
    sbAllowedPerIp: (stat.stolenBases ?? 0) / ip,
  };
}

/**
 * Result of fetching team SP/RP splits — the per-team map plus the
 * league-wide SB-allowed-per-IP mean derived from totals across all
 * splits. The SB cat modifier reads `leagueSbAllowedPerIp` so the
 * league anchor is sourced from the same call as the team data
 * rather than from a hardcoded constant that goes stale.
 */
interface TeamStaffSplitsResult {
  byTeam: Map<number, TeamStaffSplits>;
  leagueSbAllowedPerIp: number;
}

/**
 * Fetch all MLB teams' SP/RP-split pitching aggregates in a single
 * `statSplits` call. Cached 24h. Returns per-team SP and RP role lines
 * plus the league-wide SB-allowed-per-IP mean used by the SB cat
 * modifier.
 *
 * The MLB Stats API `statSplits` endpoint with `sitCodes=sp,rp`
 * returns 60 rows (30 teams × 2 roles). Limit set high to avoid the
 * default page truncation.
 */
async function fetchTeamStaffSplits(
  season: number = new Date().getFullYear(),
): Promise<TeamStaffSplitsResult> {
  const byTeam = new Map<number, TeamStaffSplits>();
  let totalSb = 0;
  let totalIp = 0;
  try {
    const raw = await mlbFetchTeamStats<RawTeamStaffSplitsResponse>(
      `/teams/stats?stats=statSplits&group=pitching&sportId=1&season=${season}&sitCodes=sp,rp&gameType=R&limit=100`,
      `team-staff-splits:${season}`,
    );
    const group = raw.stats?.find(g => g.type?.displayName === 'statSplits');
    if (group) {
      for (const split of group.splits) {
        const code = split.split?.code;
        if (code !== 'sp' && code !== 'rp') continue;
        const line = parseRoleLine(split.stat);
        if (!line) continue;
        const existing = byTeam.get(split.team.id) ?? { sp: null, rp: null };
        if (code === 'sp') existing.sp = line;
        else existing.rp = line;
        byTeam.set(split.team.id, existing);
        totalSb += (split.stat.stolenBases ?? 0);
        totalIp += line.ip;
      }
    }
  } catch (err) {
    console.error('fetchTeamStaffSplits failed:', err);
  }
  const leagueSbAllowedPerIp = totalIp > 0
    ? totalSb / totalIp
    : LEAGUE_SB_ALLOWED_PER_IP_FALLBACK;
  return { byTeam, leagueSbAllowedPerIp };
}


// ---------------------------------------------------------------------------
// ESPN pitcher-name lookup (single source of truth for probable-pitcher names)
//
// MLB's /schedule endpoint only fills `probablePitcher` for games ~2-3 days
// out. ESPN publishes them for the full week. To avoid having a fast lane
// (today) and a slow lane (later in the week) with subtly different data,
// we drop MLB's pitcher hydrate entirely and source every probable-pitcher
// name from ESPN. Names are then resolved to MLB IDs via `resolveMLBId`,
// after which the standard enrichment pipeline (line + Savant + platoon +
// recent form + talent) runs unchanged.
//
// MLB and ESPN disagree on Arizona's abbreviation (`AZ` vs `ARI`); without
// canonicalization the matchup-key lookup silently misses every D-backs
// game. The shared alias table in `@/lib/mlb/teamAbbr` covers that and
// every other historically-divergent franchise so this engine and the
// FA→probable matcher in `pitching/display.tsx` can never drift.
// ---------------------------------------------------------------------------

import { normalizeTeamAbbr as canonicalScheduleAbbr } from './teamAbbr';

/**
 * Build a `Map<homeAbbr|awayAbbr, { home, away }>` from an ESPN scoreboard
 * response so MLB games can look up probable-pitcher names in O(1) by team
 * pair. Falls back to per-team-abbreviation entries so doubleheaders that
 * don't have a clean pair-key still resolve.
 */
function indexEspnPitchers(
  espn: { events: import('../espn/client').ESPNEvent[] },
): Map<string, { home: string | null; away: string | null }> {
  const map = new Map<string, { home: string | null; away: string | null }>();
  for (const event of espn.events ?? []) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    if (!home || !away) continue;
    const [homeName, awayName] = extractPitchersFromEvent(event);
    const key = `${canonicalScheduleAbbr(home.team.abbreviation)}|${canonicalScheduleAbbr(away.team.abbreviation)}`;
    map.set(key, { home: homeName, away: awayName });
  }
  return map;
}

/**
 * Build a stub `ProbablePitcher` from a name. `mlbId: 0` is the sentinel
 * that tells `enrichPitcher` to do an identity lookup before running the
 * stats pipeline. Throws starts null (honest "unknown") and `enrichPitcher`
 * fills it from the identity lookup (`pitchHand`). It stays null only if the
 * name never resolves to an MLB id, in which case the row is fully degraded
 * (no stats/talent) and downstream treats the null hand as neutral.
 */
function stubPitcher(name: string): ProbablePitcher {
  return {
    mlbId: 0,
    name,
    throws: null,
    era: null,
    whip: null,
    wins: 0,
    losses: 0,
    inningsPitched: 0,
    strikeoutsPer9: null,
    strikeOuts: null,
    gamesStarted: null,
    pitchesPerInning: null,
    inningsPerStart: null,
    bb9: null,
    hr9: null,
    battingAvgAgainst: null,
    gbRate: null,
    eraLast30: null,
    recentFormEra: null,
    platoonOpsVsLeft: null,
    platoonOpsVsRight: null,
    xera: null,
    xwoba: null,
    avgFastballVelo: null,
    avgFastballVeloPrior: null,
    runValuePer100: null,
    talent: null,
  };
}

// ---------------------------------------------------------------------------
// Per-date game fetching
// ---------------------------------------------------------------------------

/**
 * Fetch all MLB games for a date with probable pitchers, weather, and park data.
 * Refreshes every 5 minutes — probable pitchers get confirmed close to game time.
 *
 * Probable-pitcher names come from ESPN (full-week coverage); MLB Stats API
 * provides everything else (schedule, venue, weather, lineups, the per-pitcher
 * stats that drive enrichment). After name → MLB ID resolution, every pitcher
 * runs through the documented enrichment + talent pipeline; this is the
 * canonical stamp point for `pp.talent` per `docs/unified-rating-model.md`.
 */
export async function getGameDay(date: string): Promise<MLBGame[]> {
  // No probablePitcher hydrate — ESPN owns that field. We keep venue,
  // weather, team, and lineups (all MLB-only).
  const hydrate = ['venue', 'weather', 'team', 'lineups'].join(',');
  const path = `/schedule?sportId=1&date=${date}&hydrate=${encodeURIComponent(hydrate)}`;

  // Fetch MLB schedule + ESPN scoreboard + slate-wide context in parallel.
  // ESPN is the source of truth for who's pitching; MLB owns the game shell.
  const currentYear = new Date().getFullYear();
  const [raw, espn, savantMap, priorSavantMap, teamEraMap, staffSplitsResult] = await Promise.all([
    mlbFetchSchedule<RawScheduleResponse>(path, date),
    fetchESPNScoreboard(date, date).catch(err => {
      console.error('ESPN scoreboard fetch failed; pitcher names will be missing:', err);
      return { events: [] };
    }),
    fetchStatcastPitchers(currentYear),
    fetchStatcastPitchers(currentYear - 1),
    fetchTeamStaffEra(),
    fetchTeamStaffSplits(),
  ]);
  setLeagueSbAllowedPerIp(staffSplitsResult.leagueSbAllowedPerIp);

  const dateEntry = raw.dates?.[0];
  if (!dateEntry) return [];

  const games = dateEntry.games.map(parseGame);

  // Splice ESPN pitcher names onto each MLB game by matching home|away
  // team abbreviation. Replaces whatever MLB returned (which is now empty
  // anyway since we dropped the probablePitcher hydrate) with the ESPN
  // name, ensuring full-week coverage.
  const espnByMatchup = indexEspnPitchers(espn);
  for (const game of games) {
    const key = `${canonicalScheduleAbbr(game.homeTeam.abbreviation)}|${canonicalScheduleAbbr(game.awayTeam.abbreviation)}`;
    const espnNames = espnByMatchup.get(key);
    if (espnNames) {
      game.homeProbablePitcher = espnNames.home ? stubPitcher(espnNames.home) : null;
      game.awayProbablePitcher = espnNames.away ? stubPitcher(espnNames.away) : null;
    } else {
      game.homeProbablePitcher = null;
      game.awayProbablePitcher = null;
    }
  }

  // Enrich each pitcher: resolve ESPN name → MLB ID, then run the
  // documented enrichment pipeline (line + Savant + platoon + recent form)
  // and stamp the canonical talent vector. `enrichPitcher` is a closure so
  // it can access the slate-wide maps fetched above.
  const enrichPitcher = async (p: ProbablePitcher, teamAbbr: string) => {
    if (p.mlbId === 0) {
      const identity = await resolveMLBId(p.name, teamAbbr);
      if (!identity?.mlbId) return; // unknown name — leave as stub
      p.mlbId = identity.mlbId;
      // Handedness rides along with the identity lookup (pitchHand is on the
      // base /people record). The stub defaulted throws to 'R'; without this
      // every ESPN-sourced pitcher would stay 'R', silently mis-platooning
      // batters (vs-RHP split applied vs actual LHPs), tilting the SB forecast,
      // and mis-resolving switch-hitter park factors. Must land before
      // computePitcherTalent below so the talent vector carries the real hand.
      p.throws = identity.throws;
    }

    const [line, overallEra, platoon, recentForm, seasonLines] = await Promise.all([
      fetchPitcherFullLine(p.mlbId),
      fetchPitcherOverallSeasonEra(p.mlbId),
      fetchPitcherPlatoonSplits(p.mlbId),
      fetchPitcherRecentForm(p.mlbId),
      getPitcherSeasonLines(p.mlbId),
    ]);
    applyPitcherStatsLine(p, line);
    // Overlay the user-facing ERA with the overall (all-appearances) value.
    // `applyPitcherStatsLine` wrote the SP-filtered ERA so the talent and
    // projection-relevant fields stay "as starter" pure, but for the ERA
    // pill next to the SP name in the lineup card the user expects what
    // Yahoo shows — the overall season ERA. Matters for relievers making
    // spot starts (1 outing × 0 ER → 0.00 SP-filtered ERA).
    if (overallEra !== null) p.era = overallEra;
    applySavantSignals(p, savantMap.get(p.mlbId), priorSavantMap.get(p.mlbId));
    applyPitcherPlatoon(p, platoon);
    applyPitcherRecentForm(p, recentForm);

    p.talent = computePitcherTalent({
      mlbId: p.mlbId,
      throws: p.throws,
      currentLine: seasonLines.current,
      priorLine: seasonLines.prior,
      currentSavant: savantMap.get(p.mlbId) ?? null,
      priorSavant: priorSavantMap.get(p.mlbId) ?? null,
    });
  };

  await Promise.all(
    games.flatMap(game => {
      const jobs: Promise<void>[] = [];
      if (game.homeProbablePitcher) jobs.push(enrichPitcher(game.homeProbablePitcher, game.homeTeam.abbreviation));
      if (game.awayProbablePitcher) jobs.push(enrichPitcher(game.awayProbablePitcher, game.awayTeam.abbreviation));
      return jobs;
    }),
  );

  // Attach team staff ERA for the opposing-staff pill (today batting)
  // and the W-probability bullpen multiplier when SP/RP splits are
  // missing. Attach the SP/RP splits for the batter SP/RP blend and
  // the W-probability bullpen multiplier's real-RP-ERA path.
  for (const game of games) {
    game.homeTeam.staffEra = teamEraMap.get(game.homeTeam.mlbId);
    game.awayTeam.staffEra = teamEraMap.get(game.awayTeam.mlbId);
    game.homeTeam.staffSplits = staffSplitsResult.byTeam.get(game.homeTeam.mlbId);
    game.awayTeam.staffSplits = staffSplitsResult.byTeam.get(game.awayTeam.mlbId);
  }

  // Fire-and-forget: record any posted lineup spots so the forward-projection
  // engine can apply them as priors for D+1+ where MLB hasn't posted lineups
  // yet. No-op when arrays are empty (typical for future dates). See
  // `lineupSpots.ts` for the cache shape and 7-day TTL.
  void Promise.all(
    games.flatMap(game => [
      recordPostedLineup(game.homeLineup, date),
      recordPostedLineup(game.awayLineup, date),
    ]),
  );

  return games;
}

/**
 * Get the game for a specific team on a given date.
 * Returns null if the team has no game that day.
 */
export async function getTeamGame(teamAbbr: string, date: string): Promise<MLBGame | null> {
  const games = await getGameDay(date);
  const abbr = teamAbbr.toUpperCase();
  return games.find(
    g => g.homeTeam.abbreviation.toUpperCase() === abbr ||
         g.awayTeam.abbreviation.toUpperCase() === abbr,
  ) ?? null;
}
