'use client';

import { useMemo, useState } from 'react';
import { FiChevronDown } from 'react-icons/fi';
import Icon from '@/components/Icon';
import Badge from '@/components/ui/Badge';
import Panel from '@/components/ui/Panel';
import ScoreBreakdownPanel from '@/components/shared/ScoreBreakdownPanel';
import { Heading } from '@/components/typography';
import { formatStatDelta } from '@/lib/formatStat';
import { STREAM_STAT_LABEL, DeltaChip } from './streamCats';
import type { TeamOffense } from '@/lib/mlb/teams';
import { tierFromScore } from '@/lib/pitching/rating';
import { tierColor } from '@/lib/pitching/display';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { Focus } from '@/lib/rating/focus';
import type { WeekPitcherScore } from '@/lib/hooks/useWeekPitcherScores';
import type { StreamPitcherCatImpact } from '@/lib/projection/streamPitcherCatImpact';
import type { PerStartProjection } from '@/lib/projection/pitcherTeam';
import type { WeekDay } from '@/lib/dashboard/weekRange';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const EMPTY_IMPACT: StreamPitcherCatImpact = { impact: 0, deltas: [] };

interface StreamCandidate {
  score: WeekPitcherScore;
  /** Probable starts in the pickup window (filtered to hasStart === true). */
  starts: PerStartProjection[];
  /** Category-impact pricing of this arm's start(s). */
  impact: StreamPitcherCatImpact;
}

type ViewMode = 'week' | 'byday';

interface StreamingBoardProps {
  weekScores: WeekPitcherScore[];
  /** statId → category-impact pricing, keyed by player_key. */
  impactByPlayer: Map<string, StreamPitcherCatImpact>;
  /** Pickup-playable window — used by the by-day grouping. */
  days: WeekDay[];
  teamOffense: Record<number, TeamOffense>;
  loading: boolean;
  scoredPitcherCategories?: EnrichedLeagueStatCategory[];
  focusMap?: Record<number, Focus>;
  categoryWeights?: Record<number, number>;
  /** Optional helper text rendered under the panel header. */
  helper?: string;
}

/**
 * Tier bands for the pitcher category-impact scalar (weighted, unit-
 * normalized net deltas — see streamPitcherCatImpact.ts). The scalar is
 * per-START normalized (one start ≈ one league-average start's output per
 * cat), so a single contested start lands near the count of contested
 * counting cats: with ~4 counting cats live, single starts cluster ~3-4
 * and a two-start week clears ~5. Bands calibrated 2026-07-21 against the
 * live distribution (n=45: max 4.4, median 3.2, p25 2.86). NOTE: because
 * the scalar scales with how many cats are contested, the bands read
 * "generous" in a heavily-contested week and "harsh" in a mostly-locked
 * one — which is the intended signal (locked pitcher cats → streaming
 * barely moves the needle). This scale is independent of the batter
 * board's (per-week normalized) — tiers are per-board by design.
 */
type ImpactTier = 'great' | 'good' | 'neutral' | 'poor';
function impactTier(impact: number): ImpactTier {
  if (impact >= 4.0) return 'great';
  if (impact >= 3.0) return 'good';
  if (impact >= 2.0) return 'neutral';
  return 'poor';
}
const TIER_LABEL: Record<ImpactTier, string> = {
  great: 'GREAT',
  good: 'GOOD',
  neutral: 'OK',
  poor: 'MARGINAL',
};
const TIER_TONE: Record<ImpactTier, string> = {
  great: 'text-success',
  good: 'text-success',
  neutral: 'text-foreground',
  poor: 'text-muted-foreground',
};

/** Chips ignore contributions this small — normalization noise. */
const MIN_CHIP_CONTRIBUTION = 0.02;

// ---------------------------------------------------------------------------
// Build candidates from week scores — ranked by contested-category impact
// ---------------------------------------------------------------------------

function buildCandidates(
  weekScores: WeekPitcherScore[],
  impactByPlayer: Map<string, StreamPitcherCatImpact>,
): StreamCandidate[] {
  const out: StreamCandidate[] = [];
  for (const score of weekScores) {
    const starts = score.projection.perStart.filter(s => s.hasStart && s.rating);
    if (starts.length === 0) continue;
    out.push({
      score,
      starts,
      impact: impactByPlayer.get(score.player.player_key) ?? EMPTY_IMPACT,
    });
  }
  out.sort((a, b) => b.impact.impact - a.impact.impact);
  return out;
}

// ---------------------------------------------------------------------------
// Day pill — compact start descriptor (DAY · vs/@ OPP · score)
// ---------------------------------------------------------------------------

/**
 * Compact chip representing one probable start. Color-coded by score.
 * In by-day view, the pill for the section's active date is highlighted
 * with the primary ring so it's obvious which start is being inspected
 * vs. "also pitches another day."
 */
function DayPill({
  start,
  isActiveDay = false,
}: {
  start: PerStartProjection;
  isActiveDay?: boolean;
}) {
  const score = start.rating?.score;
  const baseTone =
    score === undefined ? 'bg-surface-muted text-muted-foreground'
    : score >= 70 ? 'bg-success/15 text-success'
    : score >= 50 ? 'bg-surface-muted text-foreground'
    : 'bg-error/10 text-error';
  const ring = isActiveDay ? 'ring-2 ring-primary/60' : 'border border-border';
  const opp = start.opponent ?? '?';
  const arrow = start.isHome ? 'vs' : '@';
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${baseTone} ${ring}`}
      title={start.weatherFlag ? `${start.dayLabel} ${arrow} ${opp} · ${start.weatherFlag}` : `${start.dayLabel} ${arrow} ${opp}`}
    >
      <span className="text-[10px] font-bold uppercase tracking-wider">{start.dayLabel}</span>
      <span className="text-[11px] text-muted-foreground">{arrow}</span>
      <span className="text-[11px] font-semibold">{opp}</span>
      {score !== undefined && (
        <span className="text-[11px] font-bold tabular-nums">{Math.round(score)}</span>
      )}
    </span>
  );
}

function DayPills({
  starts,
  activeDate,
}: {
  starts: PerStartProjection[];
  activeDate?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {starts.map(s => (
        <DayPill key={s.date} start={s} isActiveDay={activeDate === s.date} />
      ))}
    </div>
  );
}

/** Net category-delta chips for the add's start(s), contested first
 *  (deltas arrive |contribution|-sorted). Same grammar as the batter board. */
function ImpactChips({
  impact,
  categoryWeights,
  showAll = false,
}: {
  impact: StreamPitcherCatImpact;
  categoryWeights?: Record<number, number>;
  showAll?: boolean;
}) {
  const chips = showAll
    ? impact.deltas
    : impact.deltas.filter(d => Math.abs(d.contribution) >= MIN_CHIP_CONTRIBUTION).slice(0, 3);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {chips.map(d => (
        <DeltaChip
          key={d.statId}
          delta={d}
          dimmed={showAll && (categoryWeights?.[d.statId] ?? 1) <= 0}
        />
      ))}
    </div>
  );
}

/** Headline value cell — top contested category delta + impact tier,
 *  mirroring the batter board's ScoreCell. */
function ImpactStack({ impact }: { impact: StreamPitcherCatImpact }) {
  const tier = impactTier(impact.impact);
  const tone = TIER_TONE[tier];
  const headline = impact.deltas.find(d => d.good) ?? impact.deltas[0];
  return (
    <div className="text-right leading-tight">
      <div className={`text-sm font-bold tabular-nums ${tone}`}>
        {headline
          ? `${STREAM_STAT_LABEL[headline.statId] ?? ''} ${formatStatDelta(headline.delta, STREAM_STAT_LABEL[headline.statId] ?? '')}`
          : '—'}
      </div>
      <div className={`text-caption font-semibold uppercase tracking-wide ${tone}`}>
        {TIER_LABEL[tier]}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface RowProps {
  candidate: StreamCandidate;
  rank: number;
  isExpanded: boolean;
  /** Identity the PARENT keys expansion on. Must match what its
   *  `isExpanded` check compares against — bare player_key in week view,
   *  `${date}-${player_key}` in by-day. The button toggles THIS, not a
   *  self-derived key (the by-day mismatch that silently broke expansion). */
  expandKey: string;
  onToggleExpand: (key: string) => void;
  teamOffense: Record<number, TeamOffense>;
  scoredPitcherCategories?: EnrichedLeagueStatCategory[];
  focusMap?: Record<number, Focus>;
  categoryWeights?: Record<number, number>;
  /** When set, the row is being rendered inside a by-day section. The
   *  score column shows that day's per-start score (not the week sum)
   *  and the matching day pill is highlighted. */
  activeDate?: string;
}

function Row({
  candidate, rank, isExpanded, expandKey, onToggleExpand,
  teamOffense, scoredPitcherCategories, focusMap, categoryWeights, activeDate,
}: RowProps) {
  const c = candidate;
  const startCount = c.starts.length;
  const activeStart = activeDate ? c.starts.find(s => s.date === activeDate) : undefined;

  const rowTint = impactTier(c.impact.impact) === 'great' ? 'bg-success/5' : '';

  // The pitcher's throwing hand comes from the headline start (highest-
  // scoring in week view; the active day's start in by-day view). By-day
  // also surfaces that start's matchup rating as a scouting signal.
  const refStart = activeStart ?? c.starts.reduce((best, s) =>
    (s.rating?.score ?? 0) > (best.rating?.score ?? 0) ? s : best,
    c.starts[0],
  );
  const activeScore = activeStart?.rating?.score;

  return (
    <div className={`rounded-lg overflow-hidden ${rowTint}`}>
      <button
        type="button"
        onClick={() => onToggleExpand(expandKey)}
        className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-surface-muted/40 transition-colors"
      >
        <div className="w-5 text-center text-xs font-bold text-muted-foreground mt-2.5 shrink-0">
          {rank}
        </div>

        {c.score.player.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={c.score.player.image_url}
            alt={c.score.player.name}
            className="w-9 h-9 rounded-full border border-border object-cover shrink-0 mt-0.5"
            onError={e => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <div className={`w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold ${c.score.player.image_url ? 'hidden' : ''}`}>
          {c.score.player.name.charAt(0).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate">{c.score.player.name}</span>
            {refStart.ppRef?.throws && (
              <span className={`text-[11px] font-bold ${refStart.ppRef.throws === 'L' ? 'text-accent' : 'text-primary'}`}>
                ({refStart.ppRef.throws}HP)
              </span>
            )}
            <span className="text-[11px] text-muted-foreground">
              {c.score.player.editorial_team_abbr} · {c.score.player.display_position}
            </span>
            {/* By-day scouting: how good is THIS start's matchup (0-100). */}
            {activeDate && activeScore !== undefined && (
              <span className={`text-caption font-bold ${tierColor(tierFromScore(activeScore))}`}>
                {Math.round(activeScore)}
              </span>
            )}
            {startCount >= 2 && !activeDate && (
              <Badge color="success">{startCount} starts</Badge>
            )}
            {c.score.player.ownership_type === 'waivers' && (
              <Badge color="accent">WW</Badge>
            )}
          </div>

          <DayPills starts={c.starts} activeDate={activeDate} />
          <ImpactChips impact={c.impact} />
        </div>

        <div className="shrink-0 flex items-start gap-2 mt-0.5">
          <ImpactStack impact={c.impact} />
          <Icon
            icon={FiChevronDown}
            size={16}
            className={`text-muted-foreground transition-transform mt-1.5 ${isExpanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {isExpanded && (
        <div className="space-y-1.5 px-2 pb-2">
          {/* Full net-category effect of the add (contested + conceded). */}
          {c.impact.deltas.length > 0 && (
            <div className="px-1 pt-1">
              <ImpactChips impact={c.impact} categoryWeights={categoryWeights} showAll />
            </div>
          )}
          {c.starts.map(start => {
            if (!start.gameRef || !start.ppRef) return null;
            const ctx = {
              pp: start.ppRef,
              opponentMlbId: start.opponentMlbId ?? 0,
              isHome: !!start.isHome,
              park: start.gameRef.park ?? null,
              weather: start.gameRef.weather,
              game: start.gameRef,
            };
            return (
              <div key={start.date} className="bg-surface-muted/20 rounded-lg">
                <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border/40">
                  <span className="font-semibold text-foreground">{start.dayLabel}</span>{' '}
                  {start.isHome ? 'vs' : '@'} {start.opponent ?? '?'}
                  {start.rating && (
                    <span className="ml-2">
                      Score: <span className="font-semibold text-foreground">{Math.round(start.rating.score)}</span>
                    </span>
                  )}
                </div>
                <ScoreBreakdownPanel
                  c={ctx}
                  teamOffense={teamOffense}
                  scoredCategories={scoredPitcherCategories}
                  focusMap={focusMap}
                  categoryWeights={categoryWeights}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View toggle
// ---------------------------------------------------------------------------

function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const Btn = ({ mode, label }: { mode: ViewMode; label: string }) => {
    const active = value === mode;
    return (
      <button
        type="button"
        onClick={() => onChange(mode)}
        className={`px-2 py-0.5 rounded text-caption font-semibold transition-colors ${
          active
            ? 'bg-primary text-white'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-surface-muted/60 p-0.5 border border-border">
      <Btn mode="week" label="Week" />
      <Btn mode="byday" label="By Day" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main board
// ---------------------------------------------------------------------------

export default function StreamingBoard({
  weekScores,
  impactByPlayer,
  days,
  teamOffense,
  loading,
  scoredPitcherCategories,
  focusMap,
  categoryWeights,
  helper,
}: StreamingBoardProps) {
  const candidates = useMemo(() => buildCandidates(weekScores, impactByPlayer), [weekScores, impactByPlayer]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('week');

  const toggleExpand = (key: string) => {
    setExpandedKey(prev => (prev === key ? null : key));
  };

  // By-day groups: candidates that have a start on each day, sorted by
  // that day's per-start score. Two-start pitchers naturally appear in
  // both their start dates' sections.
  const dayGroups = useMemo(() => {
    if (viewMode !== 'byday') return [];
    return days
      .map(day => {
        const dayCandidates = candidates
          .filter(c => c.starts.some(s => s.date === day.date))
          .slice()
          .sort((a, b) => {
            const aScore = a.starts.find(s => s.date === day.date)?.rating?.score ?? 0;
            const bScore = b.starts.find(s => s.date === day.date)?.rating?.score ?? 0;
            return bScore - aScore;
          });
        return { day, candidates: dayCandidates };
      })
      .filter(g => g.candidates.length > 0);
  }, [viewMode, days, candidates]);

  if (loading) {
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

  const title = viewMode === 'week' ? 'Streaming Board — Week' : 'Streaming Board — By Day';
  const summaryText = viewMode === 'week'
    ? `${candidates.length} starter${candidates.length !== 1 ? 's' : ''}`
    : `${dayGroups.length} day${dayGroups.length !== 1 ? 's' : ''} · ${candidates.length} unique starters`;

  return (
    <Panel
      title={title}
      action={
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{summaryText}</span>
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
        </div>
      }
      helper={helper}
    >
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No free agent pitchers with probable starts in the pickup window.
        </p>
      ) : viewMode === 'week' ? (
        <div className="space-y-1">
          {candidates.map((c, i) => (
            <Row
              key={c.score.player.player_key}
              candidate={c}
              rank={i + 1}
              isExpanded={expandedKey === c.score.player.player_key}
              expandKey={c.score.player.player_key}
              onToggleExpand={toggleExpand}
              teamOffense={teamOffense}
              scoredPitcherCategories={scoredPitcherCategories}
              focusMap={focusMap}
              categoryWeights={categoryWeights}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {dayGroups.map(({ day, candidates: dayCands }) => (
            <section key={day.date}>
              <Heading as="h3" className="text-caption font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-2">
                <span className="text-foreground">{day.dayLabel}</span>
                <span className="text-muted-foreground/70">·</span>
                <span>{dayCands.length} starter{dayCands.length !== 1 ? 's' : ''}</span>
              </Heading>
              <div className="space-y-1">
                {dayCands.map((c, i) => (
                  <Row
                    key={`${day.date}-${c.score.player.player_key}`}
                    candidate={c}
                    rank={i + 1}
                    isExpanded={expandedKey === `${day.date}-${c.score.player.player_key}`}
                    expandKey={`${day.date}-${c.score.player.player_key}`}
                    onToggleExpand={k => setExpandedKey(prev => (prev === k ? null : k))}
                    teamOffense={teamOffense}
                    scoredPitcherCategories={scoredPitcherCategories}
                    focusMap={focusMap}
                    categoryWeights={categoryWeights}
                    activeDate={day.date}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}
