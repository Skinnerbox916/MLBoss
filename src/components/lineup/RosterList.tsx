'use client';

import { useMemo } from 'react';
import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import type { BatterSeasonStats } from '@/lib/mlb/types';
import { type MatchupContext, getBatterContextScore } from '@/lib/mlb/analysis';
import PlayerRow from './PlayerRow';
import { type LineupMode, getRowStatus, isPitcher } from './types';

function filterByMode(players: RosterEntry[], mode: LineupMode): RosterEntry[] {
  return mode === 'pitching' ? players.filter(isPitcher) : players.filter(p => !isPitcher(p));
}

function filterByPosition(players: RosterEntry[], position: string | null): RosterEntry[] {
  if (!position) return players;
  if (position === 'BN') return players.filter(p => p.selected_position === 'BN');
  if (position === 'IL') return players.filter(p => p.selected_position === 'IL' || p.selected_position === 'IL+' || p.selected_position === 'NA');
  if (position === 'UTIL') return players.filter(p => p.selected_position === 'BN' || p.selected_position.toUpperCase() === 'UTIL');
  return players.filter(p => p.eligible_positions.includes(position));
}

// ---------------------------------------------------------------------------
// Roster list
// ---------------------------------------------------------------------------

interface RosterListProps {
  mode: LineupMode;
  roster: RosterEntry[];
  selectedPosition: string | null;
  isLoading: boolean;
  isError: boolean;
  getMatchupContext: (teamAbbr: string) => MatchupContext | null;
  /** xwOBA-backed OPS equivalent when Savant data is available; raw OPS otherwise */
  getPlayerTalentOPS: (name: string, team: string) => number | null;
  /** Full stats record (OPS + xwOBA + wOBA) for display in PlayerRow */
  getPlayerStats: (name: string, team: string) => BatterSeasonStats | null;
}

/**
 * Combine talent baseline with matchup context into a single sortable score.
 * Talent gets 65% weight — studs stay near the top but a great matchup can
 * meaningfully reorder bench decisions.
 *
 * talentOPS is xwOBA-scaled when Savant data is available, raw OPS otherwise.
 * Normalised: .600 → 0.0, .900 → 1.0 (clamped).
 */
function compositeSort(talentOPS: number | null, contextScore: number): number {
  const TALENT_W = 0.65;
  const CONTEXT_W = 0.35;
  const talentVal = talentOPS !== null
    ? Math.max(0, Math.min(1, (talentOPS - 0.600) / 0.300))
    : 0.4;
  return TALENT_W * talentVal + CONTEXT_W * contextScore;
}

export default function RosterList({
  mode,
  roster,
  selectedPosition,
  isLoading,
  isError,
  getMatchupContext,
  getPlayerTalentOPS,
  getPlayerStats,
}: RosterListProps) {
  const { sorted, noGameCount } = useMemo(() => {
    const scoped = filterByMode(roster, mode);
    const filtered = filterByPosition(scoped, selectedPosition);

    // Hide non-actionable players: injured (always) and no-game (when not
    // explicitly filtering to IL/BN). The IL filter intentionally shows
    // injured players so you can review who's stashed.
    const showingIL = selectedPosition === 'IL';
    const withGame: RosterEntry[] = [];
    let _noGameCount = 0;
    for (const p of filtered) {
      const status = getRowStatus(p);
      if (status === 'injured' && !showingIL) {
        _noGameCount++;
        continue;
      }
      if (!getMatchupContext(p.editorial_team_abbr) && !showingIL) {
        _noGameCount++;
        continue;
      }
      withGame.push(p);
    }

    // Sort by talent-weighted composite — best expected value first.
    const _sorted = withGame.slice().sort((a, b) => {
      const scoreA = compositeSort(
        getPlayerTalentOPS(a.name, a.editorial_team_abbr),
        getBatterContextScore(getMatchupContext(a.editorial_team_abbr)),
      );
      const scoreB = compositeSort(
        getPlayerTalentOPS(b.name, b.editorial_team_abbr),
        getBatterContextScore(getMatchupContext(b.editorial_team_abbr)),
      );
      return scoreB - scoreA;
    });

    return { sorted: _sorted, noGameCount: _noGameCount };
  }, [roster, mode, selectedPosition, getMatchupContext, getPlayerTalentOPS]);

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

  if (sorted.length === 0) {
    const scoped = filterByMode(roster, mode);
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        {scoped.length === 0
          ? mode === 'pitching'
            ? 'No pitchers on roster'
            : 'No batters on roster'
          : noGameCount > 0
            ? 'No players with games today for this position'
            : 'No players for this position'}
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
          seasonStats={getPlayerStats(player.name, player.editorial_team_abbr)}
        />
      ))}
      {noGameCount > 0 && (
        <p className="text-xs text-muted-foreground text-center pt-2">
          {noGameCount} player{noGameCount !== 1 ? 's' : ''} not shown (no game today)
        </p>
      )}
    </div>
  );
}
