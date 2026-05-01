'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import type { RosterPositionSlot } from '@/lib/hooks/useRosterPositions';
import { optimizeLineup } from '@/lib/lineup/optimize';
import type { LineupMode } from './types';

function isPitcher(p: RosterEntry): boolean {
  return (
    p.eligible_positions.includes('P') ||
    p.eligible_positions.includes('SP') ||
    p.eligible_positions.includes('RP') ||
    p.display_position === 'SP' ||
    p.display_position === 'RP' ||
    p.display_position === 'P'
  );
}

// ---------------------------------------------------------------------------
// Slot definitions — built from the league's roster_positions at runtime.
// Fallback template used only until the league settings fetch resolves.
// ---------------------------------------------------------------------------

const FALLBACK_POSITIONS: RosterPositionSlot[] = [
  { position: 'C', count: 1, position_type: 'B' },
  { position: '1B', count: 1, position_type: 'B' },
  { position: '2B', count: 1, position_type: 'B' },
  { position: '3B', count: 1, position_type: 'B' },
  { position: 'SS', count: 1, position_type: 'B' },
  { position: 'OF', count: 3, position_type: 'B' },
  { position: 'Util', count: 1, position_type: 'B' },
  { position: 'SP', count: 2, position_type: 'P' },
  { position: 'RP', count: 2, position_type: 'P' },
  { position: 'P', count: 2, position_type: 'P' },
  { position: 'BN', count: 3 },
  { position: 'IL', count: 1 },
  { position: 'IL+', count: 1 },
];

const RESERVE_POSITIONS = new Set(['BN', 'IL', 'IL+', 'NA']);

interface SlotDisplay {
  position: string;
  label: string;
  group: 'batting' | 'pitching' | 'reserve';
}

function groupFor(p: RosterPositionSlot): SlotDisplay['group'] {
  if (RESERVE_POSITIONS.has(p.position)) return 'reserve';
  if (p.position_type === 'P') return 'pitching';
  if (p.position_type === 'B') return 'batting';
  // Unknown position types — guess from the position name.
  if (['SP', 'RP', 'P'].includes(p.position)) return 'pitching';
  return 'batting';
}

function buildSlots(mode: LineupMode, template: RosterPositionSlot[]): SlotDisplay[] {
  const slots: SlotDisplay[] = [];
  for (const entry of template) {
    const group = groupFor(entry);
    // In batting mode, skip pitching slots (and vice versa). Reserve slots
    // always appear so BN/IL moves are possible.
    if (mode === 'batting' && group === 'pitching') continue;
    if (mode === 'pitching' && group === 'batting') continue;
    for (let i = 0; i < entry.count; i++) {
      slots.push({ position: entry.position, label: entry.position, group });
    }
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Slot row
// ---------------------------------------------------------------------------

interface SlotRowProps {
  slot: SlotDisplay;
  player?: RosterEntry;
  isSelected: boolean;
  isEligible: boolean;
  editable: boolean;
  locked: boolean;
  onClick: () => void;
}

function SlotRow({ slot, player, isSelected, isEligible, editable, locked, onClick }: SlotRowProps) {
  const isEmpty = !player;
  const isInjured = player?.on_disabled_list || (player?.status && (player.status.includes('IL') || player.status === 'DL'));
  const isReserve = slot.group === 'reserve';

  let bgClass: string;
  if (isSelected) {
    bgClass = 'border-accent ring-2 ring-accent/40 bg-accent/5';
  } else if (locked) {
    bgClass = 'border-border-muted bg-border-muted/20';
  } else if (editable && isEligible) {
    bgClass = 'border-accent/40 bg-accent/5';
  } else if (isEmpty) {
    bgClass = 'border-dashed border-border-muted';
  } else if (isInjured && !isReserve) {
    bgClass = 'border-error/30 bg-error/5';
  } else {
    bgClass = 'border-border';
  }

  const cursorClass = locked
    ? 'cursor-not-allowed'
    : editable
      ? 'cursor-pointer hover:border-accent/60'
      : '';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={locked}
      className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${bgClass} ${cursorClass} ${locked ? 'opacity-70' : ''}`}
    >
      <span className={`w-8 text-xs font-bold shrink-0 ${
        slot.group === 'batting' ? 'text-success' :
        slot.group === 'pitching' ? 'text-accent' :
        'text-muted-foreground'
      }`}>
        {slot.label}
      </span>
      {player ? (
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground truncate block">
            {player.name}
            {locked && <span className="ml-1.5 text-caption uppercase tracking-wide text-muted-foreground">locked</span>}
          </span>
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
    </button>
  );
}

// ---------------------------------------------------------------------------
// Slot assignment — produces one display row per slot from the roster's
// current `selected_position` values, including locally pending overrides.
// ---------------------------------------------------------------------------

interface DisplaySlot {
  slot: SlotDisplay;
  player?: RosterEntry;
}

function assignPlayersToSlots(
  slots: SlotDisplay[],
  roster: RosterEntry[],
  mode: LineupMode,
  overrides: Map<string, string>,
): DisplaySlot[] {
  const currentPos = (p: RosterEntry) => overrides.get(p.player_key) ?? p.selected_position;

  // Bucket players by (resolved) position, filtered to the active mode.
  const pool = new Map<string, RosterEntry[]>();
  for (const player of roster) {
    const pitcher = isPitcher(player);
    if (mode === 'pitching' && !pitcher) continue;
    if (mode === 'batting' && pitcher) continue;
    const pos = currentPos(player);
    const list = pool.get(pos) ?? [];
    list.push(player);
    pool.set(pos, list);
  }

  // Walk the slot template in order and pop one player per slot.
  const consumed = new Map<string, number>();
  return slots.map(slot => {
    const list = pool.get(slot.position);
    if (!list) return { slot };
    const idx = consumed.get(slot.position) ?? 0;
    if (idx >= list.length) return { slot };
    consumed.set(slot.position, idx + 1);
    return { slot, player: list[idx] };
  });
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

interface LineupGridProps {
  mode: LineupMode;
  roster: RosterEntry[];
  isLoading: boolean;
  teamKey?: string;
  date: string;
  rosterPositions?: RosterPositionSlot[];
  onSaved?: () => void;
  getPlayerScore?: (player: RosterEntry) => number;
}

export default function LineupGrid({
  mode,
  roster,
  isLoading,
  teamKey,
  date,
  rosterPositions,
  onSaved,
  getPlayerScore,
}: LineupGridProps) {
  const slots = useMemo(
    () => buildSlots(mode, rosterPositions && rosterPositions.length > 0 ? rosterPositions : FALLBACK_POSITIONS),
    [mode, rosterPositions],
  );

  // Local position overrides (player_key → new position). Empty = unchanged.
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset local edits when the roster identity changes (date switch or SWR revalidate).
  useEffect(() => {
    setOverrides(new Map());
    setSelectedKey(null);
    setError(null);
  }, [roster, date, teamKey]);

  const displaySlots = useMemo(
    () => assignPlayersToSlots(slots, roster, mode, overrides),
    [slots, roster, mode, overrides],
  );

  const selectedPlayer = selectedKey ? roster.find(p => p.player_key === selectedKey) : undefined;
  const dirty = overrides.size > 0;

  const slotIsEligible = useCallback(
    (slot: SlotDisplay): boolean => {
      if (!selectedPlayer) return false;
      // Reserve slots are always legal targets for any player of the matching mode.
      if (slot.group === 'reserve') return true;
      return selectedPlayer.eligible_positions.includes(slot.position);
    },
    [selectedPlayer],
  );

  const handleClick = useCallback(
    (displaySlot: DisplaySlot) => {
      if (!teamKey) return; // can't edit without a team context
      const { slot, player } = displaySlot;

      // Locked players can't be touched (source or target).
      if (player && player.is_editable === false) return;

      // No selection yet — clicking a player selects them.
      if (!selectedKey) {
        if (player) setSelectedKey(player.player_key);
        return;
      }

      // Clicking the already-selected player deselects.
      if (player && player.player_key === selectedKey) {
        setSelectedKey(null);
        return;
      }

      // A player is selected — this click is placing them into `slot`.
      if (!slotIsEligible(slot)) return;

      const moving = roster.find(p => p.player_key === selectedKey);
      if (!moving) return;

      // If the target slot holds another player, swap positions; otherwise
      // just move the selected player into the slot. The displaced player
      // inherits the selected player's previous position — unless they aren't
      // eligible for it, in which case they go to BN.
      const movingPrev = overrides.get(moving.player_key) ?? moving.selected_position;

      setOverrides(prev => {
        const next = new Map(prev);
        next.set(moving.player_key, slot.position);
        if (player && player.player_key !== moving.player_key) {
          const displacedEligible =
            RESERVE_POSITIONS.has(movingPrev) ||
            player.eligible_positions.includes(movingPrev);
          next.set(player.player_key, displacedEligible ? movingPrev : 'BN');
        }
        // Clean up no-op overrides so `dirty` stays accurate.
        for (const [k, v] of next.entries()) {
          const original = roster.find(r => r.player_key === k)?.selected_position;
          if (original === v) next.delete(k);
        }
        return next;
      });
      setSelectedKey(null);
    },
    [selectedKey, roster, overrides, slotIsEligible, teamKey],
  );

  const handleReset = useCallback(() => {
    setOverrides(new Map());
    setSelectedKey(null);
    setError(null);
  }, []);

  const handleOptimize = useCallback(() => {
    if (!getPlayerScore || mode !== 'batting') return;
    const slotDefs = slots.map(s => ({ position: s.position, group: s.group }));
    const newOverrides = optimizeLineup(slotDefs, roster, getPlayerScore);
    if (newOverrides.size > 0) {
      setOverrides(newOverrides);
      setSelectedKey(null);
      setError(null);
    }
  }, [getPlayerScore, mode, slots, roster]);

  const handleSave = useCallback(async () => {
    if (!teamKey || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      // Yahoo requires the FULL roster in one PUT. Send every rostered player
      // with their resolved position (original or overridden).
      const players = roster.map(p => ({
        player_key: p.player_key,
        position: overrides.get(p.player_key) ?? p.selected_position,
      }));
      const res = await fetch('/api/fantasy/lineup', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamKey, date, players }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setOverrides(new Map());
      setSelectedKey(null);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save lineup');
    } finally {
      setSaving(false);
    }
  }, [teamKey, dirty, roster, overrides, date, onSaved]);

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

  const groups =
    mode === 'pitching'
      ? [
          { label: 'Pitching', group: 'pitching' as const },
          { label: 'Reserve', group: 'reserve' as const },
        ]
      : [
          { label: 'Batting', group: 'batting' as const },
          { label: 'Reserve', group: 'reserve' as const },
        ];

  const editable = !!teamKey;

  return (
    <div className="space-y-4">
      {editable && (
        <p className="text-xs text-muted-foreground">
          {selectedPlayer
            ? `Click a highlighted slot to move ${selectedPlayer.name}`
            : 'Click a player to move them'}
        </p>
      )}

      {groups.map(({ label, group }) => {
        const groupSlots = displaySlots.filter(d => d.slot.group === group);
        if (groupSlots.length === 0) return null;
        return (
          <div key={group}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{label}</p>
            <div className="space-y-1">
              {groupSlots.map((ds, i) => {
                const isSelected = !!ds.player && ds.player.player_key === selectedKey;
                const isEligible = slotIsEligible(ds.slot);
                const locked = !!ds.player && ds.player.is_editable === false;
                return (
                  <SlotRow
                    key={`${ds.slot.position}-${i}`}
                    slot={ds.slot}
                    player={ds.player}
                    isSelected={isSelected}
                    isEligible={isEligible}
                    editable={editable}
                    locked={locked}
                    onClick={() => handleClick(ds)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {editable && (
        <div className="pt-2 border-t border-border-muted space-y-2">
          {error && <p className="text-xs text-error">{error}</p>}
          {mode === 'batting' && getPlayerScore && (
            <button
              type="button"
              onClick={handleOptimize}
              disabled={saving}
              className="w-full px-3 py-2 rounded-lg text-sm font-semibold bg-success/90 text-white hover:bg-success transition-colors disabled:bg-border-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
            >
              Optimize Lineup
            </button>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold bg-accent text-white disabled:bg-border-muted disabled:text-muted-foreground disabled:cursor-not-allowed hover:bg-accent/90 transition-colors"
            >
              {saving ? 'Saving…' : dirty ? 'Save Lineup' : 'No changes'}
            </button>
            {dirty && !saving && (
              <button
                type="button"
                onClick={handleReset}
                className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground border border-border-muted hover:border-border transition-colors"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
