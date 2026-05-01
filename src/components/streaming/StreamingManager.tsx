'use client';

import { useCallback, useMemo, useState } from 'react';
import MatchupPulse from '@/components/shared/MatchupPulse';
import CategoryFocusBar from '@/components/shared/CategoryFocusBar';
import { useFantasyContext } from '@/lib/hooks/useFantasyContext';
import { useGameDay } from '@/lib/hooks/useGameDay';
import { useAvailablePitchers } from '@/lib/hooks/useAvailablePitchers';
import { useTeamOffense } from '@/lib/hooks/useTeamOffense';
import { useLeagueCategories } from '@/lib/hooks/useLeagueCategories';
import { useMatchupAnalysis } from '@/lib/hooks/useMatchupAnalysis';
import { useSuggestedFocus } from '@/lib/hooks/useSuggestedFocus';
import { dayOffsetStr } from '@/lib/pitching/display';
import DateStrip from './DateStrip';
import StreamingBoard from './StreamingBoard';

/**
 * Pitcher streaming page. Separate from `/lineup` ("Today") because picking
 * up a streamer is a fundamentally different decision from sitting/starting
 * someone you already roster — different data, different time horizon,
 * different weekly-budget constraints (6 moves/wk).
 *
 * Key extension over the old Pitching page: multi-day probable pitchers.
 * Yahoo only publishes tomorrow; MLB's schedule endpoint has D+2 through
 * ~D+5 so the user can plan pickups in advance against their move budget.
 */
export default function StreamingManager() {
  const { leagueKey, teamKey, isLoading: ctxLoading, isError: ctxError } = useFantasyContext();
  const [offset, setOffset] = useState(1);

  const date = dayOffsetStr(offset);
  const { games, isLoading: gamesLoading } = useGameDay(date);
  const { players: freeAgents, isLoading: faLoading, isError: faError } = useAvailablePitchers(leagueKey);

  const opposingTeamIds = useMemo(() => {
    const ids = new Set<number>();
    for (const g of games) {
      ids.add(g.homeTeam.mlbId);
      ids.add(g.awayTeam.mlbId);
    }
    return Array.from(ids);
  }, [games]);

  const { teams: teamOffense, isLoading: offenseLoading } = useTeamOffense(opposingTeamIds);

  // League scoring categories → drive both the CategoryFocusBar and the
  // per-category pitcher rating. We only care about pitcher-side cats
  // on this page (a batter AVG category doesn't move a streaming SP's
  // stock).
  const { categories: leagueCategories } = useLeagueCategories(leagueKey);
  const scoredPitcherCategories = useMemo(
    () => leagueCategories.filter(c => c.is_pitcher_stat),
    [leagueCategories],
  );

  // Focus suggestions sourced from the matchup analysis engine — pitcher
  // categories that are still contested get `chase`, locked ones get
  // `punt`, the rest stay `neutral`. The user can override per-pill and
  // reset back to suggestions at any time. See `docs/recommendation-system.md`.
  const { analysis: matchupAnalysis } = useMatchupAnalysis(leagueKey, teamKey);

  const pitcherStatIds = useMemo(() => {
    const set = new Set<number>();
    for (const c of scoredPitcherCategories) set.add(c.stat_id);
    return set;
  }, [scoredPitcherCategories]);
  const pitcherPredicate = useCallback((statId: number) => pitcherStatIds.has(statId), [pitcherStatIds]);

  const {
    focusMap,
    suggestedFocusMap,
    toggle: toggleFocus,
    reset: resetFocus,
    hasOverrides: hasFocusOverrides,
  } = useSuggestedFocus(matchupAnalysis, pitcherPredicate);

  const helper =
    offset >= 4
      ? 'MLB confirms probable pitchers roughly 3 days out — later dates may be incomplete.'
      : undefined;

  if (ctxError) {
    return (
      <div className="p-6">
        <div className="bg-surface rounded-lg shadow p-8 text-center">
          <p className="text-sm text-error">Failed to load fantasy context</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Streaming</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pick up free-agent starters for favourable matchups. Spend your 6-moves-per-week budget wisely.
          </p>
        </div>
      </div>

      <DateStrip selectedOffset={offset} onSelect={setOffset} />

      {scoredPitcherCategories.length > 0 && (
        <CategoryFocusBar
          categories={scoredPitcherCategories}
          focusMap={focusMap}
          onToggle={toggleFocus}
          title="Pitching Focus"
          helper="Suggested by MLBoss · click to override"
          onReset={resetFocus}
          hasOverrides={hasFocusOverrides}
          suggestedFocusMap={suggestedFocusMap}
        />
      )}

      <MatchupPulse leagueKey={leagueKey} teamKey={teamKey} side="pitching" />

      <StreamingBoard
        date={date}
        games={games}
        freeAgents={freeAgents}
        gamesLoading={gamesLoading}
        faLoading={ctxLoading || faLoading}
        faError={faError}
        teamOffense={teamOffense}
        offenseLoading={offenseLoading}
        helper={helper}
        scoredPitcherCategories={scoredPitcherCategories}
        focusMap={focusMap}
      />
    </div>
  );
}
