'use client';

import { useCallback, useMemo, useState } from 'react';
import { FiWind, FiChevronDown, FiAlertTriangle } from 'react-icons/fi';
import Icon from '@/components/Icon';
import Badge from '@/components/ui/Badge';
import Panel from '@/components/ui/Panel';
import CategoryFocusBar from '@/components/shared/CategoryFocusBar';
import ScoreBreakdownPanel from '@/components/shared/ScoreBreakdownPanel';
import { useFantasyContext } from '@/lib/hooks/useFantasyContext';
import { useLeagueCategories } from '@/lib/hooks/useLeagueCategories';
import { useMatchupAnalysis } from '@/lib/hooks/useMatchupAnalysis';
import { useSuggestedFocus } from '@/lib/hooks/useSuggestedFocus';
import { useRoster } from '@/lib/hooks/useRoster';
import { useGameDay } from '@/lib/hooks/useGameDay';
import { useTeamOffense } from '@/lib/hooks/useTeamOffense';
import {
  tierColor, weatherIcon, hasWeatherData, renderPitcherStatLine,
  normalizeTeamAbbr, lastNameKey, isPitcher,
  type ScoredPitcherCtx,
} from '@/lib/pitching/display';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { Focus } from '@/lib/mlb/batterRating';
import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import type { TeamOffense } from '@/lib/mlb/teams';
import { getRowStatus } from './types';

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface StarterRow extends ScoredPitcherCtx {
  rosterPlayer: RosterEntry;
  opponent: string;
}

// ---------------------------------------------------------------------------
// Starter row — expandable with matchup context
// ---------------------------------------------------------------------------

function StarterRowCard({
  s,
  index,
  teamOffense,
  expanded,
  onToggle,
  scoredCategories,
  focusMap,
}: {
  s: StarterRow;
  index: number;
  teamOffense: Record<number, TeamOffense>;
  expanded: boolean;
  onToggle: () => void;
  scoredCategories: EnrichedLeagueStatCategory[];
  focusMap: Record<number, Focus>;
}) {
  const c = s;
  const initial = s.rosterPlayer.name.charAt(0).toUpperCase();
  const opp = teamOffense[c.opponentMlbId];
  const oppSplit = c.pp.throws === 'L' ? opp?.vsLeft : opp?.vsRight;
  const oppOps = oppSplit?.ops ?? opp?.ops ?? null;
  const oppKRate = oppSplit?.strikeOutRate ?? opp?.strikeOutRate ?? null;
  const oppOpsColor =
    oppOps === null ? 'text-foreground' :
    oppOps <= 0.680 ? 'text-success font-semibold' :
    oppOps <= 0.720 ? 'text-success' :
    oppOps >= 0.800 ? 'text-error font-semibold' :
    oppOps >= 0.770 ? 'text-error' :
    'text-foreground';
  const parkFactor = c.park?.parkFactor ?? null;
  const parkHR = c.park?.parkFactorHR ?? null;
  const displayPf = parkHR !== null && parkFactor !== null
    ? (Math.abs(parkHR - 100) > Math.abs(parkFactor - 100) ? parkHR : parkFactor)
    : (parkFactor ?? parkHR);
  const pfIsHR = displayPf !== null && parkHR !== null && displayPf === parkHR && parkHR !== parkFactor;
  const pfColor =
    displayPf === null ? 'bg-surface-muted text-muted-foreground' :
    displayPf >= 110 ? 'bg-error/15 text-error font-semibold' :
    displayPf >= 104 ? 'bg-error/10 text-error' :
    displayPf <= 90 ? 'bg-success/15 text-success font-semibold' :
    displayPf <= 96 ? 'bg-success/10 text-success' :
    'bg-surface-muted text-muted-foreground';

  const slot = s.rosterPlayer.selected_position;
  const isBenched = slot === 'BN';
  const windOut = c.weather.windDirection?.toLowerCase().includes('out') ?? false;
  const windBad = windOut && (c.weather.windSpeed ?? 0) >= 10;

  return (
    <div className="rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-surface-muted/40 transition-colors"
      >
        <div className="w-5 text-center text-xs font-bold text-muted-foreground mt-2.5 shrink-0">
          {index + 1}
        </div>

        {s.rosterPlayer.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={s.rosterPlayer.image_url}
            alt={s.rosterPlayer.name}
            className="w-9 h-9 rounded-full border border-border object-cover shrink-0 mt-0.5"
            onError={e => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <div className={`w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold ${s.rosterPlayer.image_url ? 'hidden' : ''}`}>
          {initial}
        </div>

        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate">{s.rosterPlayer.name}</span>
            <span className={`text-[11px] font-bold ${c.pp.throws === 'L' ? 'text-accent' : 'text-primary'}`}>
              ({c.pp.throws}HP)
            </span>
            <span className={`text-caption font-bold ${tierColor(c.pp.quality?.tier ?? 'unknown')}`}>
              {c.pp.quality?.tier ?? 'unknown'}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {s.rosterPlayer.editorial_team_abbr} · {s.rosterPlayer.display_position}
            </span>
            <Badge color={isBenched ? 'error' : 'success'}>
              {isBenched ? 'BN' : slot}
            </Badge>
            {isBenched && (
              <span className="inline-flex items-center gap-0.5 text-caption text-error">
                <Icon icon={FiAlertTriangle} size={11} />
                starting but benched
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            <span className="text-muted-foreground">
              {c.isHome ? 'vs' : '@'}{' '}
              <span className="font-semibold text-foreground">{c.opponent}</span>
            </span>
            {oppOps !== null && (
              <>
                <span className="text-border">|</span>
                <span className="text-muted-foreground">
                  Opp (vs{c.pp.throws}) <span className={oppOpsColor}>{oppOps.toFixed(3).replace(/^0\./, '.')}</span>
                  {oppKRate !== null && (oppKRate >= 0.240 || oppKRate <= 0.185) && (
                    <span className={`ml-1 ${oppKRate >= 0.240 ? 'text-success' : 'text-error'}`}>
                      {(oppKRate * 100).toFixed(1)}% K
                    </span>
                  )}
                </span>
              </>
            )}
            <span className="text-border">|</span>
            <span
              className={`px-1.5 py-0.5 rounded text-caption ${pfColor}`}
              title={parkFactor !== null && parkHR !== null ? `Overall PF ${parkFactor} · HR PF ${parkHR}` : undefined}
            >
              {pfIsHR ? 'HR' : 'PF'} {displayPf ?? '—'}
            </span>
            {hasWeatherData(c.weather) && (
              <div className="flex items-center gap-1">
                {(() => {
                  const Wx = weatherIcon(c.weather.condition);
                  return Wx ? <Icon icon={Wx} size={12} className="text-muted-foreground" /> : null;
                })()}
                {c.weather.temperature != null && (
                  <span className="text-muted-foreground">{c.weather.temperature}°</span>
                )}
                {c.weather.windSpeed != null && c.weather.windSpeed > 0 && (
                  <span className={`flex items-center gap-0.5 ${windBad ? 'text-error' : 'text-muted-foreground'}`}>
                    <Icon icon={FiWind} size={10} />
                    {c.weather.windSpeed}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="text-[11px] text-muted-foreground">
            {renderPitcherStatLine(c.pp)}
          </div>
        </div>

        <Icon
          icon={FiChevronDown}
          size={16}
          className={`shrink-0 text-muted-foreground transition-transform mt-3 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <ScoreBreakdownPanel
          c={c}
          teamOffense={teamOffense}
          scoredCategories={scoredCategories}
          focusMap={focusMap}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Non-starter list — compact row with no matchup context
// ---------------------------------------------------------------------------

function NonStarterList({ players, emptyLabel }: { players: RosterEntry[]; emptyLabel: string }) {
  if (players.length === 0) {
    return <p className="text-xs text-muted-foreground italic py-2">{emptyLabel}</p>;
  }
  return (
    <div className="space-y-1">
      {players.map(p => {
        const isIL = getRowStatus(p) === 'injured';
        return (
          <div key={p.player_key} className="flex items-center gap-2 px-2 py-1 text-xs">
            <span className="font-medium text-foreground truncate">{p.name}</span>
            <span className="text-caption text-muted-foreground">
              {p.editorial_team_abbr} · {p.display_position}
            </span>
            {p.status && <Badge color={isIL ? 'error' : 'accent'}>{p.status}</Badge>}
            <span className="text-caption text-muted-foreground ml-auto">{p.selected_position}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface TodayPitchersProps {
  teamKey: string | undefined;
  /** ISO date (YYYY-MM-DD). Defaults to today. */
  date: string;
}

export default function TodayPitchers({ teamKey, date }: TodayPitchersProps) {
  const { leagueKey } = useFantasyContext();
  const { roster, isLoading: rosterLoading } = useRoster(teamKey, date);
  const { games, isLoading: gamesLoading } = useGameDay(date);

  // Pitcher-side focus mirrors the streaming page: defaults from
  // `analyzeMatchup`, user can override per-pill or reset. Plumbing this
  // through `ScoreBreakdownPanel` is what keeps the same SP from getting a
  // different score on Today vs. Streaming. See `docs/recommendation-system.md`.
  const { categories: leagueCategories } = useLeagueCategories(leagueKey);
  const scoredPitcherCategories = useMemo(
    () => leagueCategories.filter(c => c.is_pitcher_stat),
    [leagueCategories],
  );
  const { analysis: matchupAnalysis } = useMatchupAnalysis(leagueKey, teamKey);
  const pitcherStatIds = useMemo(() => {
    const set = new Set<number>();
    for (const c of scoredPitcherCategories) set.add(c.stat_id);
    return set;
  }, [scoredPitcherCategories]);
  const pitcherPredicate = useCallback(
    (statId: number) => pitcherStatIds.has(statId),
    [pitcherStatIds],
  );
  const {
    focusMap,
    suggestedFocusMap,
    toggle: toggleFocus,
    reset: resetFocus,
    hasOverrides: hasFocusOverrides,
  } = useSuggestedFocus(matchupAnalysis, pitcherPredicate);

  const opposingTeamIds = useMemo(() => {
    const ids = new Set<number>();
    for (const g of games) {
      ids.add(g.homeTeam.mlbId);
      ids.add(g.awayTeam.mlbId);
    }
    return Array.from(ids);
  }, [games]);

  const { teams: teamOffense, isLoading: offenseLoading } = useTeamOffense(opposingTeamIds);

  const pitchers = useMemo(() => roster.filter(isPitcher), [roster]);

  // Match each rostered pitcher to today's probable-pitcher slot on their team.
  const starters = useMemo<StarterRow[]>(() => {
    if (games.length === 0) return [];
    const results: StarterRow[] = [];

    for (const pitcher of pitchers) {
      const abbr = normalizeTeamAbbr(pitcher.editorial_team_abbr);
      for (const g of games) {
        const homeAbbr = normalizeTeamAbbr(g.homeTeam.abbreviation);
        const awayAbbr = normalizeTeamAbbr(g.awayTeam.abbreviation);
        const isHome = homeAbbr === abbr;
        const isAway = awayAbbr === abbr;
        if (!isHome && !isAway) continue;

        const pp = isHome ? g.homeProbablePitcher : g.awayProbablePitcher;
        if (!pp) continue;

        const ppLast = lastNameKey(pp.name);
        const rosterLast = lastNameKey(pitcher.name);
        if (!ppLast || ppLast !== rosterLast) continue;

        const opponentTeam = isHome ? g.awayTeam : g.homeTeam;
        results.push({
          rosterPlayer: pitcher,
          pp,
          opponent: opponentTeam.abbreviation,
          opponentMlbId: opponentTeam.mlbId,
          isHome,
          park: g.park ?? null,
          weather: g.weather,
          game: g,
        });
        break;
      }
    }
    return results;
  }, [pitchers, games]);

  const starterIds = new Set(starters.map(s => s.rosterPlayer.player_key));
  const nonStarters = pitchers.filter(p => !starterIds.has(p.player_key));

  const activeNonStarters = nonStarters.filter(p => getRowStatus(p) === 'starter');
  const benchNonStarters = nonStarters.filter(p => getRowStatus(p) === 'bench');
  const injuredPitchers = nonStarters.filter(p => getRowStatus(p) === 'injured');

  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const isLoading = rosterLoading || gamesLoading;

  return (
    <div className="space-y-4">
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

      <Panel
        title="Starting Today"
        action={
          <span className="text-xs text-muted-foreground">
            {starters.length} starter{starters.length !== 1 ? 's' : ''}
          </span>
        }
      >
        {offenseLoading && (
          <p className="text-xs text-muted-foreground mb-2 animate-pulse">Loading team offense data...</p>
        )}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse flex items-center gap-3 px-3 py-2">
                <div className="flex-1 space-y-1">
                  <div className="h-3.5 bg-border-muted rounded w-40" />
                  <div className="h-2.5 bg-border-muted rounded w-56" />
                </div>
              </div>
            ))}
          </div>
        ) : starters.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            {pitchers.length === 0
              ? 'No pitchers on roster'
              : 'None of your pitchers are confirmed starters today'}
          </p>
        ) : (
          <div className="space-y-1">
            {starters.map((s, i) => (
              <StarterRowCard
                key={s.rosterPlayer.player_key}
                s={s}
                index={i}
                teamOffense={teamOffense}
                expanded={expandedKey === s.rosterPlayer.player_key}
                onToggle={() =>
                  setExpandedKey(expandedKey === s.rosterPlayer.player_key ? null : s.rosterPlayer.player_key)
                }
                scoredCategories={scoredPitcherCategories}
                focusMap={focusMap}
              />
            ))}
          </div>
        )}
      </Panel>

      {(activeNonStarters.length > 0 || benchNonStarters.length > 0 || injuredPitchers.length > 0) && (
        <Panel title="Not Starting Today">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-caption text-muted-foreground uppercase tracking-wider mb-1">
                Active
              </p>
              <NonStarterList players={activeNonStarters} emptyLabel="None" />
            </div>
            <div>
              <p className="text-caption text-muted-foreground uppercase tracking-wider mb-1">
                Bench
              </p>
              <NonStarterList players={benchNonStarters} emptyLabel="None" />
            </div>
            <div>
              <p className="text-caption text-muted-foreground uppercase tracking-wider mb-1">
                Injured
              </p>
              <NonStarterList players={injuredPitchers} emptyLabel="None" />
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
