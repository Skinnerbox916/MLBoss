'use client';

import { useState, useMemo, useCallback } from 'react';
import Panel from '@/components/ui/Panel';
import { Heading, Text } from '@/components/typography';
import { useActiveLeague } from '@/lib/hooks/useActiveLeague';
import { useScoringProfile } from '@/lib/hooks/useScoringProfile';
import { batterPointsScore, type BatterPointsScore } from '@/lib/points/lineupScoring';
import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import { useRoster } from '@/lib/hooks/useRoster';
import { useRosterPositions } from '@/lib/hooks/useRosterPositions';
import { useGameDay } from '@/lib/hooks/useGameDay';
import { useRosterStats } from '@/lib/hooks/useRosterStats';
import { useLeagueCategories } from '@/lib/hooks/useLeagueCategories';
import { useCorrectedMatchupAnalysis } from '@/lib/hooks/useCorrectedMatchupAnalysis';
import { useMatchupHeader } from '@/lib/hooks/useMatchupHeader';
import { useCategoryWeights } from '@/lib/hooks/useCategoryWeights';
import { resolveMatchup, isWipedGame, type MatchupContext } from '@/lib/mlb/analysis';
import { getBatterRating } from '@/lib/mlb/batterRating';
import { computeSitPlan, type SitPlan, type SitPlanCandidate, type SitPlanRow } from '@/lib/lineup/sitValue';
import { isInjured } from '@/lib/lineup/optimize';
import { getMatchupWeekDays } from '@/lib/dashboard/weekRange';
import { expectedPAperGame } from '@/lib/projection/batterTeam';
import GamePlanPanel from '@/components/shared/GamePlanPanel';
import { optimizeWeek } from '@/lib/lineup/optimizeWeek';
import DatePicker from './DatePicker';
import PositionFilter from './PositionFilter';
import RosterList from './RosterList';
import LineupGrid from './LineupGrid';
import { type LineupMode, isPitcher } from './types';

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Doubleheader players are effectively forced starters: a flat boost large
// enough to outrank any single-game score, while still letting Hungarian
// rank between multiple DH players by their underlying matchup score.
const DH_BOOST = 1000;

// Score for a bat the endgame sit plan benches: below idle (-1) and below
// the optimizer's empty-slot cost (0), so a planned sit never takes a slot.
const SAT_SCORE = -2;

interface LineupManagerProps {
  mode?: LineupMode;
  /**
   * When true, suppresses the outer page padding and the top-level title row.
   * Used when the manager is rendered inside a tab on the Today page.
   */
  embedded?: boolean;
}

export default function LineupManager({ mode = 'batting', embedded = false }: LineupManagerProps) {
  // Active league (primary, or whatever the switcher selected). `leagueMode`
  // is the scoring family (categories | points); the `mode` prop is the
  // batting/pitching side.
  const { teamKey, leagueKey, mode: leagueMode, scoringType, lineupCadence, isLoading: ctxLoading, isError: ctxError } = useActiveLeague();
  const isPoints = leagueMode === 'points';
  // Per-stat point weights for client-side points scoring (points mode only).
  const { profile: pointsProfile } = useScoringProfile(leagueKey, scoringType, isPoints);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [selectedPosition, setSelectedPosition] = useState<string | null>(null);

  // Yahoo roster for the selected date
  const { roster, isLoading: rosterLoading, isError: rosterError, mutate: mutateRoster } = useRoster(teamKey, selectedDate);

  // League roster slot template (positions + counts) — drives the LineupGrid.
  const { positions: rosterPositions } = useRosterPositions(leagueKey);

  // MLB schedule for the selected date — one call for the whole page
  const { games, isLoading: gamesLoading, isError: gamesError } = useGameDay(selectedDate);

  // Batch-fetch season stats for all roster players — drives talent-aware
  // sorting. We consume the stratified `PlayerStatLine` shape and pass it
  // straight through the optimiser → RosterList → PlayerRow → splits panel
  // pipeline. The downstream scoring engines accept it directly via the
  // polymorphic `asBatterStats` shim documented in
  // `docs/data-architecture.md` (the legacy flat shape is now an internal
  // implementation detail of the scoring engines).
  const { getPlayerLine } = useRosterStats(roster);

  // League scoring categories → drive both the Game Plan focus picker
  // and the per-category batter rating. Only batter-side categories show
  // up in the lineup focus bar (a pitcher K category doesn't help a hitter).
  const { categories: leagueCategories } = useLeagueCategories(leagueKey);
  const scoredBatterCategories = useMemo(
    () => leagueCategories.filter(c => c.is_batter_stat),
    [leagueCategories],
  );

  // Pull the current matchup so we can suggest which categories to chase.
  // The matchup analysis engine looks at how close each category is and
  // outputs a `chase | neutral | punt` suggestion per stat — those become
  // the focusMap defaults that `getBatterRating` consumes below. The user
  // can still override and reset. See `docs/recommendation-system.md`.
  //
  // We use the corrected (matchup-to-date + rest-of-week projection)
  // analysis here so the focus bar agrees with the streaming page's batter
  // tab — both pages ask "which categories will be contested by Sunday
  // given my actual roster?" and the projection answers that better than
  // the scoreboard alone.
  const {
    analysis: matchupAnalysis,
    isCorrected,
    isLoading: matchupLoading,
    myProjection,
    oppProjection,
    // Points leagues have no category matchup — pass undefined so the SWR
    // keys go null and we DON'T fire the (slow, wasted) batter-team /
    // pitcher-team category projections behind this hook.
  } = useCorrectedMatchupAnalysis(isPoints ? undefined : leagueKey, isPoints ? undefined : teamKey);

  const { opponentName } = useMatchupHeader(isPoints ? undefined : leagueKey, isPoints ? undefined : teamKey);

  const batterStatIds = useMemo(() => {
    const set = new Set<number>();
    for (const c of scoredBatterCategories) set.add(c.stat_id);
    return set;
  }, [scoredBatterCategories]);
  const batterPredicate = useCallback((statId: number) => batterStatIds.has(statId), [batterStatIds]);

  // Pivotality weights + concession state for the batter side. Drives the
  // displayed scores, the optimizer, the Game Plan panel, and the sit logic.
  // See docs/pivotality-migration.md.
  const {
    categoryWeights: batterCategoryWeights,
    isConceded,
    isAutoConceded,
    toggleConcede,
    reset: resetConcede,
    hasOverrides: hasConcedeOverrides,
  } = useCategoryWeights(matchupAnalysis, batterPredicate);

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

  // Teams with 2+ live games on the selected date. Players on these teams
  // get the DH_BOOST so the optimizer treats them as forced starts.
  const dhTeams = useMemo(() => {
    const counts = new Map<string, number>();
    for (const game of games) {
      if (isWipedGame(game.status)) continue;
      const home = game.homeTeam.abbreviation.toUpperCase();
      const away = game.awayTeam.abbreviation.toUpperCase();
      counts.set(home, (counts.get(home) ?? 0) + 1);
      counts.set(away, (counts.get(away) ?? 0) + 1);
    }
    const set = new Set<string>();
    for (const [abbr, n] of counts.entries()) {
      if (n >= 2) set.add(abbr);
    }
    return set;
  }, [games]);

  const getMatchupContext = useCallback(
    (teamAbbr: string): MatchupContext | null => {
      return matchupIndex.get(teamAbbr.toUpperCase()) ?? null;
    },
    [matchupIndex],
  );

  // Points scorer — projected points for the selected day. The points analog
  // of the categories `getBatterRating` path; drives the points roster sort
  // and the optimizer. Idle players → 0 (sink in sort/optimize).
  const pointsScoreFor = useCallback(
    (p: RosterEntry): BatterPointsScore => {
      if (!pointsProfile) return { today: 0, perGame: 0, weekly: 0, matchup: { multiplier: 1, hint: '' } };
      const abbr = p.editorial_team_abbr.toUpperCase();
      const context = matchupIndex.get(abbr) ?? null;
      const gameCount = context ? (dhTeams.has(abbr) ? 2 : 1) : 0;
      return batterPointsScore(getPlayerLine(p.name, p.editorial_team_abbr), pointsProfile, {
        battingOrder: p.batting_order,
        gameCount,
        context,
      });
    },
    [pointsProfile, matchupIndex, dhTeams, getPlayerLine],
  );

  // AVG dilution anchor for the sit-value calc. The bar is the OPPONENT's
  // projected AVG (stat_id 3) — what we must beat to win the category — not
  // our own (small-sample-inflated) AVG, which would flag every bat as
  // dilutive. `myWeekAB` scales how much one bat's ABs move our team rate.
  const avgAnchor = useMemo(() => {
    const oppAvgRow = oppProjection?.byCategory?.[3];
    const myAvgRow = myProjection?.byCategory?.[3];
    if (!oppAvgRow || oppAvgRow.expectedDenom <= 0) return undefined;
    if (!myAvgRow || myAvgRow.expectedDenom <= 0) return undefined;
    return {
      oppAvg: oppAvgRow.expectedCount / oppAvgRow.expectedDenom,
      myWeekAB: myAvgRow.expectedDenom,
    };
  }, [oppProjection, myProjection]);

  // Endgame sit plan — which bats (if any) the optimizer should bench today
  // to protect a losing K/AVG race. Arms only when EVERY counting cat is
  // decided (locked or conceded), the locks survive the benches, and each
  // benched bat's harm clears the noise deadband. Today-only by design:
  // future days get re-decided daily with fresh information. Empty when
  // disarmed → the optimizer keeps its "always fill" behavior.
  // See computeSitPlan in src/lib/lineup/sitValue.ts.
  const sitPlan = useMemo<SitPlan>(() => {
    const empty: SitPlan = { sits: [] };
    if (isPoints || mode !== 'batting' || !isCorrected) return empty;
    if (selectedDate !== todayStr()) return empty;
    if (batterStatIds.size === 0) return empty;

    // Numeric corrected totals for every scored batter cat. Bail to the
    // always-fill behavior if any cat lacks a comparable pair — we can't
    // verify it's safe to sacrifice what we can't see.
    const rows: SitPlanRow[] = [];
    for (const row of matchupAnalysis.rows) {
      if (!batterStatIds.has(row.statId)) continue;
      const my = parseFloat(row.myVal);
      const opp = parseFloat(row.oppVal);
      if (!Number.isFinite(my) || !Number.isFinite(opp)) return empty;
      rows.push({ statId: row.statId, betterIs: row.betterIs, my, opp });
    }
    if (rows.length !== batterStatIds.size) return empty;

    const concededSet = new Set<number>();
    for (const id of batterStatIds) {
      if (isConceded(id)) concededSet.add(id);
    }

    // Movable game-day batters — mirrors the optimizer's own movable set
    // (editable, not injured, not NS) so the plan never benches someone
    // the Hungarian can't move.
    const candidates: SitPlanCandidate[] = [];
    for (const p of roster) {
      if (isPitcher(p)) continue;
      if (!p.is_editable || isInjured(p) || p.starting_status === 'NS') continue;
      const abbr = p.editorial_team_abbr.toUpperCase();
      const context = matchupIndex.get(abbr) ?? null;
      if (!context) continue;
      const rating = getBatterRating({
        context,
        stats: getPlayerLine(p.name, p.editorial_team_abbr),
        scoredCategories: scoredBatterCategories,
        categoryWeights: batterCategoryWeights,
        battingOrder: p.batting_order,
      });
      const gameCount = dhTeams.has(abbr) ? 2 : 1;
      candidates.push({
        key: p.player_key,
        name: p.name,
        rating,
        expectedPA: expectedPAperGame(p.batting_order) * gameCount,
      });
    }
    if (candidates.length === 0) return empty;

    const finished = getMatchupWeekDays().filter(d => !d.isRemaining).length;
    return computeSitPlan({
      rows,
      concededSet,
      candidates,
      avgAnchor,
      daysElapsed: finished + 0.5,
    });
  }, [
    isPoints, mode, isCorrected, selectedDate, batterStatIds, matchupAnalysis,
    isConceded, roster, matchupIndex, dhTeams, getPlayerLine,
    scoredBatterCategories, batterCategoryWeights, avgAnchor,
  ]);

  const satKeys = useMemo(() => new Set(sitPlan.sits.map(s => s.key)), [sitPlan]);

  // Optimizer score. A player with a rough matchup is still strictly better
  // than a player who isn't playing at all — we want the counting stats.
  // `getBatterRating` returns a neutral 50 when there's no game context,
  // which would let no-game players displace real starts (e.g. a benched
  // 1B occupying Util over a game-day OF with a tough SP). Collapse the
  // no-game case to a negative score so any real matchup wins on cost.
  const getPlayerScore = useCallback(
    (p: { name: string; editorial_team_abbr: string; batting_order: number | null }) => {
      const abbr = p.editorial_team_abbr.toUpperCase();
      const context = matchupIndex.get(abbr) ?? null;
      if (!context) return -1;
      const rating = getBatterRating({
        context,
        stats: getPlayerLine(p.name, p.editorial_team_abbr),
        scoredCategories: scoredBatterCategories,
        categoryWeights: batterCategoryWeights,
        battingOrder: p.batting_order,
      });
      const dhBoost = dhTeams.has(abbr) ? DH_BOOST : 0;
      return dhBoost + rating.score / 100;
    },
    [matchupIndex, dhTeams, getPlayerLine, scoredBatterCategories, batterCategoryWeights],
  );

  // Score the optimizer/grid consumes — points or categories. Idle players
  // collapse to -1 so any real game wins a slot (mirrors the categories
  // no-game handling). Planned sits collapse below idle AND below the empty
  // slot (cost 0), so the Hungarian benches them and leaves the slot open.
  const gridGetPlayerScore = useCallback(
    (p: { player_key: string; name: string; editorial_team_abbr: string; batting_order: number | null }) => {
      if (isPoints) {
        const s = pointsScoreFor(p as RosterEntry);
        return s.today > 0 ? s.today : -1;
      }
      if (satKeys.has(p.player_key)) return SAT_SCORE;
      return getPlayerScore(p);
    },
    [isPoints, pointsScoreFor, getPlayerScore, satKeys],
  );

  // Optimize-week state. Runs the optimizer for every remaining day in the
  // current fantasy week (Mon–Sun) so the user can't forget mid-week.
  const [weekRunning, setWeekRunning] = useState(false);
  const [weekStatus, setWeekStatus] = useState<string | null>(null);

  const handleOptimizeWeek = useCallback(async () => {
    if (!teamKey || mode !== 'batting') return;
    const today = todayStr();
    const start = selectedDate < today ? today : selectedDate;
    setWeekRunning(true);
    setWeekStatus('Starting…');

    // Points mode: the optimize+write loop runs server-side (points scoring
    // lives server-side), so we POST and report the per-day result.
    if (isPoints) {
      try {
        const res = await fetch('/api/points/optimize-week', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teamKey, leagueKey, scoringType }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        const saved = body.days.filter((d: { saved: boolean }) => d.saved).length;
        const noop = body.days.filter((d: { saved: boolean; error?: string }) => !d.saved && !d.error).length;
        const parts: string[] = [];
        if (saved > 0) parts.push(`${saved} saved`);
        if (noop > 0) parts.push(`${noop} already optimal`);
        if ((body.failed ?? 0) > 0) parts.push(`${body.failed} failed`);
        setWeekStatus(parts.join(' · ') || 'No changes needed');
        mutateRoster();
      } catch (e) {
        setWeekStatus(`Failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      } finally {
        setWeekRunning(false);
      }
      return;
    }

    try {
      const result = await optimizeWeek(
        start,
        {
          teamKey,
          rosterPositions,
          scoredBatterCategories,
          categoryWeights: batterCategoryWeights,
          getPlayerLine,
        },
        (date, i, total) => {
          setWeekStatus(`Optimizing ${date} (${i + 1}/${total})…`);
        },
      );
      const noopDays = result.days.filter(d => d.saved === false && !d.error).length;
      const savedDays = result.days.filter(d => d.saved).length;
      const parts: string[] = [];
      if (savedDays > 0) parts.push(`${savedDays} saved`);
      if (noopDays > 0) parts.push(`${noopDays} already optimal`);
      if (result.failed > 0) parts.push(`${result.failed} failed`);
      setWeekStatus(parts.join(' · ') || 'No changes needed');
      mutateRoster();
    } catch (e) {
      setWeekStatus(`Failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setWeekRunning(false);
    }
  }, [teamKey, mode, selectedDate, rosterPositions, scoredBatterCategories, batterCategoryWeights, getPlayerLine, mutateRoster, isPoints, leagueKey, scoringType]);

  const isLoading = ctxLoading || rosterLoading;
  const isError = ctxError || rosterError;

  const title = mode === 'pitching' ? 'Set Your Pitching Staff' : 'Set Your Lineup';
  const subtitle =
    mode === 'pitching'
      ? "Click any pitcher for full splits vs. today's matchup"
      : "Click any player for full splits vs. today's matchup";
  const listHeading = mode === 'pitching' ? 'Pitchers' : 'Batters';
  const gridHeading = mode === 'pitching' ? 'Current Staff' : 'Current Lineup';

  const showWeekButton = mode === 'batting' && !!teamKey;
  // Weekly-cadence points leagues lock lineups Monday: the server writes ONE
  // week-sum-optimal lineup dated next Monday instead of a per-day loop.
  const isWeeklyPoints = isPoints && lineupCadence === 'weekly';
  const weekButton = showWeekButton ? (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleOptimizeWeek}
        disabled={weekRunning}
        className="px-3 py-2 rounded-lg text-sm font-semibold bg-success/90 text-white hover:bg-success transition-colors disabled:bg-border-muted disabled:text-muted-foreground disabled:cursor-not-allowed whitespace-nowrap"
        title={isWeeklyPoints
          ? 'Lineups lock for the week — set the optimal lineup for next Mon–Sun'
          : 'Optimize lineup for every remaining day this fantasy week (Mon–Sun)'}
      >
        {weekRunning ? 'Optimizing…' : isWeeklyPoints ? "Set Next Week's Lineup" : 'Optimize Week'}
      </button>
      {weekStatus && (
        <Text variant="caption">{weekStatus}</Text>
      )}
    </div>
  ) : null;

  return (
    <div className={embedded ? 'space-y-4' : 'p-6 space-y-4'}>
      {/* Header row: title + date picker + optimize-week */}
      {embedded ? (
        <div className="flex flex-wrap items-start justify-end gap-3">
          {weekButton}
          <DatePicker selected={selectedDate} onSelect={setSelectedDate} />
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <Heading as="h1">{title}</Heading>
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
          <div className="flex flex-wrap items-start gap-3">
            {weekButton}
            <DatePicker selected={selectedDate} onSelect={setSelectedDate} />
          </div>
        </div>
      )}

      {/* Game Plan — chase/hold/punt grouping over the current matchup,
          with inline focus pills so the user can override MLBoss's
          suggestions without leaving the page. The same panel sits on
          the streaming batter tab; toggles here flow into the lineup
          optimizer (focusMap is shared with `getBatterRating` below). */}
      {!isPoints && mode === 'batting' && scoredBatterCategories.length > 0 && (
        <GamePlanPanel
          analysis={matchupAnalysis}
          isCorrected={isCorrected}
          isLoading={matchupLoading}
          side="batting"
          opponentName={opponentName}
          categoryWeights={batterCategoryWeights}
          isConceded={isConceded}
          isAutoConceded={isAutoConceded}
          onToggleConcede={toggleConcede}
          onReset={resetConcede}
          hasOverrides={hasConcedeOverrides}
        />
      )}

      {/* Endgame sit advisory — only when every counting cat is decided and
          a K/AVG race is live. Explains who Optimize will bench (leaving the
          slot empty) and why, straight from the same plan the optimizer
          executes, so the action and the explanation can't disagree. */}
      {!isPoints && mode === 'batting' && sitPlan.sits.length > 0 && (
        <Panel className="border-l-4 border-l-accent/70">
          <Heading as="h3" className="text-sm">Endgame: sit to flip the ratio race</Heading>
          <Text variant="caption" className="text-muted-foreground">
            Every counting category is already decided, so these bats cost more in the live K/AVG race than their production adds. Optimize will bench them and leave the slot open.
          </Text>
          <ul className="mt-2 space-y-1">
            {sitPlan.sits.map(c => (
              <li key={c.key} className="text-sm">
                <span className="font-semibold">{c.name}</span>
                {c.reasons.length > 0 && (
                  <span className="text-muted-foreground"> — {c.reasons.join(' · ')}</span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel>
        <PositionFilter mode={mode} selected={selectedPosition} onSelect={setSelectedPosition} />
      </Panel>

      {ctxError ? (
        <Panel className="p-8 text-center">
          <p className="text-sm text-error">Failed to load fantasy context</p>
        </Panel>
      ) : (
        /* Two-column layout: roster list + lineup grid */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Panel
            className="lg:col-span-2"
            title={`${selectedPosition ?? 'All'} ${listHeading}`}
            action={
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {gamesLoading && <span>Loading games...</span>}
                {gamesError && <span className="text-error">Game data unavailable</span>}
                {!isLoading && (
                  <span>
                    {mode === 'batting'
                      ? roster.filter(p => !isPitcher(p)).length
                      : roster.filter(isPitcher).length}{' '}
                    on roster
                  </span>
                )}
              </div>
            }
          >
            <RosterList
              mode={mode}
              roster={roster}
              selectedPosition={selectedPosition}
              isLoading={isLoading}
              isError={isError}
              getMatchupContext={getMatchupContext}
              getPlayerLine={getPlayerLine}
              scoredBatterCategories={scoredBatterCategories}
              categoryWeights={batterCategoryWeights}
              leagueMode={leagueMode}
              pointsScoreFor={isPoints ? pointsScoreFor : undefined}
            />
          </Panel>

          <Panel title={gridHeading}>
            <LineupGrid
              mode={mode}
              roster={roster}
              isLoading={isLoading}
              teamKey={teamKey}
              date={selectedDate}
              rosterPositions={rosterPositions}
              onSaved={() => mutateRoster()}
              getPlayerScore={gridGetPlayerScore}
              allowEmptyOnOptimize={satKeys.size > 0}
            />
          </Panel>
        </div>
      )}
    </div>
  );
}
