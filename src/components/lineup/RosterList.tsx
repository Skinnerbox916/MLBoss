'use client';

import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import type { MatchupContext } from '@/lib/mlb/analysis';
import PlayerRow from './PlayerRow';

// ---------------------------------------------------------------------------
// Filter + sort helpers
// ---------------------------------------------------------------------------

type RowStatus = 'starter' | 'bench' | 'injured';

function getRowStatus(player: RosterEntry): RowStatus {
  if (player.on_disabled_list || player.status === 'IL' || player.status === 'IL10' || player.status === 'IL60' || player.status === 'DL' || player.status === 'NA') {
    return 'injured';
  }
  if (player.selected_position === 'BN') return 'bench';
  if (player.selected_position === 'IL' || player.selected_position === 'IL+' || player.selected_position === 'NA') return 'injured';
  return 'starter';
}

const STATUS_ORDER: Record<RowStatus, number> = { starter: 0, bench: 1, injured: 2 };

function sortRoster(players: RosterEntry[]): RosterEntry[] {
  return players.slice().sort((a, b) => STATUS_ORDER[getRowStatus(a)] - STATUS_ORDER[getRowStatus(b)]);
}

function isPitcher(p: RosterEntry): boolean {
  return p.display_position === 'SP' || p.display_position === 'RP' || p.display_position === 'P';
}

function filterByPosition(players: RosterEntry[], position: string | null): RosterEntry[] {
  if (!position) return players;
  if (position === 'BN') return players.filter(p => p.selected_position === 'BN');
  if (position === 'IL') return players.filter(p => p.selected_position === 'IL' || p.selected_position === 'IL+' || p.selected_position === 'NA');
  if (position === 'UTIL') return players.filter(p => !isPitcher(p));
  return players.filter(p => p.eligible_positions.includes(position));
}

// ---------------------------------------------------------------------------
// Roster list
// ---------------------------------------------------------------------------

interface RosterListProps {
  roster: RosterEntry[];
  selectedPosition: string | null;
  isLoading: boolean;
  isError: boolean;
  getMatchupContext: (teamAbbr: string) => MatchupContext | null;
}

export default function RosterList({
  roster,
  selectedPosition,
  isLoading,
  isError,
  getMatchupContext,
}: RosterListProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="animate-pulse flex items-center gap-3 px-3 py-2">
            <div className="w-9 h-9 rounded-full bg-border-muted" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 bg-border-muted rounded w-32" />
              <div className="h-2.5 bg-border-muted rounded w-48" />
            </div>
            <div className="h-5 w-8 bg-border-muted rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-error py-4 text-center">Failed to load roster</p>;
  }

  const filtered = filterByPosition(roster, selectedPosition);
  const sorted = sortRoster(filtered);

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        {roster.length === 0 ? 'No roster data available' : 'No players for this position'}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {sorted.map(player => (
        <PlayerRow
          key={player.player_key}
          player={player}
          context={getMatchupContext(player.editorial_team_abbr)}
        />
      ))}
    </div>
  );
}
