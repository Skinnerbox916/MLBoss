/**
 * Retro capture — run the unchanged L2 engines on a PAST slate with inputs as
 * they stood that morning, and write `retro-pitcher-start` / `retro-batter-day`
 * snapshots. Everything inside `runWithAsOfContext` sees as-of data: Savant
 * from the corpus aggregate, MLB totals as date ranges, game logs sliced,
 * splits synthesized (see mlbAsOf.ts); Redis is bypassed throughout.
 *
 * What retro takes from hindsight, deliberately: the actual starters (the
 * schedule's probables for a completed date ARE the starters), the posted
 * lineups, and the observed weather — so retro cannot see scratches, late
 * lineup changes or forecast-weather error. That is why its rows carry their
 * own engine keys and never pool with live captures.
 * docs/forecast-verification.md#retro
 */

import { mlbFetch } from '@/lib/mlb/client';
import { runWithAsOfContext } from '@/lib/mlb/asOfContext';
import { enrichSlate, parseGame, stubPitcher, type RawScheduleResponse } from '@/lib/mlb/schedule';
import { getParkByVenueId } from '@/lib/mlb/parks';
import type { MLBGame } from '@/lib/mlb/types';
import { capturePitcherSlate, captureBatterSlate } from '@/lib/ledger/capture';
import { createAsOfContext } from './mlbAsOf';

const FINAL_STATES = /^(Final|Game Over|Completed Early)/;

/** Parse the completed slate for `date`: actual starters as probables (with
 *  hand), posted lineups, observed weather. Enrichment runs the same code as
 *  the live slate. Must be called inside an as-of context. */
export async function buildRetroSlate(date: string, season: number): Promise<MLBGame[]> {
  const raw = await mlbFetch<RawScheduleResponse>(
    `/schedule?sportId=1&date=${date}&gameType=R&hydrate=${encodeURIComponent('venue,weather,team,lineups,probablePitcher')}`,
  );
  const rawGames = (raw.dates?.[0]?.games ?? []).filter(g =>
    FINAL_STATES.test(g.status.detailedState)
    // A suspended game resumed on a later day is listed under BOTH dates but
    // belongs to its official one — where the corpus and the MLB game logs
    // file it. Without this it is captured twice and the copy on the wrong
    // date can never be graded.
    && (g.officialDate == null || g.officialDate === date),
  );
  const ids = rawGames.flatMap(g => [g.teams.home.probablePitcher?.id, g.teams.away.probablePitcher?.id]).filter((v): v is number => !!v);
  const hands = new Map<number, 'L' | 'R'>();
  if (ids.length) {
    const people = await mlbFetch<{ people?: { id: number; pitchHand?: { code: string } }[] }>(
      `/people?personIds=${ids.join(',')}&fields=people,id,pitchHand,code`,
    );
    for (const p of people.people ?? []) if (p.pitchHand?.code === 'L' || p.pitchHand?.code === 'R') hands.set(p.id, p.pitchHand.code);
  }
  const games = rawGames.map(rg => {
    const g = parseGame(rg);
    const h = rg.teams.home.probablePitcher, a = rg.teams.away.probablePitcher;
    g.homeProbablePitcher = h ? stubPitcher(h.fullName, h.id, hands.get(h.id) ?? null) : null;
    g.awayProbablePitcher = a ? stubPitcher(a.fullName, a.id, hands.get(a.id) ?? null) : null;
    return g;
  });
  await enrichSlate(games, season);
  return games;
}

export interface RetroCaptureResult {
  date: string; games: number; probables: number; probablesWithTalent: number;
  lineups: number; pitcherRows: number; batterRows: number; ms: number;
}

export async function retroCaptureDay(date: string): Promise<RetroCaptureResult> {
  const t0 = Date.now();
  const ctx = await createAsOfContext(date);
  return runWithAsOfContext(ctx, async () => {
    const games = await buildRetroSlate(date, ctx.season);
    const enriched = games.map(g => ({ ...g, park: getParkByVenueId(g.venue.mlbId) ?? null }));
    const probables = enriched.flatMap(g => [g.homeProbablePitcher, g.awayProbablePitcher]).filter((p): p is NonNullable<typeof p> => !!p);
    const pitcherRows = await capturePitcherSlate(date, enriched, { engine: 'retro-pitcher-start', includeFinal: true });
    const batterRows = await captureBatterSlate(date, enriched, { engine: 'retro-batter-day', includeFinal: true });
    return {
      date, games: enriched.length, probables: probables.length, probablesWithTalent: probables.filter(p => p.talent).length,
      lineups: enriched.filter(g => g.homeLineup.length && g.awayLineup.length).length, pitcherRows, batterRows, ms: Date.now() - t0,
    };
  });
}
