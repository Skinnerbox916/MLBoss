'use client';

import { useMemo } from 'react';
import {
  computeSlotAwareStreaming,
  type SlotAwareResult,
  type SlotAwareInput,
} from '@/lib/projection/slotAware';
import { getBatterPositions, parseStartingSlots } from '@/lib/roster/depth';
import { isPitcher, getRowStatus } from '@/components/lineup/types';
import type { WeekDay } from '@/lib/dashboard/weekRange';
import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import type { RosterPositionSlot } from './useRosterPositions';
import type { BatterTeamProjectionResponse } from './useBatterTeamProjection';
import type { WeekBatterScore } from './useWeekBatterScores';

/**
 * Compose the slot-aware streaming engine with its client-side inputs.
 *
 *   - My roster's per-day batter scores come from the team-projection
 *     response, keyed by `name|team` lowercase to match `getRosterSeasonStats`.
 *     Eligible positions come from the roster fetch — we bridge the two by
 *     name+team.
 *   - FA per-day scores come from the FA aggregator (`useWeekBatterScores`).
 *   - Slot template comes from `useRosterPositions`.
 *
 * Returns the slot-aware ranking + per-day baselines for GamePlanPanel.
 */
export function useSlotAwareStreaming(
  faScores: WeekBatterScore[],
  myProjection: BatterTeamProjectionResponse | undefined,
  myRoster: RosterEntry[],
  leaguePositions: RosterPositionSlot[],
  days: WeekDay[],
): SlotAwareResult {
  return useMemo<SlotAwareResult>(() => {
    const empty: SlotAwareResult = { byPlayerKey: new Map(), dailyBaselines: [] };
    if (!myProjection || days.length === 0) return empty;
    if (leaguePositions.length === 0) return empty;
    // No roster yet (still loading, or the fetch failed) — without a
    // baseline every FA prices as "fills an open slot at full score" and
    // the board inflates ~5×. Same contract as the `!myProjection` guard.
    if (myRoster.length === 0) return empty;

    const slots = parseStartingSlots(leaguePositions);

    // Filter my roster to active batters. Mirrors the server-side
    // projection's filter (mapping from RosterEntry → BatterTeamProjection's
    // perPlayer[]) so name+team lookup hits the projection's contributors.
    const activeRosterByKey = new Map<string, RosterEntry>();
    for (const p of myRoster) {
      if (isPitcher(p)) continue;
      if (getRowStatus(p) === 'injured') continue;
      const key = `${p.name.toLowerCase()}|${p.editorial_team_abbr.toLowerCase()}`;
      activeRosterByKey.set(key, p);
    }

    // Build my-roster slot-aware-input. Per-day score comes from the
    // projection's perPlayer entries; eligible positions come from the
    // roster entry. Skip projection entries we can't bridge.
    const myRosterInput: SlotAwareInput['myRoster'] = [];
    for (const proj of myProjection.perPlayer) {
      const key = `${proj.name.toLowerCase()}|${proj.teamAbbr.toLowerCase()}`;
      const rosterEntry = activeRosterByKey.get(key);
      if (!rosterEntry) continue;
      const eligiblePositions = getBatterPositions(rosterEntry.eligible_positions);
      if (eligiblePositions.length === 0) continue;
      const perDayScore = new Map<string, number>();
      for (const d of proj.perDay) {
        if (d.hasGame && typeof d.score === 'number' && d.score > 0) {
          perDayScore.set(d.date, d.score);
        }
      }
      myRosterInput.push({
        player_key: rosterEntry.player_key,
        name: proj.name,
        eligibleBatterPositions: eligiblePositions,
        perDayScore,
      });
    }

    // Build FA slot-aware-input. Eligible positions from the FreeAgentPlayer
    // object; per-day scores from the per-FA projection.
    const faInput: SlotAwareInput['faPool'] = [];
    for (const s of faScores) {
      const eligiblePositions = getBatterPositions(s.player.eligible_positions);
      if (eligiblePositions.length === 0) continue;
      const perDayScore = new Map<string, number>();
      for (const d of s.projection.perDay) {
        if (d.hasGame && d.rating && d.rating.score > 0) {
          perDayScore.set(d.date, d.rating.score);
        }
      }
      faInput.push({
        player_key: s.player.player_key,
        name: s.player.name,
        eligibleBatterPositions: eligiblePositions,
        perDayScore,
      });
    }

    // The projection↔roster bridge produced nothing — treat as loading, not
    // as an empty lineup (see the myRoster guard above).
    if (myRosterInput.length === 0) return empty;

    // Trust a window day only if at least one rostered bat has a score on
    // it OR no FA does either. A day where FAs score but the entire roster
    // is blank is a degraded projection payload (partial stats/slate run
    // pinned upstream), not a real schedule — pricing FAs against a missing
    // baseline turns every upgrade margin into a full-score windfall
    // (2026-07-21 "top move +166" dashboard incident).
    const rosterScoredDates = new Set<string>();
    for (const p of myRosterInput) {
      for (const date of p.perDayScore.keys()) rosterScoredDates.add(date);
    }
    const trustedDays = days.filter(
      day =>
        rosterScoredDates.has(day.date) ||
        !faInput.some(f => f.perDayScore.has(day.date)),
    );

    return computeSlotAwareStreaming({
      days: trustedDays,
      myRoster: myRosterInput,
      faPool: faInput,
      slots,
    });
  }, [faScores, myProjection, myRoster, leaguePositions, days]);
}
