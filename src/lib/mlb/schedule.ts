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
  fetchPitcherPlatoonSplits,
  fetchPitcherRecentForm,
  resolveMLBId,
  getPitcherSeasonLines,
} from './players';
import { fetchStatcastPitchers } from './savant';
import { computePitcherTalent } from '../pitching/talent';
import { fetchESPNScoreboard, extractPitchersFromEvent } from '../espn/client';
import { recordPostedLineup } from './lineupSpots';
import type { MLBGame, ProbablePitcher, GameWeather, LineupEntry } from './types';

// ---------------------------------------------------------------------------
// MLB Stats API response shapes (internal — not exported)
// ---------------------------------------------------------------------------

interface RawPitcherStats {
  splits?: Array<{
    stat: {
      era?: string;
      whip?: string;
      wins?: number;
      losses?: number;
      inningsPitched?: string;
      strikeoutsPer9Inn?: string;
      strikeOuts?: number;
      gamesStarted?: number;
      pitchesPerInning?: string;
      baseOnBalls?: number;
      homeRuns?: number;
      hits?: number;
      atBats?: number;
      groundOuts?: number;
      airOuts?: number;
    };
  }>;
}

interface RawPitcher {
  id: number;
  fullName: string;
  pitchHand?: { code: string };
  stats?: RawPitcherStats[];
}

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
    home: { team: RawTeam; probablePitcher?: RawPitcher };
    away: { team: RawTeam; probablePitcher?: RawPitcher };
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

function parseFloat2(val: string | undefined): number | null {
  if (!val) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

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

function parsePitcherStats(stat: NonNullable<RawPitcherStats['splits']>[number]['stat']) {
  const ip = parseFloat2(stat.inningsPitched) ?? 0;
  const gs = stat.gamesStarted ?? null;
  const bb = stat.baseOnBalls ?? 0;
  const hr = stat.homeRuns ?? 0;
  const hitsAllowed = stat.hits ?? 0;
  const abAgainst = stat.atBats ?? 0;
  const go = stat.groundOuts ?? 0;
  const ao = stat.airOuts ?? 0;
  return {
    era: parseFloat2(stat.era),
    whip: parseFloat2(stat.whip),
    wins: stat.wins ?? 0,
    losses: stat.losses ?? 0,
    inningsPitched: ip,
    strikeoutsPer9: parseFloat2(stat.strikeoutsPer9Inn),
    strikeOuts: stat.strikeOuts ?? null,
    gamesStarted: gs,
    pitchesPerInning: parseFloat2(stat.pitchesPerInning),
    inningsPerStart: gs && gs > 0 ? Math.round((ip / gs) * 100) / 100 : null,
    bb9: ip > 0 ? Math.round((bb / ip * 9) * 100) / 100 : null,
    hr9: ip > 0 ? Math.round((hr / ip * 9) * 100) / 100 : null,
    battingAvgAgainst: abAgainst > 0 ? Math.round((hitsAllowed / abAgainst) * 1000) / 1000 : null,
    gbRate: (go + ao) > 0 ? Math.round((go / (go + ao)) * 1000) / 1000 : null,
  };
}

function parsePitcher(raw: RawPitcher | undefined): ProbablePitcher | null {
  if (!raw) return null;

  let stats = {
    era: null as number | null,
    whip: null as number | null,
    wins: 0,
    losses: 0,
    inningsPitched: 0,
    strikeoutsPer9: null as number | null,
    strikeOuts: null as number | null,
    gamesStarted: null as number | null,
    pitchesPerInning: null as number | null,
    inningsPerStart: null as number | null,
    bb9: null as number | null,
    hr9: null as number | null,
    battingAvgAgainst: null as number | null,
    gbRate: null as number | null,
  };

  if (raw.stats && raw.stats.length > 0) {
    const splits = raw.stats[0]?.splits;
    if (splits && splits.length > 0) {
      stats = parsePitcherStats(splits[0].stat);
    }
  }

  const throws = (raw.pitchHand?.code ?? 'R') as 'L' | 'R' | 'S';

  return {
    mlbId: raw.id,
    name: raw.fullName,
    throws,
    ...stats,
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
    homeProbablePitcher: parsePitcher(raw.teams.home.probablePitcher),
    awayProbablePitcher: parsePitcher(raw.teams.away.probablePitcher),
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
// ESPN pitcher-name lookup (single source of truth for probable-pitcher names)
//
// MLB's /schedule endpoint only fills `probablePitcher` for games ~2-3 days
// out. ESPN publishes them for the full week. To avoid having a fast lane
// (today) and a slow lane (later in the week) with subtly different data,
// we drop MLB's pitcher hydrate entirely and source every probable-pitcher
// name from ESPN. Names are then resolved to MLB IDs via `resolveMLBId`,
// after which the standard enrichment pipeline (line + Savant + platoon +
// recent form + talent) runs unchanged.
// ---------------------------------------------------------------------------

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
    const key = `${(home.team.abbreviation || '').toUpperCase()}|${(away.team.abbreviation || '').toUpperCase()}`;
    map.set(key, { home: homeName, away: awayName });
  }
  return map;
}

/**
 * Build a stub `ProbablePitcher` from a name. `mlbId: 0` is the sentinel
 * that tells `enrichPitcher` to do an identity lookup before running the
 * stats pipeline. Throws side defaults to 'R' and is overwritten by the
 * stats-line application once we have real data.
 */
function stubPitcher(name: string): ProbablePitcher {
  return {
    mlbId: 0,
    name,
    throws: 'R',
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
 * canonical stamp point for `pp.talent` per `docs/pitcher-evaluation.md`.
 */
export async function getGameDay(date: string): Promise<MLBGame[]> {
  // No probablePitcher hydrate — ESPN owns that field. We keep venue,
  // weather, team, and lineups (all MLB-only).
  const hydrate = ['venue', 'weather', 'team', 'lineups'].join(',');
  const path = `/schedule?sportId=1&date=${date}&hydrate=${encodeURIComponent(hydrate)}`;

  // Fetch MLB schedule + ESPN scoreboard + slate-wide context in parallel.
  // ESPN is the source of truth for who's pitching; MLB owns the game shell.
  const currentYear = new Date().getFullYear();
  const [raw, espn, savantMap, priorSavantMap, teamEraMap] = await Promise.all([
    mlbFetchSchedule<RawScheduleResponse>(path, date),
    fetchESPNScoreboard(date, date).catch(err => {
      console.error('ESPN scoreboard fetch failed; pitcher names will be missing:', err);
      return { events: [] };
    }),
    fetchStatcastPitchers(currentYear),
    fetchStatcastPitchers(currentYear - 1),
    fetchTeamStaffEra(),
  ]);

  const dateEntry = raw.dates?.[0];
  if (!dateEntry) return [];

  const games = dateEntry.games.map(parseGame);

  // Splice ESPN pitcher names onto each MLB game by matching home|away
  // team abbreviation. Replaces whatever MLB returned (which is now empty
  // anyway since we dropped the probablePitcher hydrate) with the ESPN
  // name, ensuring full-week coverage.
  const espnByMatchup = indexEspnPitchers(espn);
  for (const game of games) {
    const key = `${game.homeTeam.abbreviation.toUpperCase()}|${game.awayTeam.abbreviation.toUpperCase()}`;
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
    }

    const [line, platoon, recentForm, seasonLines] = await Promise.all([
      fetchPitcherFullLine(p.mlbId),
      fetchPitcherPlatoonSplits(p.mlbId),
      fetchPitcherRecentForm(p.mlbId),
      getPitcherSeasonLines(p.mlbId),
    ]);
    applyPitcherStatsLine(p, line);
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

  // Attach team staff ERA for the opposing-staff pill (today batting),
  // batter rating's bullpen modifier, and forecast.ts ownStaffEra reads.
  for (const game of games) {
    game.homeTeam.staffEra = teamEraMap.get(game.homeTeam.mlbId);
    game.awayTeam.staffEra = teamEraMap.get(game.awayTeam.mlbId);
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
