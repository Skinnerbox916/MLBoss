import { mlbFetchSchedule, mlbFetchTeamStats } from './client';
import { getParkByVenueId } from './parks';
import { getPitcherQuality, fetchPitcherFullLine, fetchPitcherPlatoonSplits, fetchPitcherRecentForm } from './players';
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

  // Fetch Savant + team ERA once up front so enrichPitcher can reference
  // the same cached maps without triggering repeated fetches
  const [savantMap, teamEraMap] = await Promise.all([
    fetchStatcastPitchers(),
    fetchTeamStaffEra(),
  ]);

  // Enrich probable pitchers with tiered quality, extended stats, and xERA.
  // (parallel, cached at the underlying fetch layer). Falls back to prior
  // season when current IP is too thin — important in early April.
  //
  // `line` is always fetched (not gated on missing era) because the schedule's
  // inline pitcher stats are aggregate (starts + relief), which inflates
  // IP/GS and skews ERA/WHIP for swingmen. The `line` version is sp-only —
  // prefer it over any inline schedule values.
  const enrichPitcher = async (p: ProbablePitcher) => {
    const [quality, line, platoon, recentForm] = await Promise.all([
      getPitcherQuality(p.mlbId),
      fetchPitcherFullLine(p.mlbId),
      fetchPitcherPlatoonSplits(p.mlbId),
      fetchPitcherRecentForm(p.mlbId),
    ]);
    p.quality = quality;
    if (line) {
      p.era = line.era ?? p.era;
      p.whip = line.whip ?? p.whip;
      p.wins = line.wins || p.wins;
      p.losses = line.losses || p.losses;
      p.inningsPitched = line.ip || p.inningsPitched;
      p.strikeoutsPer9 = line.strikeoutsPer9 ?? p.strikeoutsPer9;
      p.strikeOuts = line.strikeOuts ?? p.strikeOuts;
      p.gamesStarted = line.gamesStarted ?? p.gamesStarted;
      p.pitchesPerInning = line.pitchesPerInning ?? p.pitchesPerInning;
      p.inningsPerStart = line.inningsPerStart ?? p.inningsPerStart;
      p.bb9 = line.bb9 ?? p.bb9;
      p.gbRate = line.gbRate ?? p.gbRate;
    }
    // Attach Savant data (null when pitcher has too few BIP)
    const savant = savantMap.get(p.mlbId);
    p.xera = (savant && savant.bip >= 10) ? savant.xera : null;
    p.xwoba = (savant && savant.bip >= 10) ? savant.xwoba : null;
    // Platoon splits
    p.platoonOpsVsLeft = platoon?.vsLeft?.ops ?? null;
    p.platoonOpsVsRight = platoon?.vsRight?.ops ?? null;
    // Recent form (last 3 starts)
    p.recentFormEra = recentForm?.era ?? null;
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
