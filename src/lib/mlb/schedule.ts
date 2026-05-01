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
  getPitcherQuality,
} from './players';
import { fetchStatcastPitchers } from './savant';
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
    quality: null,
    xera: null,
    xwoba: null,
    avgFastballVelo: null,
    avgFastballVeloPrior: null,
    runValuePer100: null,
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Get all MLB games for a given date (YYYY-MM-DD).
 * Returns games enriched with probable pitchers, venue, and weather.
 * Cached 5 minutes — probable pitchers are confirmed ~2–3 hours before game time.
 */
export async function getGameDay(date: string): Promise<MLBGame[]> {
  const hydrate = [
    'probablePitcher(note,stats(type=season,group=pitching))',
    'venue',
    'weather',
    'team',
    'lineups',
  ].join(',');

  const path = `/schedule?sportId=1&date=${date}&hydrate=${encodeURIComponent(hydrate)}`;

  const raw = await mlbFetchSchedule<RawScheduleResponse>(path, date);

  const dateEntry = raw.dates?.[0];
  if (!dateEntry) return [];

  const games = dateEntry.games.map(parseGame);

  // Fetch Savant (current + prior season) + team ERA once up front. Prior
  // season is blended with current season via sample-weighted averaging —
  // see `blendRateOrNull` calls in `model/pitcherEnrichment.ts`. Fetching
  // both years unconditionally is cheap because both CSVs are cached 24h
  // at the fetch layer.
  const currentYear = new Date().getFullYear();
  const [savantMap, priorSavantMap, teamEraMap] = await Promise.all([
    fetchStatcastPitchers(currentYear),
    fetchStatcastPitchers(currentYear - 1),
    fetchTeamStaffEra(),
  ]);

  // Enrich probable pitchers with tiered quality, extended stats, and Savant
  // signals. Per-pitcher fetches run in parallel — the actual modeling
  // happens in pure functions (`apply*` helpers from ./model). The line
  // fetch is unconditional because the schedule's inline pitcher stats
  // aggregate starts + relief, inflating IP/GS for swingmen. The
  // `fetchPitcherFullLine` value is starter-only, so we always prefer it.
  const enrichPitcher = async (p: ProbablePitcher) => {
    const [quality, line, platoon, recentForm] = await Promise.all([
      getPitcherQuality(p.mlbId),
      fetchPitcherFullLine(p.mlbId),
      fetchPitcherPlatoonSplits(p.mlbId),
      fetchPitcherRecentForm(p.mlbId),
    ]);
    p.quality = quality;
    applyPitcherStatsLine(p, line);
    applySavantSignals(p, savantMap.get(p.mlbId), priorSavantMap.get(p.mlbId));
    applyPitcherPlatoon(p, platoon);
    applyPitcherRecentForm(p, recentForm);
  };

  // Enrich all pitchers in parallel now that shared maps are ready
  await Promise.all(
    games.flatMap(game => {
      const jobs: Promise<void>[] = [];
      if (game.homeProbablePitcher) jobs.push(enrichPitcher(game.homeProbablePitcher));
      if (game.awayProbablePitcher) jobs.push(enrichPitcher(game.awayProbablePitcher));
      return jobs;
    }),
  );

  // Attach team staff ERA to each game's team objects
  for (const game of games) {
    game.homeTeam.staffEra = teamEraMap.get(game.homeTeam.mlbId);
    game.awayTeam.staffEra = teamEraMap.get(game.awayTeam.mlbId);
  }

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
