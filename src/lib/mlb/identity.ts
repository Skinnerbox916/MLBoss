/**
 * Yahoo to MLB identity service.
 *
 * Owns the most fragile boundary in the data layer: turning a Yahoo player
 * row (full name + team abbreviation) into an MLB Stats API `mlbId` plus
 * canonical bio fields (handedness, primary position).
 *
 * Resolution path (24-hour cache at the fetch layer, since MLB IDs never
 * change once issued):
 *   1. /people/search?names={fullName}                returns 1+ candidates
 *   2. Filter to active === true (fall back to all if none active)
 *   3. /people/{id}?hydrate=currentTeam              hydrate every candidate
 *   4. Match `currentTeam.id` against `YAHOO_TO_MLB_ABBR[teamAbbr]`
 *   5. Fall back to the first active candidate if no team match
 *
 * Failures are logged structured so the dev log is greppable:
 *   `[identity] resolve missed: name=… team=… reason=… candidates=N`
 *
 * Aggregate metrics (hits/misses/by-reason) live in process memory and are
 * surfaced via `/admin/debug` — we deliberately don't ship a dedicated
 * admin UI for resolution because the existing debug page is enough.
 */

import { mlbFetchIdentity } from './client';
import type { MLBPlayerIdentity } from './types';

// ---------------------------------------------------------------------------
// Raw response shapes (private to this module)
// ---------------------------------------------------------------------------

interface RawPerson {
  id: number;
  fullName: string;
  currentTeam?: { id?: number; name?: string; abbreviation?: string };
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
    currentTeam?: { id?: number; name?: string; abbreviation?: string };
    active?: boolean;
  }>;
}

interface RawTeamsResponse {
  teams?: Array<{ id: number; abbreviation?: string }>;
}

// ---------------------------------------------------------------------------
// Yahoo-to-MLB abbreviation aliases
// ---------------------------------------------------------------------------

/**
 * Yahoo and MLB Stats API disagree on a handful of franchise abbreviations.
 * Add new entries sparingly — it's almost always cheaper to extend this map
 * than to special-case downstream.
 */
const YAHOO_TO_MLB_ABBR: Record<string, string> = {
  WAS: 'WSH',
  CHW: 'CWS',
};

// ---------------------------------------------------------------------------
// Identity resolution metrics
// ---------------------------------------------------------------------------

export type IdentityResolutionReason =
  | 'hit'
  | 'no-search-results'
  | 'no-active-candidates'
  | 'hydrate-empty'
  | 'team-mismatch-fallback'
  | 'fetch-error';

interface IdentityResolutionMetrics {
  total: number;
  hits: number;
  misses: number;
  byReason: Record<IdentityResolutionReason, number>;
  recentMisses: Array<{
    name: string;
    team: string;
    reason: IdentityResolutionReason;
    candidateCount: number;
    at: number;
  }>;
}

const RECENT_MISS_LIMIT = 50;

const metrics: IdentityResolutionMetrics = {
  total: 0,
  hits: 0,
  misses: 0,
  byReason: {
    hit: 0,
    'no-search-results': 0,
    'no-active-candidates': 0,
    'hydrate-empty': 0,
    'team-mismatch-fallback': 0,
    'fetch-error': 0,
  },
  recentMisses: [],
};

function recordOutcome(opts: {
  name: string;
  team: string;
  reason: IdentityResolutionReason;
  candidateCount: number;
}): void {
  metrics.total += 1;
  metrics.byReason[opts.reason] += 1;

  if (opts.reason === 'hit' || opts.reason === 'team-mismatch-fallback') {
    metrics.hits += 1;
  } else {
    metrics.misses += 1;
    metrics.recentMisses.unshift({
      name: opts.name,
      team: opts.team,
      reason: opts.reason,
      candidateCount: opts.candidateCount,
      at: Date.now(),
    });
    if (metrics.recentMisses.length > RECENT_MISS_LIMIT) {
      metrics.recentMisses.length = RECENT_MISS_LIMIT;
    }
    console.warn(
      `[identity] resolve missed: name="${opts.name}" team="${opts.team}" reason=${opts.reason} candidates=${opts.candidateCount}`,
    );
  }
}

/**
 * Returns a snapshot of the in-process resolution metrics. Surfaced by
 * `/admin/debug`. Process-local; not persisted to Redis.
 */
export function getIdentityResolutionMetrics(): IdentityResolutionMetrics {
  return {
    total: metrics.total,
    hits: metrics.hits,
    misses: metrics.misses,
    byReason: { ...metrics.byReason },
    recentMisses: metrics.recentMisses.slice(),
  };
}

/** Reset the metrics counters. Useful from `/admin/debug` to take a fresh sample. */
export function resetIdentityResolutionMetrics(): void {
  metrics.total = 0;
  metrics.hits = 0;
  metrics.misses = 0;
  for (const k of Object.keys(metrics.byReason) as IdentityResolutionReason[]) {
    metrics.byReason[k] = 0;
  }
  metrics.recentMisses.length = 0;
}

// ---------------------------------------------------------------------------
// Internal fetch helpers (cached 24h via mlbFetchIdentity)
// ---------------------------------------------------------------------------

/**
 * Fetch the full /people/{id} record with currentTeam hydrated.
 *
 * The currentTeam hydrate is critical: without it, the response omits team
 * info entirely, which means same-name players (the two Max Muncys, etc.)
 * collapse to whichever the search returned first.
 */
async function fetchPersonRecord(mlbId: number): Promise<RawPerson | null> {
  const raw = await mlbFetchIdentity<RawPersonResponse>(
    `/people/${mlbId}?hydrate=currentTeam`,
    `person-full:${mlbId}`,
  );
  return raw.people?.[0] ?? null;
}

/**
 * Fetch the canonical full name for an MLB ID. Cached 24h via the underlying
 * person-record fetch. Returns null on miss / fetch error so callers don't
 * have to handle exceptions when they only want the name for display.
 */
export async function fetchPlayerName(mlbId: number): Promise<string | null> {
  try {
    const person = await fetchPersonRecord(mlbId);
    return person?.fullName ?? null;
  } catch {
    return null;
  }
}

/**
 * Load the full MLB team list once (cached 24h) and build an
 * abbreviation -> mlbTeamId map. Needed because `hydrate=currentTeam` omits
 * the abbreviation field — we match same-name players on team id.
 */
async function getTeamAbbrToIdMap(): Promise<Map<string, number>> {
  const raw = await mlbFetchIdentity<RawTeamsResponse>(
    `/teams?sportId=1`,
    `teams:mlb`,
  );
  const map = new Map<string, number>();
  for (const t of raw.teams ?? []) {
    if (t.abbreviation && t.id) map.set(t.abbreviation.toUpperCase(), t.id);
  }
  return map;
}

async function resolveTeamAbbrToId(teamAbbr: string): Promise<number | null> {
  const upper = teamAbbr.toUpperCase();
  const normalized = YAHOO_TO_MLB_ABBR[upper] ?? upper;
  const map = await getTeamAbbrToIdMap();
  return map.get(normalized) ?? null;
}

// ---------------------------------------------------------------------------
// Public API — resolveMLBId
// ---------------------------------------------------------------------------

/**
 * Search for a player by name and resolve to a single MLB identity.
 *
 * Disambiguation order when multiple candidates share a name (e.g. two
 * Max Muncys):
 *   1. Hydrate every active candidate via /people/{id} (cached)
 *   2. Pick the one whose currentTeam matches the supplied teamAbbr
 *   3. If no team match, pick the first active candidate
 *
 * Returns null on any failure; the caller is expected to skip the player
 * but keep processing the rest of the batch. Failures are logged structured
 * via the metrics recorder for observability via `/admin/debug`.
 */
export async function resolveMLBId(
  fullName: string,
  teamAbbr?: string,
): Promise<MLBPlayerIdentity | null> {
  // v2: prior key collapsed same-name players (abbr match was always
  // falsy since currentTeam hydrate omits abbreviation). Bumped to
  // invalidate stale mappings like Yahoo "ATH Muncy" -> LAD Muncy.
  const cacheKey = `resolve-v2:${fullName.toLowerCase().replace(/\s+/g, '-')}:${(teamAbbr ?? '').toLowerCase()}`;
  const teamLabel = teamAbbr ?? '';

  try {
    const encoded = encodeURIComponent(fullName);
    const raw = await mlbFetchIdentity<RawSearchResponse>(
      `/people/search?names=${encoded}&sportIds=1`,
      cacheKey,
    );

    if (!raw.people || raw.people.length === 0) {
      recordOutcome({ name: fullName, team: teamLabel, reason: 'no-search-results', candidateCount: 0 });
      return null;
    }

    const activeCandidates = raw.people.filter(p => p.active !== false);
    const candidates = activeCandidates.length > 0 ? activeCandidates : raw.people;

    if (candidates.length === 0) {
      recordOutcome({ name: fullName, team: teamLabel, reason: 'no-active-candidates', candidateCount: raw.people.length });
      return null;
    }

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
    const people = hydrated.filter((p): p is RawPerson => p !== null);
    if (people.length === 0) {
      recordOutcome({ name: fullName, team: teamLabel, reason: 'hydrate-empty', candidateCount: candidates.length });
      return null;
    }

    let best = people[0];
    let matchedByTeam = false;
    if (teamAbbr) {
      const wantedId = await resolveTeamAbbrToId(teamAbbr);
      if (wantedId !== null) {
        const teamMatch = people.find(p => p.currentTeam?.id === wantedId);
        if (teamMatch) {
          best = teamMatch;
          matchedByTeam = true;
        }
      }
    }

    recordOutcome({
      name: fullName,
      team: teamLabel,
      reason: matchedByTeam || !teamAbbr ? 'hit' : 'team-mismatch-fallback',
      candidateCount: people.length,
    });

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
    recordOutcome({ name: fullName, team: teamLabel, reason: 'fetch-error', candidateCount: 0 });
    console.error(`[identity] resolveMLBId failed for "${fullName}":`, err);
    return null;
  }
}
