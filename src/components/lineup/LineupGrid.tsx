'use client';

import type { RosterEntry } from '@/lib/yahoo-fantasy-api';

// ---------------------------------------------------------------------------
// Slot definitions — standard Yahoo H2H lineup
// ---------------------------------------------------------------------------

const BATTING_SLOTS = ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'UTIL'];
const PITCHING_SLOTS = ['SP', 'SP', 'RP', 'RP', 'P', 'P'];
const RESERVE_SLOTS = ['BN', 'BN', 'BN', 'IL', 'IL+'];

interface SlotDisplay {
  position: string;
  label: string;
  group: 'batting' | 'pitching' | 'reserve';
}

function buildSlots(): SlotDisplay[] {
  return [
    ...BATTING_SLOTS.map(p => ({ position: p, label: p, group: 'batting' as const })),
    ...PITCHING_SLOTS.map(p => ({ position: p, label: p, group: 'pitching' as const })),
    ...RESERVE_SLOTS.map(p => ({ position: p, label: p === 'IL+' ? 'IL+' : p, group: 'reserve' as const })),
  ];
}

// ---------------------------------------------------------------------------
// Match roster entries to slots
// ---------------------------------------------------------------------------

function assignPlayersToSlots(roster: RosterEntry[]): Map<string, RosterEntry[]> {
  const slotMap = new Map<string, RosterEntry[]>();
  for (const player of roster) {
    const pos = player.selected_position;
    const list = slotMap.get(pos) ?? [];
    list.push(player);
    slotMap.set(pos, list);
  }
  return slotMap;
}

// ---------------------------------------------------------------------------
// Slot row
// ---------------------------------------------------------------------------

function SlotRow({ slot, player }: { slot: SlotDisplay; player?: RosterEntry }) {
  const isEmpty = !player;
  const isInjured = player?.on_disabled_list || (player?.status && (player.status.includes('IL') || player.status === 'DL'));
  const isReserve = slot.group === 'reserve';

  const bgClass = isEmpty
    ? 'border-dashed border-border-muted'
    : isInjured && !isReserve
      ? 'border-error/30 bg-error/5'
      : 'border-border';

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${bgClass}`}>
      <span className={`w-8 text-xs font-bold shrink-0 ${
        slot.group === 'batting' ? 'text-success' :
        slot.group === 'pitching' ? 'text-accent' :
        'text-muted-foreground'
      }`}>
        {slot.label}
      </span>
      {player ? (
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground truncate block">{player.name}</span>
          <span className="text-xs text-muted-foreground">
            {player.editorial_team_abbr} — {player.display_position}
            {player.status && (
              <span className={`ml-1 ${isInjured ? 'text-error' : 'text-accent'}`}>({player.status})</span>
            )}
          </span>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground italic">Empty</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

interface LineupGridProps {
  roster: RosterEntry[];
  isLoading: boolean;
}

export default function LineupGrid({ roster, isLoading }: LineupGridProps) {
  const slots = buildSlots();
  const slotMap = assignPlayersToSlots(roster);

  // For each slot definition, pop a player from the matching pool
  const consumed = new Map<string, number>();
  function nextPlayer(position: string): RosterEntry | undefined {
    const list = slotMap.get(position);
    if (!list) return undefined;
    const idx = consumed.get(position) ?? 0;
    if (idx >= list.length) return undefined;
    consumed.set(position, idx + 1);
    return list[idx];
  }

  if (isLoading) {
    return (
      <div className="space-y-1.5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="animate-pulse flex items-center gap-2 px-3 py-2 border border-border-muted rounded-lg">
            <div className="w-8 h-4 bg-border-muted rounded" />
            <div className="flex-1 space-y-1">
              <div className="h-3.5 bg-border-muted rounded w-28" />
              <div className="h-2.5 bg-border-muted rounded w-20" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const groups = [
    { label: 'Batting', group: 'batting' as const },
    { label: 'Pitching', group: 'pitching' as const },
    { label: 'Reserve', group: 'reserve' as const },
  ];

  return (
    <div className="space-y-4">
      {groups.map(({ label, group }) => {
        const groupSlots = slots.filter(s => s.group === group);
        if (groupSlots.length === 0) return null;
        return (
          <div key={group}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{label}</p>
            <div className="space-y-1">
              {groupSlots.map((slot, i) => (
                <SlotRow key={`${slot.position}-${i}`} slot={slot} player={nextPlayer(slot.position)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
