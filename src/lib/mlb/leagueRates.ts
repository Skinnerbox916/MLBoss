/**
 * Module-local cache for league-mean rates derived at game-day-fetch
 * time. The writer is `getGameDay` in [schedule.ts](./schedule.ts) (which
 * has access to the live MLB Stats API response); the readers are
 * pure-function rating modules like [batterForecast.ts](./batterForecast.ts)
 * that must remain client-safe.
 *
 * This module exists ONLY to break the import cycle between Node-only
 * data fetchers (schedule.ts pulls Redis through lineupSpots → cache)
 * and pure-function rating engines that get bundled to the client via
 * lineup / dashboard components. Keep it Node-and-client-safe: no I/O,
 * no Redis, no fs, no fetch.
 */

/** Fallback when the team staff-splits fetch fails or returns empty.
 *  ~2024-2025 MLB league rate. See docs/league-baselines.md. */
export const LEAGUE_SB_ALLOWED_PER_IP_FALLBACK = 0.075;

let lastLeagueSbAllowedPerIp = LEAGUE_SB_ALLOWED_PER_IP_FALLBACK;

export function setLeagueSbAllowedPerIp(rate: number): void {
  if (rate > 0 && Number.isFinite(rate)) lastLeagueSbAllowedPerIp = rate;
}

export function getLeagueSbAllowedPerIp(): number {
  return lastLeagueSbAllowedPerIp;
}
