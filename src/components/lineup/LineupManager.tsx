'use client';

import { useState, useMemo, useCallback } from 'react';
import Panel from '@/components/ui/Panel';
import { Heading, Text } from '@/components/typography';
import { useFantasyContext } from '@/lib/hooks/useFantasyContext';
import { useRoster } from '@/lib/hooks/useRoster';
import { useRosterPositions } from '@/lib/hooks/useRosterPositions';
import { useGameDay } from '@/lib/hooks/useGameDay';
import { useRosterStats } from '@/lib/hooks/useRosterStats';
import { useLeagueCategories } from '@/lib/hooks/useLeagueCategories';
import { useMatchupAnalysis } from '@/lib/hooks/useMatchupAnalysis';
import { useSuggestedFocus } from '@/lib/hooks/useSuggestedFocus';
import { resolveMatchup, isWipedGame, type MatchupContext } from '@/lib/mlb/analysis';
import { getBatterRating } from '@/lib/mlb/batterRating';
import CategoryFocusBar from '@/components/shared/CategoryFocusBar';
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

interface LineupManagerProps {
  mode?: LineupMode;
  /**
   * When true, suppresses the outer page padding and the top-level title row.
   * Used when the manager is rendered inside a tab on the Today page.
   */
  embedded?: boolean;
}

export default function LineupManager({ mode = 'batting', embedded = false }: LineupManagerProps) {
  const { teamKey, leagueKey, isLoading: ctxLoading, isError: ctxError } = useFantasyContext();
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

  // League scoring categories → drive both the CategoryFocusBar and the
  // per-category batter rating. Only batter-side categories show up in
  // the lineup focus bar (a pitcher K category doesn't help a hitter).
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
  const { analysis: matchupAnalysis } = useMatchupAnalysis(leagueKey, teamKey);

  const batterStatIds = useMemo(() => {
    const set = new Set<number>();
    for (const c of scoredBatterCategories) set.add(c.stat_id);
    return set;
  }, [scoredBatterCategories]);
  const batterPredicate = useCallback((statId: number) => batterStatIds.has(statId), [batterStatIds]);

  const {
    focusMap,
    suggestedFocusMap,
    toggle: toggleFocus,
    reset: resetFocus,
    hasOverrides: hasFocusOverrides,
  } = useSuggestedFocus(matchupAnalysis, batterPredicate);

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
        focusMap,
        battingOrder: p.batting_order,
      });
      const dhBoost = dhTeams.has(abbr) ? DH_BOOST : 0;
      return dhBoost + rating.score / 100;
    },
    [matchupIndex, dhTeams, getPlayerLine, scoredBatterCategories, focusMap],
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
    try {
      const result = await optimizeWeek(
        start,
        {
          teamKey,
          rosterPositions,
          scoredBatterCategories,
          focusMap,
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
  }, [teamKey, mode, selectedDate, rosterPositions, scoredBatterCategories, focusMap, getPlayerLine, mutateRoster]);

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
  const weekButton = showWeekButton ? (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleOptimizeWeek}
        disabled={weekRunning}
        className="px-3 py-2 rounded-lg text-sm font-semibold bg-success/90 text-white hover:bg-success transition-colors disabled:bg-border-muted disabled:text-muted-foreground disabled:cursor-not-allowed whitespace-nowrap"
        title="Optimize lineup for every remaining day this fantasy week (Mon–Sun)"
      >
        {weekRunning ? 'Optimizing…' : 'Optimize Week'}
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

      {/* Category focus bar — only for batter mode. Defaults come from the
          matchup analysis engine (chase the close ones, punt the locked
          ones); the user's clicks override per-category and the reset
          button restores the suggestions. */}
      {mode === 'batting' && scoredBatterCategories.length > 0 && (
        <CategoryFocusBar
          categories={scoredBatterCategories}
          focusMap={focusMap}
          onToggle={toggleFocus}
          batterOnly
          title="Category Focus"
          helper="Suggested by MLBoss · click to override"
          onReset={resetFocus}
          hasOverrides={hasFocusOverrides}
          suggestedFocusMap={suggestedFocusMap}
        />
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
              focusMap={focusMap}
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
              getPlayerScore={getPlayerScore}
            />
          </Panel>
        </div>
      )}
    </div>
  );
}
