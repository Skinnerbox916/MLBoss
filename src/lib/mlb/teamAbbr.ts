/**
 * Single source of truth for team-abbreviation normalization across
 * Yahoo, MLB Stats API, and ESPN.
 *
 * Background: each upstream uses a slightly different abbreviation set
 * for the same franchise. The cross-source matchups happen in three
 * places:
 *   1. FA → probable-starter (Yahoo abbr ↔ MLB abbr) — `display.tsx`
 *      consumes this for the streaming board.
 *   2. Rostered pitcher → probable-starter (Yahoo ↔ MLB) — `probableMatch.ts`.
 *   3. MLB schedule game ↔ ESPN scoreboard event (MLB ↔ ESPN) —
 *      `schedule.ts` for splicing probable-pitcher names onto games.
 *
 * Before this module existed, two duplicate alias tables (`TEAM_ABBR_ALIASES`
 * in `display.tsx` and `SCHEDULE_TEAM_ABBR_ALIASES` in `schedule.ts`)
 * encoded overlapping but slightly different mappings. They drifted —
 * one updated for the AZ/ARI bug, the other not — which is exactly the
 * class of failure that wiped out PIT @ ARI's probable starter on
 * 2026-05-06. Centralizing here removes that drift hazard.
 *
 * **Adding new entries:** include both the variant key AND the canonical
 * key (e.g. `AZ: 'ARI', ARI: 'ARI'`) so `normalizeTeamAbbr` is idempotent
 * and works regardless of which side the input came from.
 */

const ALIASES: Record<string, string> = {
  // Arizona — MLB uses AZ; Yahoo and ESPN use ARI
  AZ: 'ARI',
  ARI: 'ARI',
  // Chicago White Sox
  CHW: 'CWS',
  CWS: 'CWS',
  // Washington
  WAS: 'WSH',
  WSH: 'WSH',
  // Kansas City
  KCR: 'KC',
  KC: 'KC',
  // San Diego
  SDP: 'SD',
  SD: 'SD',
  // San Francisco
  SFG: 'SF',
  SF: 'SF',
  // Tampa Bay
  TBR: 'TB',
  TB: 'TB',
};

/**
 * Collapse any known team-abbreviation variant to its canonical form.
 * Returns the input upper-cased when no alias exists. Idempotent —
 * `normalizeTeamAbbr(normalizeTeamAbbr(x)) === normalizeTeamAbbr(x)`.
 */
export function normalizeTeamAbbr(abbr: string | undefined | null): string {
  const upper = (abbr ?? '').toUpperCase();
  return ALIASES[upper] ?? upper;
}
