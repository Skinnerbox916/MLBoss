'use client';

import { useMemo } from 'react';
import {
  computeSlotAwareStreaming,
  type FAStreamingValue,
  type DailyBaseline,
  type SlotAwareInput,
} from '@/lib/projection/slotAware';
import {
  computeStreamCatImpact,
  type CatDelta,
  type PlayerWeekCats,
} from '@/lib/projection/streamCatImpact';
import { getBatterPositions, parseStartingSlots } from '@/lib/roster/depth';
import { isPitcher, getRowStatus } from '@/components/lineup/types';
import type { WeekDay } from '@/lib/dashboard/weekRange';
import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import type { RosterPositionSlot } from './useRosterPositions';
import type { BatterTeamProjectionResponse, ProjectedPlayer } from './useBatterTeamProjection';
import type { WeekBatterScore } from './useWeekBatterScores';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';

/** Slot-aware value + the category-impact pricing of the same add. */
export interface StreamValue extends FAStreamingValue {
  /** Weighted category-impact scalar — the board's ranking key. */
  impact: number;
  /** Net per-cat deltas vs the displaced starters, |contribution| desc. */
  catDeltas: CatDelta[];
}

export interface SlotAwareStreamingResult {
  byPlayerKey: Map<string, StreamValue>;
  dailyBaselines: DailyBaseline[];
  /** Roster player_key → display name — resolves `displacedKeys` for the
   *  board's "over <starter>" swap story. */
  rosterNameByKey: Map<string, string>;
}

const STAT_AVG = 3;

/** Week-cats view of a server-projection player (Record → Map). */
function weekCatsFromProjected(p: ProjectedPlayer): PlayerWeekCats {
  const byCategory = new Map<number, { expectedCount: number; expectedDenom: number }>();
  for (const [statIdStr, cat] of Object.entries(p.byCategory)) {
    byCategory.set(Number(statIdStr), cat);
  }
  const paByDate = new Map<string, number>();
  for (const d of p.perDay) {
    if (d.hasGame && d.expectedPA > 0) paByDate.set(d.date, d.expectedPA);
  }
  return { byCategory, weeklyPA: p.weeklyPA, paByDate };
}

/** Week-cats view of a client-side FA projection (already Maps). */
function weekCatsFromScore(s: WeekBatterScore): PlayerWeekCats {
  const byCategory = new Map<number, { expectedCount: number; expectedDenom: number }>();
  for (const [statId, cat] of s.projection.byCategory) {
    byCategory.set(statId, { expectedCount: cat.expectedCount, expectedDenom: cat.expectedDenom });
  }
  const paByDate = new Map<string, number>();
  for (const d of s.projection.perDay) {
    if (d.hasGame && d.expectedPA > 0) paByDate.set(d.date, d.expectedPA);
  }
  return { byCategory, weeklyPA: s.projection.weeklyPA, paByDate };
}

/**
 * Compose the slot-aware streaming engine with its client-side inputs,
 * then price each FA's add in category units (`computeStreamCatImpact`).
 *
 *   - My roster's per-day batter scores come from the team-projection
 *     response, keyed by `name|team` lowercase to match `getRosterSeasonStats`.
 *     Eligible positions come from the roster fetch — we bridge the two by
 *     name+team.
 *   - FA per-day scores come from the FA aggregator (`useWeekBatterScores`).
 *   - Slot template comes from `useRosterPositions`.
 *   - `categoryWeights` (pivotality) + scored cats drive the impact scalar;
 *     when omitted the impact weighs every cat fully (equal-contest).
 *
 * Returns the impact-priced ranking + per-day baselines for GamePlanPanel.
 */
export function useSlotAwareStreaming(
  faScores: WeekBatterScore[],
  myProjection: BatterTeamProjectionResponse | undefined,
  myRoster: RosterEntry[],
  leaguePositions: RosterPositionSlot[],
  days: WeekDay[],
  scoredCategories: EnrichedLeagueStatCategory[] = [],
  categoryWeights: Record<number, number> = {},
): SlotAwareStreamingResult {
  return useMemo<SlotAwareStreamingResult>(() => {
    const empty: SlotAwareStreamingResult = { byPlayerKey: new Map(), dailyBaselines: [], rosterNameByKey: new Map() };
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

    // Build my-roster slot-aware-input + the week-cats lookup the impact
    // engine uses to price displaced starters. Per-day score comes from the
    // projection's perPlayer entries; eligible positions come from the
    // roster entry. Skip projection entries we can't bridge.
    const myRosterInput: SlotAwareInput['myRoster'] = [];
    const rosterCatsByKey = new Map<string, PlayerWeekCats>();
    const rosterNameByKey = new Map<string, string>();
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
      rosterCatsByKey.set(rosterEntry.player_key, weekCatsFromProjected(proj));
      rosterNameByKey.set(rosterEntry.player_key, proj.name);
    }

    // Build FA slot-aware-input. Eligible positions from the FreeAgentPlayer
    // object; per-day scores from the per-FA projection.
    const faInput: SlotAwareInput['faPool'] = [];
    const faScoreByKey = new Map<string, WeekBatterScore>();
    for (const s of faScores) {
      // Roster overlap guard: the roster snapshot and the FA pool are
      // cached separately, so a just-dropped (or just-added) player can
      // briefly appear in both. Pricing him "against" a lineup he's still
      // in double-counts his production — skip until the caches agree.
      const identKey = `${s.player.name.toLowerCase()}|${s.player.editorial_team_abbr.toLowerCase()}`;
      if (activeRosterByKey.has(identKey)) continue;
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
        playShare: s.playShare,
      });
      faScoreByKey.set(s.player.player_key, s);
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

    const solve = computeSlotAwareStreaming({
      days: trustedDays,
      myRoster: myRosterInput,
      faPool: faInput,
      slots,
    });

    // Price every FA's add in category units against the displaced starters.
    const impactCats = scoredCategories
      .filter(c => c.is_batter_stat)
      .map(c => ({ statId: c.stat_id, betterIs: c.betterIs }));
    const teamAvgCat = myProjection.byCategory[STAT_AVG];
    const teamWeek = {
      h: teamAvgCat?.expectedCount ?? 0,
      ab: teamAvgCat?.expectedDenom ?? 0,
    };

    const byPlayerKey = new Map<string, StreamValue>();
    for (const [playerKey, value] of solve.byPlayerKey) {
      const s = faScoreByKey.get(playerKey);
      if (!s) continue;
      const { impact, deltas } = impactCats.length > 0
        ? computeStreamCatImpact({
            perDay: value.perDay,
            fa: weekCatsFromScore(s),
            rosterByKey: rosterCatsByKey,
            playShare: s.playShare,
            weights: categoryWeights,
            cats: impactCats,
            teamWeek,
          })
        : { impact: 0, deltas: [] };
      byPlayerKey.set(playerKey, { ...value, impact, catDeltas: deltas });
    }

    return { byPlayerKey, dailyBaselines: solve.dailyBaselines, rosterNameByKey };
  }, [faScores, myProjection, myRoster, leaguePositions, days, scoredCategories, categoryWeights]);
}
