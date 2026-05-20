'use client';

import { useCallback, useMemo, useState } from 'react';
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
import { useCorrectedMatchupAnalysis } from '@/lib/hooks/useCorrectedMatchupAnalysis';
import { useScoreboard } from '@/lib/hooks/useScoreboard';
import { useSuggestedFocus } from '@/lib/hooks/useSuggestedFocus';
import { useWeekBatterScores } from '@/lib/hooks/useWeekBatterScores';
import { useWeekPitcherScores } from '@/lib/hooks/useWeekPitcherScores';
import { useSlotAwareStreaming } from '@/lib/hooks/useSlotAwareStreaming';
import { useLeagueLimits } from '@/lib/hooks/useLeagueLimits';
import { getStreamingGridDays, isSundayPivot } from '@/lib/dashboard/weekRange';
import type { WeekTarget } from '@/lib/dashboard/weekRange';
import type { FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';
import StreamingBoard from './StreamingBoard';
import BatterStreamingBoard from './BatterStreamingBoard';
import VolumeGap from './VolumeGap';
import GamePlanPanel from '@/components/shared/GamePlanPanel';

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
 *                contribution against a corrected matchup margin (MTD
 *                scoreboard + forward batter-team projection)
 *
 * The two tabs answer different questions on different time horizons. They
 * share the focus-bar UI but maintain independent focus maps because the
 * pitcher tab's chase/punt suggestions come from `analyzeMatchup` (live
 * scoreboard) while the batter tab's come from `useCorrectedMatchupAnalysis`
 * (live scoreboard + forward projection — see plan doc).
 *
 * On Sunday the entire upper UI flips to `targetWeek: 'next'` (see
 * `isSundayPivot`). The current matchup is effectively closed for
 * streaming — any pickup lands on next week's roster — so the chase/hold/
 * punt, volume-gap, and opponent surfaces describe next week. Date strip
 * and per-FA scores already aim at next Mon-Sun via `getStreamingGridDays`.
 */
export default function StreamingManager() {
  const { leagueKey, teamKey, isLoading: ctxLoading, isError: ctxError } = useFantasyContext();
  const [tab, setTab] = useState<StreamTab>('pitchers');

  // The Sunday rule lives in `weekRange.ts`. We resolve it once here and
  // thread `targetWeek` through every downstream consumer; the panels
  // own their own week-aware copy (chip, title, helper text).
  const targetWeek: WeekTarget = useMemo(() => isSundayPivot() ? 'next' : 'current', []);

  // ----- Shared inputs (used by either tab) -----------------------------
  const { categories: leagueCategories } = useLeagueCategories(leagueKey);
  const { limits } = useLeagueLimits(leagueKey);

  // Single corrected matchup analysis powers both tabs (batter + pitcher
  // counting cats). Two consumers, one fetch — SWR de-dupes. The hook
  // also resolves the matched opponent on the targeted week so we don't
  // duplicate the scoreboard read here.
  const {
    analysis: matchupAnalysis,
    isCorrected,
    isLoading: matchupLoading,
    myProjection,
    myPitcherProjection,
    oppPitcherProjection,
    opponentName,
  } = useCorrectedMatchupAnalysis(leagueKey, teamKey, { targetWeek });

  // MTD stat maps for the volume-gap panel. In current mode these come
  // from the scoreboard (same source BossCard reads). In pivot mode the
  // next-week matchup hasn't started, so empty maps make the volume gap
  // table show pure-projection totals — the same shape correctedRows
  // gives the chase/hold/punt tiles.
  const { matchups: currentMatchups } = useScoreboard(targetWeek === 'current' ? leagueKey : undefined);
  const { myStatsMap, oppStatsMap } = useMemo(() => {
    if (targetWeek === 'next') {
      return { myStatsMap: new Map<number, string>(), oppStatsMap: new Map<number, string>() };
    }
    const userMatchup = teamKey ? currentMatchups.find(m => m.teams.some(t => t.team_key === teamKey)) : undefined;
    const userTeam = userMatchup?.teams.find(t => t.team_key === teamKey);
    const opponent = userMatchup?.teams.find(t => t.team_key !== teamKey);
    const myMap = new Map<number, string>((userTeam?.stats ?? []).map(s => [s.stat_id, s.value]));
    const oppMap = new Map<number, string>((opponent?.stats ?? []).map(s => [s.stat_id, s.value]));
    return { myStatsMap: myMap, oppStatsMap: oppMap };
  }, [currentMatchups, teamKey, targetWeek]);

  // ----- Pitcher tab inputs --------------------------------------------
  const { players: pitcherFAs, isLoading: pitcherFaLoading } = useAvailablePitchers(leagueKey);

  const scoredPitcherCategories = useMemo(
    () => leagueCategories.filter(c => c.is_pitcher_stat),
    [leagueCategories],
  );
  const pitcherStatIds = useMemo(() => {
    const set = new Set<number>();
    for (const c of scoredPitcherCategories) set.add(c.stat_id);
    return set;
  }, [scoredPitcherCategories]);
  const pitcherPredicate = useCallback((statId: number) => pitcherStatIds.has(statId), [pitcherStatIds]);
  const {
    focusMap: pitcherFocusMap,
    suggestedFocusMap: pitcherSuggestedFocusMap,
    set: setPitcherFocus,
    reset: resetPitcherFocus,
    hasOverrides: pitcherFocusOverrides,
  } = useSuggestedFocus(matchupAnalysis, pitcherPredicate);

  // Tomorrow's slate drives the team-offense ID list — covers ~30 teams
  // when all play, and the SWR cache shares with `useWeekPitcherScores`'s
  // internal D+1 fetch. Pitchers whose multi-day starts hit teams not on
  // tomorrow's slate just lose their opp-side adjustment (forecast
  // degrades gracefully to neutral). Acceptable trade for the simpler
  // wiring; revisit if the gap matters.
  const tomorrowDate = useMemo(() => getStreamingGridDays()[0]?.date, []);
  const { games: tomorrowGames } = useGameDay(tomorrowDate);
  const opposingTeamIds = useMemo(() => {
    const ids = new Set<number>();
    for (const g of tomorrowGames) {
      ids.add(g.homeTeam.mlbId);
      ids.add(g.awayTeam.mlbId);
    }
    return Array.from(ids);
  }, [tomorrowGames]);
  const { teams: teamOffense } = useTeamOffense(opposingTeamIds);

  const { scored: pitcherWeekScores, days: pitcherPickupDays, isLoading: pitcherScoresLoading } =
    useWeekPitcherScores(pitcherFAs, scoredPitcherCategories, pitcherFocusMap, teamOffense);

  // ----- Batter tab inputs ---------------------------------------------
  const { batters: batterFAs, isLoading: batterFaLoading } = useAvailableBatters(leagueKey, true);
  const { roster: myRoster } = useRoster(teamKey);
  const { positions: leaguePositions } = useRosterPositions(leagueKey);
  const scoredBatterCategories = useMemo(
    () => leagueCategories.filter(c => c.is_batter_stat),
    [leagueCategories],
  );
  const batterStatIds = useMemo(() => {
    const set = new Set<number>();
    for (const c of scoredBatterCategories) set.add(c.stat_id);
    return set;
  }, [scoredBatterCategories]);
  const batterPredicate = useCallback((statId: number) => batterStatIds.has(statId), [batterStatIds]);
  const {
    focusMap: batterFocusMap,
    suggestedFocusMap: batterSuggestedFocusMap,
    set: setBatterFocus,
    reset: resetBatterFocus,
    hasOverrides: batterFocusOverrides,
  } = useSuggestedFocus(matchupAnalysis, batterPredicate);

  // FA filter: 5% ownership floor, IL bypass. Lifted out of
  // BatterStreamingBoard so the same filtered list feeds both the FA
  // scoring pipeline and the slot-aware engine.
  const filteredBatterFAs = useMemo(
    () => batterFAs.filter(faShouldShow),
    [batterFAs],
  );

  // Per-FA week scoring (PA-weighted ratings, focus-honored). Lifted up
  // here so its output also feeds the slot-aware engine alongside being
  // rendered in BatterStreamingBoard. The `days` returned here are the
  // pickup-playable window — D+1 through Sunday on Mon-Sat, full next
  // Mon-Sun on Sunday — so today is automatically excluded from value
  // calculations.
  const { scored: batterFAScores, days: pickupDays, isLoading: batterScoresLoading } =
    useWeekBatterScores(filteredBatterFAs, scoredBatterCategories, batterFocusMap);

  // Slot-aware streaming value: per-day assignStarters with and without
  // each FA. Captures position competition, multi-step rebalancing, and
  // light-day open slots in one number.
  const slotAware = useSlotAwareStreaming(
    batterFAScores,
    myProjection,
    myRoster,
    leaguePositions,
    pickupDays,
  );

  const pitcherHelper = targetWeek === 'next'
    ? 'Sunday picks land on next week\'s matchup — week-aggregate scores reflect Mon-Sun coverage.'
    : 'Multi-day window: rankings reward two-start pitchers when matchups favor it. MLB probables thin out past D+3.';

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
          <VolumeGap
            myStatsMap={myStatsMap}
            oppStatsMap={oppStatsMap}
            myProjection={myPitcherProjection}
            oppProjection={oppPitcherProjection}
            limits={limits}
            isLoading={matchupLoading}
            targetWeek={targetWeek}
          />

          <GamePlanPanel
            analysis={matchupAnalysis}
            isCorrected={isCorrected}
            isLoading={matchupLoading}
            side="pitching"
            opponentName={opponentName}
            targetWeek={targetWeek}
            focusMap={pitcherFocusMap}
            onSetFocus={setPitcherFocus}
            suggestedFocusMap={pitcherSuggestedFocusMap}
            onReset={resetPitcherFocus}
            hasOverrides={pitcherFocusOverrides}
          />

          <StreamingBoard
            weekScores={pitcherWeekScores}
            days={pitcherPickupDays}
            teamOffense={teamOffense}
            loading={ctxLoading || pitcherFaLoading || pitcherScoresLoading}
            scoredPitcherCategories={scoredPitcherCategories}
            focusMap={pitcherFocusMap}
            helper={pitcherHelper}
          />
        </>
      ) : (
        <>
          <GamePlanPanel
            analysis={matchupAnalysis}
            isCorrected={isCorrected}
            isLoading={matchupLoading}
            side="batting"
            opponentName={opponentName}
            targetWeek={targetWeek}
            actionableDays={pickupDays.length}
            dailyBaselines={slotAware.dailyBaselines}
            focusMap={batterFocusMap}
            onSetFocus={setBatterFocus}
            suggestedFocusMap={batterSuggestedFocusMap}
            onReset={resetBatterFocus}
            hasOverrides={batterFocusOverrides}
          />

          <BatterStreamingBoard
            faScores={batterFAScores}
            slotAwareValues={slotAware.byPlayerKey}
            days={pickupDays}
            focusMap={batterFocusMap}
            faLoading={ctxLoading || batterFaLoading || batterScoresLoading}
          />
        </>
      )}
    </div>
  );
}
