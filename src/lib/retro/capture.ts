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
 *
 * Retro rows are reconstructions, not observations: everything they are
 * computed from (the corpus, the MLB game logs, the engine code) is still
 * here, so re-running a date REPLACES that date's rows for the engines run
 * (upsert on the identity in `insertSnapshots`, then a sweep of rows this
 * run did not touch) and stamps the current MODEL_VERSION. Live rows are
 * never touched by this path — every delete below is scoped to a
 * `retro-*` engine key by the type. docs/forecast-verification.md#retro
 */

import { and, eq, lt } from 'drizzle-orm';
import { getDb, forecastSnapshots } from '@/lib/db';
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

export type RetroSide = 'pitcher' | 'batter';
type RetroEngine = 'retro-pitcher-start' | 'retro-batter-day';
const RETRO_ENGINE: Record<RetroSide, RetroEngine> = { pitcher: 'retro-pitcher-start', batter: 'retro-batter-day' };

export interface RetroCaptureResult {
  date: string; games: number; probables: number; probablesWithTalent: number;
  lineups: number; pitcherRows: number; batterRows: number;
  /** Rows for this date + engine that an earlier run wrote and this run did
   *  not — identities the current build no longer produces — removed. */
  staleRemoved: number; ms: number;
}

/** Remove this date's rows for a retro engine that predate `since` — i.e.
 *  that this run did not write. Only called after the run wrote at least one
 *  row for the engine, so a failed rebuild never empties a date. */
async function sweepStale(date: string, engine: RetroEngine, since: Date): Promise<number> {
  const gone = await getDb()
    .delete(forecastSnapshots)
    .where(and(eq(forecastSnapshots.gameDate, date), eq(forecastSnapshots.engine, engine), lt(forecastSnapshots.capturedAt, since)))
    .returning({ id: forecastSnapshots.id });
  return gone.length;
}

export async function retroCaptureDay(date: string, sides: RetroSide[] = ['pitcher', 'batter']): Promise<RetroCaptureResult> {
  const t0 = Date.now();
  const since = new Date(t0);
  const ctx = await createAsOfContext(date);
  return runWithAsOfContext(ctx, async () => {
    const games = await buildRetroSlate(date, ctx.season);
    const enriched = games.map(g => ({ ...g, park: getParkByVenueId(g.venue.mlbId) ?? null }));
    const probables = enriched.flatMap(g => [g.homeProbablePitcher, g.awayProbablePitcher]).filter((p): p is NonNullable<typeof p> => !!p);
    let pitcherRows = 0, batterRows = 0, staleRemoved = 0;
    if (sides.includes('pitcher')) {
      pitcherRows = await capturePitcherSlate(date, enriched, { engine: RETRO_ENGINE.pitcher, includeFinal: true });
      if (pitcherRows > 0) staleRemoved += await sweepStale(date, RETRO_ENGINE.pitcher, since);
    }
    if (sides.includes('batter')) {
      batterRows = await captureBatterSlate(date, enriched, { engine: RETRO_ENGINE.batter, includeFinal: true });
      if (batterRows > 0) staleRemoved += await sweepStale(date, RETRO_ENGINE.batter, since);
    }
    return {
      date, games: enriched.length, probables: probables.length, probablesWithTalent: probables.filter(p => p.talent).length,
      lineups: enriched.filter(g => g.homeLineup.length && g.awayLineup.length).length, pitcherRows, batterRows, staleRemoved, ms: Date.now() - t0,
    };
  });
}
