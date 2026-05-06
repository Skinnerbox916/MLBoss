'use client';

import { useCallback, useMemo, useState } from 'react';
import MatchupPulse from '@/components/shared/MatchupPulse';
import CategoryFocusBar from '@/components/shared/CategoryFocusBar';
import Tabs from '@/components/ui/Tabs';
import { Heading } from '@/components/typography';
import { useFantasyContext } from '@/lib/hooks/useFantasyContext';
import { useGameDay } from '@/lib/hooks/useGameDay';
import { useAvailablePitchers } from '@/lib/hooks/useAvailablePitchers';
import { useAvailableBatters } from '@/lib/hooks/useAvailableBatters';
import { useRoster } from '@/lib/hooks/useRoster';
import { useRosterPositions } from '@/lib/hooks/useRosterPositions';
import { useTeamOffense } from '@/lib/hooks/useTeamOffense';
import { useLeagueCategories } from '@/lib/hooks/useLeagueCategories';
import { useMatchupAnalysis } from '@/lib/hooks/useMatchupAnalysis';
import { useCorrectedMatchupAnalysis } from '@/lib/hooks/useCorrectedMatchupAnalysis';
import { useSuggestedFocus } from '@/lib/hooks/useSuggestedFocus';
import { useWeekBatterScores } from '@/lib/hooks/useWeekBatterScores';
import { useSlotAwareStreaming } from '@/lib/hooks/useSlotAwareStreaming';
import { dayOffsetStr } from '@/lib/pitching/display';
import type { FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';
import DateStrip from './DateStrip';
import StreamingBoard from './StreamingBoard';
import BatterStreamingBoard from './BatterStreamingBoard';
import StrategySummary from './StrategySummary';

type StreamTab = 'pitchers' | 'batters';

const OWNERSHIP_FLOOR = 5;

function isStashableIL(p: { on_disabled_list?: boolean; status?: string }): boolean {
  if (p.on_disabled_list) return true;
  if (!p.status) return false;
  return /^IL\d*$/i.test(p.status) || p.status.toUpperCase() === 'DL';
}

function faShouldShow(p: FreeAgentPlayer): boolean {
  if (isStashableIL(p)) return true;
  return (p.percent_owned ?? 0) >= OWNERSHIP_FLOOR;
}

/**
 * Streaming page. Two tabs:
 *   - Pitchers — multi-day probable starts, ranked by daily streaming score
 *   - Batters  — rest-of-week batter pickups, ranked by projected weekly
 *                contribution against a corrected matchup margin (YTD +
 *                forward batter-team projection)
 *
 * The two tabs answer different questions on different time horizons. They
 * share the focus-bar UI but maintain independent focus maps because the
 * pitcher tab's chase/punt suggestions come from `analyzeMatchup` (live
 * scoreboard) while the batter tab's come from `useCorrectedMatchupAnalysis`
 * (live scoreboard + forward projection — see plan doc).
 */
export default function StreamingManager() {
  const { leagueKey, teamKey, isLoading: ctxLoading, isError: ctxError } = useFantasyContext();
  const [tab, setTab] = useState<StreamTab>('pitchers');

  // ----- Shared inputs (used by either tab) -----------------------------
  const { categories: leagueCategories } = useLeagueCategories(leagueKey);

  // ----- Pitcher tab inputs --------------------------------------------
  const [pitcherOffset, setPitcherOffset] = useState(1);
  const pitcherDate = dayOffsetStr(pitcherOffset);
  const { games: pitcherGames, isLoading: pitcherGamesLoading } = useGameDay(pitcherDate);
  const { players: pitcherFAs, isLoading: pitcherFaLoading, isError: pitcherFaError } = useAvailablePitchers(leagueKey);
  const pitcherOpposingTeamIds = useMemo(() => {
    const ids = new Set<number>();
    for (const g of pitcherGames) {
      ids.add(g.homeTeam.mlbId);
      ids.add(g.awayTeam.mlbId);
    }
    return Array.from(ids);
  }, [pitcherGames]);
  const { teams: teamOffense, isLoading: offenseLoading } = useTeamOffense(pitcherOpposingTeamIds);

  const scoredPitcherCategories = useMemo(
    () => leagueCategories.filter(c => c.is_pitcher_stat),
    [leagueCategories],
  );
  const { analysis: pitcherMatchupAnalysis } = useMatchupAnalysis(leagueKey, teamKey);
  const pitcherStatIds = useMemo(() => {
    const set = new Set<number>();
    for (const c of scoredPitcherCategories) set.add(c.stat_id);
    return set;
  }, [scoredPitcherCategories]);
  const pitcherPredicate = useCallback((statId: number) => pitcherStatIds.has(statId), [pitcherStatIds]);
  const {
    focusMap: pitcherFocusMap,
    suggestedFocusMap: pitcherSuggestedFocusMap,
    toggle: togglePitcherFocus,
    reset: resetPitcherFocus,
    hasOverrides: pitcherFocusOverrides,
  } = useSuggestedFocus(pitcherMatchupAnalysis, pitcherPredicate);

  // ----- Batter tab inputs ---------------------------------------------
  const { batters: batterFAs, isLoading: batterFaLoading } = useAvailableBatters(leagueKey, true);
  const { roster: myRoster } = useRoster(teamKey);
  const { positions: leaguePositions } = useRosterPositions(leagueKey);
  const scoredBatterCategories = useMemo(
    () => leagueCategories.filter(c => c.is_batter_stat),
    [leagueCategories],
  );
  const {
    analysis: batterMatchupAnalysis,
    isCorrected,
    isLoading: batterMatchupLoading,
    myProjection,
  } = useCorrectedMatchupAnalysis(leagueKey, teamKey);
  const batterStatIds = useMemo(() => {
    const set = new Set<number>();
    for (const c of scoredBatterCategories) set.add(c.stat_id);
    return set;
  }, [scoredBatterCategories]);
  const batterPredicate = useCallback((statId: number) => batterStatIds.has(statId), [batterStatIds]);
  const {
    focusMap: batterFocusMap,
    suggestedFocusMap: batterSuggestedFocusMap,
    toggle: toggleBatterFocus,
    reset: resetBatterFocus,
    hasOverrides: batterFocusOverrides,
  } = useSuggestedFocus(batterMatchupAnalysis, batterPredicate);

  // FA filter: 5% ownership floor, IL bypass. Lifted out of
  // BatterStreamingBoard so the same filtered list feeds both the FA
  // scoring pipeline and the slot-aware engine.
  const filteredBatterFAs = useMemo(
    () => batterFAs.filter(faShouldShow),
    [batterFAs],
  );

  // Per-FA week scoring (PA-weighted ratings, focus-honored). Lifted up
  // here so its output also feeds the slot-aware engine alongside being
  // rendered in BatterStreamingBoard.
  const { scored: batterFAScores, days: batterDays, isLoading: batterScoresLoading } =
    useWeekBatterScores(filteredBatterFAs, scoredBatterCategories, batterFocusMap);

  const remainingDays = useMemo(
    () => batterDays.filter(d => d.isRemaining),
    [batterDays],
  );

  // Slot-aware streaming value: per-day assignStarters with and without
  // each FA. Captures position competition, multi-step rebalancing, and
  // light-day open slots in one number.
  const slotAware = useSlotAwareStreaming(
    batterFAScores,
    myProjection,
    myRoster,
    leaguePositions,
    remainingDays,
  );

  const pitcherHelper =
    pitcherOffset >= 4
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
          <Heading as="h1">Streaming</Heading>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pick up free agents for favourable matchups. Spend your 6-moves-per-week budget wisely.
          </p>
        </div>
      </div>

      <Tabs<StreamTab>
        variant="segment"
        ariaLabel="Streaming tab"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'pitchers', label: 'Pitchers' },
          { id: 'batters', label: 'Batters' },
        ]}
      />

      {tab === 'pitchers' ? (
        <>
          <DateStrip selectedOffset={pitcherOffset} onSelect={setPitcherOffset} />

          {scoredPitcherCategories.length > 0 && (
            <CategoryFocusBar
              categories={scoredPitcherCategories}
              focusMap={pitcherFocusMap}
              onToggle={togglePitcherFocus}
              title="Pitching Focus"
              helper="Suggested by MLBoss · click to override"
              onReset={resetPitcherFocus}
              hasOverrides={pitcherFocusOverrides}
              suggestedFocusMap={pitcherSuggestedFocusMap}
            />
          )}

          <MatchupPulse leagueKey={leagueKey} teamKey={teamKey} side="pitching" />

          <StreamingBoard
            date={pitcherDate}
            games={pitcherGames}
            freeAgents={pitcherFAs}
            gamesLoading={pitcherGamesLoading}
            faLoading={ctxLoading || pitcherFaLoading}
            faError={pitcherFaError}
            teamOffense={teamOffense}
            offenseLoading={offenseLoading}
            helper={pitcherHelper}
            scoredPitcherCategories={scoredPitcherCategories}
            focusMap={pitcherFocusMap}
          />
        </>
      ) : (
        <>
          <StrategySummary
            analysis={batterMatchupAnalysis}
            isCorrected={isCorrected}
            isLoading={batterMatchupLoading}
            dailyBaselines={slotAware.dailyBaselines}
          />

          {scoredBatterCategories.length > 0 && (
            <CategoryFocusBar
              categories={scoredBatterCategories}
              focusMap={batterFocusMap}
              onToggle={toggleBatterFocus}
              title="Batting Focus"
              helper="Suggested by MLBoss (corrected margin) · click to override"
              onReset={resetBatterFocus}
              hasOverrides={batterFocusOverrides}
              suggestedFocusMap={batterSuggestedFocusMap}
            />
          )}

          <MatchupPulse leagueKey={leagueKey} teamKey={teamKey} side="batting" />

          <BatterStreamingBoard
            faScores={batterFAScores}
            slotAwareValues={slotAware.byPlayerKey}
            days={remainingDays}
            focusMap={batterFocusMap}
            faLoading={ctxLoading || batterFaLoading || batterScoresLoading}
          />
        </>
      )}
    </div>
  );
}
