/**
 * Player-pool policy — the canonical "active add vs. IL stash" split.
 *
 * Every surface that shops the free-agent pool (categories roster tabs,
 * points roster boards, points week-moves batter plugs, move/swap
 * engines, replacement-level calcs) answers the same question: is this
 * player someone you could start this week, or an injured-list stash?
 * The rubric lives here and ONLY here — see
 * docs/roster-strategy.md#active-vs-stash-the-fa-pool-split.
 *
 * Rubric: a real Injured List stint (IL10/IL15/IL60, legacy DL, or
 * Yahoo's `on_disabled_list` flag) makes a player a stash — he's coming
 * back after a defined recovery period but can't be started now. NA
 * (minor-league assignments, opt-outs), SUSP, and DTD (day-to-day,
 * playing through it) are deliberately NOT stash statuses: those players
 * stay in the active pool and earn their slot through score/ownership.
 */

export interface PoolPlayerStatus {
  on_disabled_list?: boolean;
  status?: string;
}

/** IL/DL with optional stint length: IL, IL10, IL15, IL60, DL, DL10, DL60. */
const IL_STATUS_RE = /^(IL|DL)\d*$/i;

/** True when the player is on a real IL stint (see module rubric). */
export function isStashableIL(p: PoolPlayerStatus): boolean {
  if (p.on_disabled_list) return true;
  return !!p.status && IL_STATUS_RE.test(p.status);
}

/**
 * True when the player can't be written into an active lineup at all:
 * a real IL stint or NA (minor-league assignment / opt-out). This is the
 * lineup-side question ("can he start?"), a superset of the stash
 * question — NA players are unavailable but NOT stash-worthy. DTD and
 * SUSP players remain startable in Yahoo and are excluded here.
 */
export function hasUnavailableStatus(p: PoolPlayerStatus): boolean {
  return isStashableIL(p) || p.status?.toUpperCase() === 'NA';
}

/**
 * Healthy free agents below this ownership level are filtered from
 * upgrade/streaming boards and optimizer FA pools — the league's
 * collective drop is a stronger signal than any per-PA rate.
 */
export const FA_OWNERSHIP_FLOOR = 5;

/**
 * The standard FA display filter: IL players bypass the ownership floor
 * (a dropped IL stud is exactly the stash play worth surfacing);
 * everyone else must clear it.
 */
export function faShouldShow(p: PoolPlayerStatus & { percent_owned?: number }): boolean {
  if (isStashableIL(p)) return true;
  return (p.percent_owned ?? 0) >= FA_OWNERSHIP_FLOOR;
}

/**
 * Split a free-agent pool into startable adds and IL stashes. Use this
 * (rather than ad-hoc filters) so the two lists stay complementary —
 * every surface that shows an "upgrade" list next to a "stash" list gets
 * the same partition.
 */
export function splitFAPool<T extends PoolPlayerStatus>(
  pool: T[],
): { active: T[]; stash: T[] } {
  const active: T[] = [];
  const stash: T[] = [];
  for (const p of pool) (isStashableIL(p) ? stash : active).push(p);
  return { active, stash };
}
