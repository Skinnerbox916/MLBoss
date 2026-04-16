import type { RosterEntry } from '@/lib/yahoo-fantasy-api';

// ---------------------------------------------------------------------------
// Hungarian algorithm (Kuhn–Munkres) for minimum-cost assignment.
// Operates on an n×n square cost matrix and returns optimal column assignment
// for each row. Adapted for lineup optimization where n is tiny (≤15).
// ---------------------------------------------------------------------------

function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const INF = 1e18;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1);   // p[j] = row assigned to col j
  const way = new Int32Array(n + 1);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(INF);
    const used = new Uint8Array(n + 1);

    do {
      used[j0] = 1;
      let i0 = p[j0];
      let delta = INF;
      let j1 = -1;

      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }

      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }

      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  // p[j] = row assigned to col j → invert to row→col
  const result = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) {
    if (p[j] !== 0) result[p[j] - 1] = j - 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Lineup optimizer
// ---------------------------------------------------------------------------

interface SlotDef {
  position: string;
  group: 'batting' | 'pitching' | 'reserve';
}

interface PlayerScore {
  player: RosterEntry;
  score: number;
}

const RESERVE_POSITIONS = new Set(['BN', 'IL', 'IL+', 'NA']);
const BIG_COST = 1e9;

export function optimizeLineup(
  activeSlots: SlotDef[],
  roster: RosterEntry[],
  getScore: (player: RosterEntry) => number,
): Map<string, string> {
  const batters = roster.filter(p => !isPitcherEntry(p));

  // Separate into three groups:
  // - pinned: locked or injured players that can't be moved (stay in place)
  // - benched: sitting players (NS) that should be moved to BN, freeing their slot
  // - movable: everyone else, eligible for optimal assignment
  const pinned: RosterEntry[] = [];
  const benched: RosterEntry[] = [];
  const movable: PlayerScore[] = [];
  for (const p of batters) {
    if (!p.is_editable || isInjured(p)) {
      pinned.push(p);
    } else if (p.starting_status === 'NS') {
      benched.push(p);
    } else {
      movable.push({ player: p, score: getScore(p) });
    }
  }

  // Active lineup slots (non-reserve batting slots).
  const startingSlots = activeSlots.filter(s => s.group === 'batting');

  // Remove slots consumed by pinned (locked/injured) players only.
  // Benched (NS) players free their slots for reassignment.
  const availableSlots: SlotDef[] = [];
  const lockedSlotCounts = new Map<string, number>();
  for (const p of pinned) {
    const pos = p.selected_position;
    if (!RESERVE_POSITIONS.has(pos)) {
      lockedSlotCounts.set(pos, (lockedSlotCounts.get(pos) ?? 0) + 1);
    }
  }
  const consumedCounts = new Map<string, number>();
  for (const slot of startingSlots) {
    const consumed = consumedCounts.get(slot.position) ?? 0;
    const lockedCount = lockedSlotCounts.get(slot.position) ?? 0;
    if (consumed < lockedCount) {
      consumedCounts.set(slot.position, consumed + 1);
    } else {
      availableSlots.push(slot);
    }
  }

  const nSlots = availableSlots.length;
  const nPlayers = movable.length;

  if (nSlots === 0 || nPlayers === 0) return new Map();

  // Build cost matrix: n×n square (pad with dummy rows/cols).
  // Rows = slots, Cols = players. We maximize score, so cost = -score.
  const n = Math.max(nSlots, nPlayers);
  const costMatrix: number[][] = Array.from({ length: n }, () =>
    new Array<number>(n).fill(BIG_COST),
  );

  for (let si = 0; si < nSlots; si++) {
    const slot = availableSlots[si];
    for (let pi = 0; pi < nPlayers; pi++) {
      const { player, score } = movable[pi];
      const eligible =
        player.eligible_positions.includes(slot.position) ||
        slot.position === 'Util';
      if (eligible) {
        costMatrix[si][pi] = -score;
      }
    }
  }

  // Dummy rows/cols keep BIG_COST → unassigned players go to bench.

  const assignment = hungarian(costMatrix);

  // Build overrides map.
  const overrides = new Map<string, string>();
  const assignedPlayerIndices = new Set<number>();

  for (let si = 0; si < nSlots; si++) {
    const pi = assignment[si];
    if (pi < nPlayers && costMatrix[si][pi] < BIG_COST) {
      const { player } = movable[pi];
      assignedPlayerIndices.add(pi);
      if (player.selected_position !== availableSlots[si].position) {
        overrides.set(player.player_key, availableSlots[si].position);
      }
    }
  }

  // Unassigned movable players → BN.
  for (let pi = 0; pi < nPlayers; pi++) {
    if (!assignedPlayerIndices.has(pi)) {
      const { player } = movable[pi];
      if (player.selected_position !== 'BN' && !RESERVE_POSITIONS.has(player.selected_position)) {
        overrides.set(player.player_key, 'BN');
      }
    }
  }

  // Sitting players (NS) → BN.
  for (const p of benched) {
    if (p.selected_position !== 'BN' && !RESERVE_POSITIONS.has(p.selected_position)) {
      overrides.set(p.player_key, 'BN');
    }
  }

  // Clean up no-op overrides.
  for (const [key, pos] of overrides.entries()) {
    const original = roster.find(r => r.player_key === key)?.selected_position;
    if (original === pos) overrides.delete(key);
  }

  return overrides;
}

function isInjured(p: RosterEntry): boolean {
  if (p.on_disabled_list) return true;
  if (p.status === 'IL' || p.status === 'IL10' || p.status === 'IL60' || p.status === 'DL' || p.status === 'NA') return true;
  if (p.selected_position === 'IL' || p.selected_position === 'IL+' || p.selected_position === 'NA') return true;
  return false;
}

function isPitcherEntry(p: RosterEntry): boolean {
  return (
    p.eligible_positions.includes('P') ||
    p.eligible_positions.includes('SP') ||
    p.eligible_positions.includes('RP') ||
    p.display_position === 'SP' ||
    p.display_position === 'RP' ||
    p.display_position === 'P'
  );
}
