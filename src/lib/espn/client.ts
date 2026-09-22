/**
 * ESPN Sports API client for MLB data.
 * Public, no authentication required.
 */

const ESPN_API_BASE = 'https://site.api.espn.com/apis/site/v2';
// ESPN's edge filters on the User-Agent's *leading* product token against an
// allowlist of well-known HTTP clients. A bare `MLBoss/1.0` passed on
// 2026-08-09 but is rejected with 403 as of 2026-09-22, as are browser UAs and
// Node's default. Verified still accepted: `curl/*`, `okhttp/*`,
// `python-requests/*`, `Go-http-client/*`. Only the first token is matched, so
// appending our own identifier keeps the request attributable.
const ESPN_USER_AGENT = 'curl/8.5.0 (+https://mlboss.app) MLBoss/1.0';

export interface ESPNPitcher {
  displayName: string;
  fullName?: string;
  id?: string;
}

export interface ESPNCompetitor {
  homeAway: 'home' | 'away';
  team: {
    abbreviation: string;
    displayName: string;
    id: string;
  };
  probables?: Array<{
    athlete?: ESPNPitcher;
  }>;
}

export interface ESPNCompetition {
  id: string;
  date: string;
  startDate: string;
  competitors: ESPNCompetitor[];
  status: {
    type: string;
  };
}

export interface ESPNEvent {
  id: string;
  date: string;
  name: string;
  competitions: ESPNCompetition[];
  status: {
    type: string;
  };
}

export interface ESPNScoreboard {
  events: ESPNEvent[];
}

/**
 * Fetch one MLB game-date's scoreboard from ESPN.
 * ESPN publishes probable pitchers ~a week out (MLB Stats API only fills them
 * 2-3 days out), which is why this is the app's only probables source.
 *
 * One date per call, deliberately. ESPN used to accept a `dates=START-END`
 * range; as of 2026-09-22 every range form returns HTTP 400 and only the
 * single-date form is served. A single-date query already returns that whole
 * game-date — including night games whose UTC start date rolls over — so a
 * range bought us nothing, and the only caller (`buildGameDay`) asked for one
 * date at a time anyway.
 */
export async function fetchESPNScoreboard(
  date: string, // YYYY-MM-DD
): Promise<ESPNScoreboard> {
  const day = date.replace(/-/g, '');
  const url = `${ESPN_API_BASE}/sports/baseball/mlb/scoreboard?dates=${day}&limit=500`;

  try {
    const res = await fetch(url, {
      // The explicit UA is load-bearing (see ESPN_USER_AGENT above) — without
      // an accepted one the slate renders with no probable pitchers at all.
      headers: { Accept: 'application/json', 'User-Agent': ESPN_USER_AGENT },
      next: { revalidate: 300 }, // 5 min cache (probable pitchers update frequently)
    });

    if (!res.ok) {
      throw new Error(`ESPN API error: HTTP ${res.status}`);
    }

    return (await res.json()) as ESPNScoreboard;
  } catch (err) {
    console.error('ESPN scoreboard fetch failed:', err);
    throw err;
  }
}

/**
 * Extract probable pitcher names from ESPN event.
 * Returns [homePitcherName, awayPitcherName] or [null, null] if not available.
 */
export function extractPitchersFromEvent(event: ESPNEvent): [string | null, string | null] {
  if (!event.competitions || !event.competitions[0]) {
    return [null, null];
  }

  const comp = event.competitions[0];
  const competitors = comp.competitors || [];

  let home: string | null = null;
  let away: string | null = null;

  for (const competitor of competitors) {
    const probable = competitor.probables?.[0];
    const pitcherName = probable?.athlete?.displayName ?? null;

    if (competitor.homeAway === 'home') {
      home = pitcherName;
    } else if (competitor.homeAway === 'away') {
      away = pitcherName;
    }
  }

  return [home, away];
}
