import { mlbFetchSchedule } from './client';
import { getParkByVenueId } from './parks';
import { getPitcherQuality } from './players';
import type { MLBGame, ProbablePitcher, GameWeather } from './types';

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
  temperature?: string;
  condition?: string;
  wind?: string;
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

function parsePitcher(raw: RawPitcher | undefined): ProbablePitcher | null {
  if (!raw) return null;

  // Pull season stats from the first stats group if present
  let era: number | null = null;
  let whip: number | null = null;
  let wins = 0;
  let losses = 0;
  let ip = 0;

  if (raw.stats && raw.stats.length > 0) {
    const splits = raw.stats[0]?.splits;
    if (splits && splits.length > 0) {
      const s = splits[0].stat;
      era = parseFloat2(s.era);
      whip = parseFloat2(s.whip);
      wins = s.wins ?? 0;
      losses = s.losses ?? 0;
      ip = parseFloat2(s.inningsPitched) ?? 0;
    }
  }

  const throws = (raw.pitchHand?.code ?? 'R') as 'L' | 'R' | 'S';

  return {
    mlbId: raw.id,
    name: raw.fullName,
    throws,
    era,
    whip,
    wins,
    losses,
    eraLast30: null, // requires a separate splits call; populated lazily if needed
    inningsPitched: ip,
    quality: null, // enriched after parseGame in getGameDay
  };
}

function parseWeather(raw: RawWeather | undefined): GameWeather {
  if (!raw) return { temperature: null, condition: null, wind: null, windSpeed: null, windDirection: null };
  const { speed, direction } = parseWind(raw.wind);
  return {
    temperature: raw.temperature ? parseInt(raw.temperature, 10) : null,
    condition: raw.condition ?? null,
    wind: raw.wind ?? null,
    windSpeed: speed,
    windDirection: direction,
  };
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
  };
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
  ].join(',');

  const path = `/schedule?sportId=1&date=${date}&hydrate=${encodeURIComponent(hydrate)}`;

  const raw = await mlbFetchSchedule<RawScheduleResponse>(path, date);

  const dateEntry = raw.dates?.[0];
  if (!dateEntry) return [];

  const games = dateEntry.games.map(parseGame);

  // Enrich probable pitchers with tiered quality (parallel, cached at the
  // underlying fetch layer). Falls back to prior season when current IP is
  // too thin to classify — important in early April.
  await Promise.all(
    games.flatMap(game => {
      const jobs: Promise<void>[] = [];
      if (game.homeProbablePitcher) {
        const p = game.homeProbablePitcher;
        jobs.push(
          getPitcherQuality(p.mlbId).then(q => {
            p.quality = q;
          }),
        );
      }
      if (game.awayProbablePitcher) {
        const p = game.awayProbablePitcher;
        jobs.push(
          getPitcherQuality(p.mlbId).then(q => {
            p.quality = q;
          }),
        );
      }
      return jobs;
    }),
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
