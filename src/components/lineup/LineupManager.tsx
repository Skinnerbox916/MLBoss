'use client';

import { useState, useMemo, useCallback } from 'react';
import { useFantasyContext } from '@/lib/hooks/useFantasyContext';
import { useRoster } from '@/lib/hooks/useRoster';
import { useRosterPositions } from '@/lib/hooks/useRosterPositions';
import { useGameDay } from '@/lib/hooks/useGameDay';
import { resolveMatchup, type MatchupContext } from '@/lib/mlb/analysis';
import DatePicker from './DatePicker';
import PositionFilter from './PositionFilter';
import RosterList from './RosterList';
import LineupGrid from './LineupGrid';
import type { LineupMode } from './types';

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface LineupManagerProps {
  mode?: LineupMode;
}

export default function LineupManager({ mode = 'batting' }: LineupManagerProps) {
  const { teamKey, leagueKey, isLoading: ctxLoading, isError: ctxError } = useFantasyContext();
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [selectedPosition, setSelectedPosition] = useState<string | null>(null);

  // Yahoo roster for the selected date
  const { roster, isLoading: rosterLoading, isError: rosterError, mutate: mutateRoster } = useRoster(teamKey, selectedDate);

  // League roster slot template (positions + counts) — drives the LineupGrid.
  const { positions: rosterPositions } = useRosterPositions(leagueKey);

  // MLB schedule for the selected date — one call for the whole page
  const { games, isLoading: gamesLoading, isError: gamesError } = useGameDay(selectedDate);

  // Build a lookup: team abbr → MatchupContext. Memoized so row renders don't rebuild it.
  const matchupIndex = useMemo(() => {
    const map = new Map<string, MatchupContext>();
    for (const game of games) {
      const homeCtx = resolveMatchup(games, game.park, game.homeTeam.abbreviation);
      if (homeCtx) map.set(game.homeTeam.abbreviation.toUpperCase(), homeCtx);
      const awayCtx = resolveMatchup(games, game.park, game.awayTeam.abbreviation);
      if (awayCtx) map.set(game.awayTeam.abbreviation.toUpperCase(), awayCtx);
    }
    return map;
  }, [games]);

  const getMatchupContext = useCallback(
    (teamAbbr: string): MatchupContext | null => {
      return matchupIndex.get(teamAbbr.toUpperCase()) ?? null;
    },
    [matchupIndex],
  );

  const isLoading = ctxLoading || rosterLoading;
  const isError = ctxError || rosterError;

  const title = mode === 'pitching' ? 'Set Your Pitching Staff' : 'Set Your Lineup';
  const subtitle =
    mode === 'pitching'
      ? "Click any pitcher for full splits vs. today's matchup"
      : "Click any player for full splits vs. today's matchup";
  const listHeading = mode === 'pitching' ? 'Pitchers' : 'Batters';
  const gridHeading = mode === 'pitching' ? 'Current Staff' : 'Current Lineup';

  return (
    <div className="p-6 space-y-4">
      {/* Header row: title + date picker */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <DatePicker selected={selectedDate} onSelect={setSelectedDate} />
      </div>

      {/* Position filter */}
      <div className="bg-surface rounded-lg shadow p-4">
        <PositionFilter mode={mode} selected={selectedPosition} onSelect={setSelectedPosition} />
      </div>

      {ctxError ? (
        <div className="bg-surface rounded-lg shadow p-8 text-center">
          <p className="text-sm text-error">Failed to load fantasy context</p>
        </div>
      ) : (
        /* Two-column layout: roster list + lineup grid */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Roster list — takes 2/3 */}
          <div className="lg:col-span-2 bg-surface rounded-lg shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground">
                {selectedPosition ?? 'All'} {listHeading}
              </h2>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {gamesLoading && <span>Loading games...</span>}
                {gamesError && <span className="text-error">Game data unavailable</span>}
                {!isLoading && <span>{roster.length} on roster</span>}
              </div>
            </div>
            <RosterList
              mode={mode}
              roster={roster}
              selectedPosition={selectedPosition}
              isLoading={isLoading}
              isError={isError}
              getMatchupContext={getMatchupContext}
            />
          </div>

          {/* Lineup grid — takes 1/3 */}
          <div className="bg-surface rounded-lg shadow p-4">
            <h2 className="text-sm font-semibold text-foreground mb-3">{gridHeading}</h2>
            <LineupGrid
              mode={mode}
              roster={roster}
              isLoading={isLoading}
              teamKey={teamKey}
              date={selectedDate}
              rosterPositions={rosterPositions}
              onSaved={() => mutateRoster()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
