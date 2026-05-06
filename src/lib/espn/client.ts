/**
 * ESPN Sports API client for MLB data.
 * Public, no authentication required.
 */

const ESPN_API_BASE = 'https://site.api.espn.com/apis/site/v2';

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
 * Fetch MLB games for a date range from ESPN.
 * ESPN provides probable pitcher data for the full week (unlike MLB Stats API).
 */
export async function fetchESPNScoreboard(
  startDate: string, // YYYY-MM-DD
  endDate: string,   // YYYY-MM-DD
): Promise<ESPNScoreboard> {
  const start = startDate.replace(/-/g, '');
  const end = endDate.replace(/-/g, '');
  const url = `${ESPN_API_BASE}/sports/baseball/mlb/scoreboard?dates=${start}-${end}&limit=500`;

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
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
