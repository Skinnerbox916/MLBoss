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
 * Returns the slot-aware ranking + per-day baselines for the StrategySummary.
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

    return computeSlotAwareStreaming({
      days,
      myRoster: myRosterInput,
      faPool: faInput,
      slots,
    });
  }, [faScores, myProjection, myRoster, leaguePositions, days]);
}
