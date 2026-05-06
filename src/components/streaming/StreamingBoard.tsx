'use client';

import { useMemo, useState } from 'react';
import { FiWind, FiChevronDown } from 'react-icons/fi';
import Icon from '@/components/Icon';
import Badge from '@/components/ui/Badge';
import Panel from '@/components/ui/Panel';
import ScoreBreakdownPanel from '@/components/shared/ScoreBreakdownPanel';
import CompareTray, { type CompareTraySlot } from '@/components/shared/CompareTray';
import type { FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';
import type { ProbablePitcher, ParkData, GameWeather, EnrichedGame } from '@/lib/mlb/types';
import type { TeamOffense } from '@/lib/mlb/teams';
import {
  scorePitcher, tierLabel,
  type PillInput, type PitcherStreamingRating,
} from '@/lib/pitching/scoring';
import {
  tierColor, weatherIcon, hasWeatherData,
  matchFreeAgentToGame,
  categoryFit, categoryFitClasses,
  verdictLabel, buildRiskSummary,
  parkCue, lineupCue, cueToneClass,
} from '@/lib/pitching/display';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { Focus } from '@/lib/mlb/batterRating';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StreamCandidate {
  player: FreeAgentPlayer;
  pp: ProbablePitcher;
  opponent: string;
  opponentMlbId: number;
  isHome: boolean;
  park: ParkData | null;
  weather: GameWeather;
  game: EnrichedGame;
  /** Full pitcher rating — categories + multipliers. Drives the row score,
   *  category-fit strip, and the expanded evidence panel. */
  rating: PitcherStreamingRating;
  /** Up to two short risk phrases surfaced under the row. */
  riskSummary: string[];
}

interface StreamingBoardProps {
  date: string;
  games: EnrichedGame[];
  freeAgents: FreeAgentPlayer[];
  gamesLoading: boolean;
  faLoading: boolean;
  faError: boolean;
  teamOffense: Record<number, TeamOffense>;
  offenseLoading: boolean;
  /** Optional helper text rendered under the header (e.g. data-thin day warnings). */
  helper?: string;
  /** League-scored pitcher categories — drives the per-category rating. */
  scoredPitcherCategories?: EnrichedLeagueStatCategory[];
  /** Chase/punt focus per stat_id. */
  focusMap?: Record<number, Focus>;
}

// ---------------------------------------------------------------------------
// Row subcomponents
// ---------------------------------------------------------------------------

function CategoryStrip({ rating, compact = false }: { rating: PitcherStreamingRating; compact?: boolean }) {
  if (rating.categories.length === 0) return null;
  return (
    <div className={`inline-flex items-center ${compact ? 'gap-0.5' : 'gap-1'} flex-wrap`}>
      {rating.categories.map(cat => {
        const fit = categoryFit(cat.subScore, cat.weight);
        const score = Math.round(cat.subScore * 100);
        return (
          <span
            key={cat.statId}
            className={`inline-flex items-center ${compact ? 'px-1 py-0' : 'px-1.5 py-0.5'} rounded border text-caption font-semibold ${categoryFitClasses(fit)}`}
            title={fit === 'punted'
              ? `${cat.label} punted — ${cat.detail}`
              : `${cat.label} ${score}/100 · ${cat.detail}`}
          >
            {cat.goal}
          </span>
        );
      })}
    </div>
  );
}

function VerdictStack({ rating, size = 'md' }: { rating: PitcherStreamingRating; size?: 'sm' | 'md' }) {
  const v = verdictLabel(rating.score);
  const toneClass =
    v.color === 'success' ? 'text-success' :
    v.color === 'error' ? 'text-error' :
    'text-accent';
  // Show ± uncertainty band when it's ≥ 5 score points. Tightens the
  // user's mental model for thin-sample ratings without overwhelming
  // confident scores. Wide bands (≥ 10) render in error tone to flag.
  const bandPts = Math.round(rating.scoreBand * 100);
  return (
    <div className="text-right leading-tight">
      <div className={`${size === 'md' ? 'text-lg' : 'text-base'} font-bold tabular-nums ${toneClass}`}>
        {Math.round(rating.score * 100)}
        {bandPts >= 5 && (
          <span className={`text-caption font-medium ml-0.5 ${bandPts >= 10 ? 'text-error/70' : 'text-muted-foreground'}`}>
            ±{bandPts}
          </span>
        )}
      </div>
      <div className={`text-caption font-semibold uppercase tracking-wide ${toneClass}`}>
        {v.label}
      </div>
    </div>
  );
}

function ContextLine({
  c, teamOffense,
}: {
  c: StreamCandidate;
  teamOffense: Record<number, TeamOffense>;
}) {
  const opp = teamOffense[c.opponentMlbId];
  const oppSplit = c.pp.throws === 'L' ? opp?.vsLeft : opp?.vsRight;
  const oppOps = oppSplit?.ops ?? opp?.ops ?? null;

  const opponentPhrase = `${c.isHome ? 'vs' : '@'} ${c.opponent}`;
  const park = parkCue(c.park);
  const lineup = lineupCue(oppOps);

  const windOut = c.weather.windDirection?.toLowerCase().includes('out') ?? false;
  const windBad = windOut && (c.weather.windSpeed ?? 0) >= 10;

  // The opp OPS detail (e.g. ".700") is preserved in the title attr on
  // the lineup phrase so power users can hover for the raw number; the
  // visible label is verbal.
  const lineupTitle = oppOps !== null
    ? `Opp OPS vs ${c.pp.throws}: ${oppOps.toFixed(3).replace(/^0\./, '.')}`
    : undefined;
  const parkTitle = c.park
    ? `Overall PF ${c.park.parkFactor} · HR PF ${c.park.parkFactorHR}`
    : undefined;

  return (
    <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
      <span className="text-muted-foreground">
        {opponentPhrase.split(' ')[0]}{' '}
        <span className="font-semibold text-foreground">{opponentPhrase.split(' ')[1]}</span>
      </span>
      {park.label && (
        <>
          <span className="text-border" aria-hidden>·</span>
          <span className={cueToneClass(park.tone)} title={parkTitle}>{park.label}</span>
        </>
      )}
      {lineup.label && (
        <>
          <span className="text-border" aria-hidden>·</span>
          <span className={cueToneClass(lineup.tone)} title={lineupTitle}>{lineup.label}</span>
        </>
      )}
      {hasWeatherData(c.weather) && (
        <div className="flex items-center gap-1 ml-1">
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
  );
}

// ---------------------------------------------------------------------------
// Compare tray adapter — converts StreamCandidate[] → CompareTraySlot[]
// ---------------------------------------------------------------------------

function streamSlotsFromCandidates(candidates: StreamCandidate[]): CompareTraySlot[] {
  return candidates.map(c => {
    const v = verdictLabel(c.rating.score);
    return {
      key: c.player.player_key,
      name: c.player.name,
      contextLine: `${c.player.editorial_team_abbr} · ${c.isHome ? 'vs' : '@'} ${c.opponent}`,
      score: c.rating.score * 100,
      scoreBand: c.rating.scoreBand * 100,
      tierLabel: v.label,
      tone: v.color,
      categories: c.rating.categories.map(cat => ({
        statId: cat.statId,
        label: cat.goal,
        score: cat.subScore * 100,
        weight: cat.weight,
        fit: categoryFit(cat.subScore, cat.weight),
        detail: cat.detail,
      })),
      risk: c.riskSummary,
    };
  });
}

// ---------------------------------------------------------------------------
// Main board
// ---------------------------------------------------------------------------

export default function StreamingBoard({
  date, games, freeAgents, gamesLoading, faLoading, faError,
  teamOffense, offenseLoading, helper,
  scoredPitcherCategories, focusMap,
}: StreamingBoardProps) {
  const candidates = useMemo(() => {
    if (games.length === 0 || freeAgents.length === 0) return [];
    const results: StreamCandidate[] = [];

    for (const fa of freeAgents) {
      // Hide all waiver-pool pitchers — Yahoo won't process the add until
      // they clear, so they're not actually streamable. We don't have a
      // per-player clear date from Yahoo's player-listing endpoint, so we
      // can't conditionally surface them on dates after the clear. If we
      // ever wire up the transactions endpoint to recover clear dates, this
      // can become a `waiver_date > date` check instead.
      if (fa.ownership_type === 'waivers') continue;

      const match = matchFreeAgentToGame(fa, games);
      if (!match) continue;

      const { game, pp, isHome } = match;
      const opponentTeam = isHome ? game.awayTeam : game.homeTeam;
      const oppOffense = teamOffense[opponentTeam.mlbId] ?? null;

      const pillInput: PillInput = {
        pp,
        oppOffense,
        park: game.park ?? null,
        weather: game.weather,
        isHome,
        game,
        scoredCategories: scoredPitcherCategories,
        focusMap,
      };
      const rating = scorePitcher(pillInput);
      const oppPp = isHome ? game.awayProbablePitcher : game.homeProbablePitcher;
      const ownStaffEra = (isHome ? game.homeTeam.staffEra : game.awayTeam.staffEra) ?? null;
      const riskSummary = buildRiskSummary(rating, pp, oppOffense, game.park ?? null, { oppPp, ownStaffEra });

      results.push({
        player: fa,
        pp,
        opponent: opponentTeam.abbreviation,
        opponentMlbId: opponentTeam.mlbId,
        isHome,
        park: game.park ?? null,
        weather: game.weather,
        game,
        rating,
        riskSummary,
      });
    }

    results.sort((a, b) => b.rating.score - a.rating.score);
    return results;
  }, [games, freeAgents, teamOffense, scoredPitcherCategories, focusMap]);

  const isLoading = gamesLoading || faLoading;
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [compareSet, setCompareSet] = useState<Set<string>>(() => new Set());

  const compared = useMemo(
    () => candidates.filter(c => compareSet.has(c.player.player_key)),
    [candidates, compareSet],
  );

  function toggleCompare(playerKey: string) {
    setCompareSet(prev => {
      const next = new Set(prev);
      if (next.has(playerKey)) next.delete(playerKey);
      else next.add(playerKey);
      return next;
    });
  }

  if (isLoading) {
    return (
      <Panel>
        <div className="h-4 bg-border-muted rounded w-48 mb-3 animate-pulse" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="animate-pulse flex items-center gap-3 px-3 py-2 mb-1">
            <div className="flex-1 space-y-1">
              <div className="h-3.5 bg-border-muted rounded w-40" />
              <div className="h-2.5 bg-border-muted rounded w-56" />
            </div>
            <div className="h-5 w-12 bg-border-muted rounded" />
          </div>
        ))}
      </Panel>
    );
  }

  return (
    <Panel
      title={`Streaming Board — ${date}`}
      action={
        <span className="text-xs text-muted-foreground">
          {candidates.length} starter{candidates.length !== 1 ? 's' : ''}
        </span>
      }
      helper={helper}
    >
      {offenseLoading && (
        <p className="text-xs text-muted-foreground mb-2 animate-pulse">Loading team offense data...</p>
      )}

      <CompareTray
        slots={streamSlotsFromCandidates(compared)}
        onToggle={toggleCompare}
        onClear={() => setCompareSet(new Set())}
      />

      {faError ? (
        <p className="text-sm text-error text-center py-4">Failed to load free agents</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          {freeAgents.length === 0
            ? 'No free agent data available'
            : 'No free agent pitchers with probable starts found'}
        </p>
      ) : (
        <div className="space-y-1">
          {candidates.map((c, i) => {
            const isExpanded = expandedKey === c.player.player_key;
            const isCompared = compareSet.has(c.player.player_key);
            return (
              <div key={c.player.player_key} className={`rounded-lg overflow-hidden ${isCompared ? 'ring-1 ring-primary/40' : ''} ${c.rating.score >= 0.70 ? 'bg-success/5' : c.rating.score < 0.50 ? 'bg-error/5' : ''}`}>
                <div className="flex items-stretch">
                  <label
                    className="flex items-center justify-center w-8 shrink-0 cursor-pointer hover:bg-primary/10 transition-colors"
                    title={isCompared ? 'Remove from compare' : 'Add to compare'}
                  >
                    <input
                      type="checkbox"
                      checked={isCompared}
                      onChange={() => toggleCompare(c.player.player_key)}
                      className="h-3.5 w-3.5 accent-primary cursor-pointer"
                      aria-label={`Compare ${c.player.name}`}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setExpandedKey(isExpanded ? null : c.player.player_key)}
                    className="flex-1 min-w-0 flex items-start gap-3 px-3 py-2 text-left hover:bg-surface-muted/40 transition-colors"
                  >
                    <div className="w-5 text-center text-xs font-bold text-muted-foreground mt-2.5 shrink-0">
                      {i + 1}
                    </div>

                    {c.player.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.player.image_url}
                        alt={c.player.name}
                        className="w-9 h-9 rounded-full border border-border object-cover shrink-0 mt-0.5"
                        onError={e => {
                          e.currentTarget.style.display = 'none';
                          e.currentTarget.nextElementSibling?.classList.remove('hidden');
                        }}
                      />
                    ) : null}
                    <div className={`w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold ${c.player.image_url ? 'hidden' : ''}`}>
                      {c.player.name.charAt(0).toUpperCase()}
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-semibold text-foreground truncate">{c.player.name}</span>
                        <span className={`text-[11px] font-bold ${c.pp.throws === 'L' ? 'text-accent' : 'text-primary'}`}>
                          ({c.pp.throws}HP)
                        </span>
                        <span className={`text-caption font-bold ${tierColor(c.rating.tier)}`}>
                          {tierLabel(c.rating.tier)}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {c.player.editorial_team_abbr} · {c.player.display_position}
                        </span>
                        {c.player.ownership_type === 'waivers' && (
                          <Badge color="accent">WW</Badge>
                        )}
                      </div>

                      <ContextLine c={c} teamOffense={teamOffense} />

                      <div className="flex items-center gap-2 flex-wrap">
                        <CategoryStrip rating={c.rating} />
                        {c.riskSummary.length > 0 && (
                          <span className="text-caption text-muted-foreground italic">
                            risk: {c.riskSummary.join(' · ')}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 flex items-start gap-2 mt-0.5">
                      <VerdictStack rating={c.rating} />
                      <Icon
                        icon={FiChevronDown}
                        size={16}
                        className={`text-muted-foreground transition-transform mt-1.5 ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    </div>
                  </button>
                </div>

                {isExpanded && (
                  <ScoreBreakdownPanel
                    c={c}
                    teamOffense={teamOffense}
                    scoredCategories={scoredPitcherCategories}
                    focusMap={focusMap}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
