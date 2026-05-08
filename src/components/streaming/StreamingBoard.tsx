'use client';

import { useMemo, useState } from 'react';
import { FiChevronDown } from 'react-icons/fi';
import Icon from '@/components/Icon';
import Badge from '@/components/ui/Badge';
import Panel from '@/components/ui/Panel';
import ScoreBreakdownPanel from '@/components/shared/ScoreBreakdownPanel';
import type { TeamOffense } from '@/lib/mlb/teams';
import { tierFromScore } from '@/lib/pitching/rating';
import { tierLabel } from '@/lib/pitching/scoring';
import { categoryFit, categoryFitClasses, tierColor } from '@/lib/pitching/display';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { Focus } from '@/lib/mlb/batterRating';
import type { WeekPitcherScore } from '@/lib/hooks/useWeekPitcherScores';
import type { PerStartProjection } from '@/lib/projection/pitcherTeam';
import type { WeekDay } from '@/lib/dashboard/weekRange';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StreamCandidate {
  score: WeekPitcherScore;
  /** Probable starts in the pickup window (filtered to hasStart === true). */
  starts: PerStartProjection[];
}

type ViewMode = 'week' | 'byday';

interface StreamingBoardProps {
  weekScores: WeekPitcherScore[];
  /** Pickup-playable window — used by the by-day grouping. */
  days: WeekDay[];
  teamOffense: Record<number, TeamOffense>;
  loading: boolean;
  scoredPitcherCategories?: EnrichedLeagueStatCategory[];
  focusMap?: Record<number, Focus>;
  /** Optional helper text rendered under the panel header. */
  helper?: string;
}

// ---------------------------------------------------------------------------
// Build candidates from week scores
// ---------------------------------------------------------------------------

function buildCandidates(weekScores: WeekPitcherScore[]): StreamCandidate[] {
  const out: StreamCandidate[] = [];
  for (const score of weekScores) {
    const starts = score.projection.perStart.filter(s => s.hasStart && s.rating);
    if (starts.length === 0) continue;
    out.push({ score, starts });
  }
  out.sort((a, b) => b.score.projection.weeklyScore - a.score.projection.weeklyScore);
  return out;
}

// ---------------------------------------------------------------------------
// Verdict label
// ---------------------------------------------------------------------------

interface Verdict {
  label: string;
  tone: 'success' | 'accent' | 'error';
}

/** Map a per-start score (0-100) to the same Strong/Fair/Avoid verdict
 *  used in week view. The week-view divides weeklyScore by start count
 *  before classifying — this is the per-start band directly. */
function perStartVerdict(score: number): Verdict {
  if (score >= 70) return { label: 'Strong', tone: 'success' };
  if (score >= 50) return { label: 'Fair', tone: 'accent' };
  return { label: 'Avoid', tone: 'error' };
}

// ---------------------------------------------------------------------------
// Aggregated category strip — averages per-cat fit across the row's starts
// ---------------------------------------------------------------------------

function aggregateCategoryFit(starts: PerStartProjection[]): Array<{
  statId: number;
  label: string;
  avgSubScore: number;
  weight: number;
}> {
  if (starts.length === 0) return [];
  const acc = new Map<number, { label: string; sumSub: number; sumWeight: number; n: number }>();
  for (const s of starts) {
    if (!s.rating) continue;
    for (const cat of s.rating.categories) {
      const prior = acc.get(cat.statId);
      if (prior) {
        prior.sumSub += cat.normalized;
        prior.sumWeight += cat.weight;
        prior.n += 1;
      } else {
        acc.set(cat.statId, {
          label: cat.label,
          sumSub: cat.normalized,
          sumWeight: cat.weight,
          n: 1,
        });
      }
    }
  }
  return Array.from(acc.entries()).map(([statId, v]) => ({
    statId,
    label: v.label,
    avgSubScore: v.n > 0 ? v.sumSub / v.n : 0,
    weight: v.n > 0 ? v.sumWeight / v.n : 0,
  }));
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

function CategoryStrip({ starts }: { starts: PerStartProjection[] }) {
  const cats = useMemo(() => aggregateCategoryFit(starts), [starts]);
  if (cats.length === 0) return null;
  return (
    <div className="inline-flex items-center gap-1 flex-wrap">
      {cats.map(cat => {
        const fit = categoryFit(cat.avgSubScore, cat.weight);
        const score = Math.round(cat.avgSubScore * 100);
        return (
          <span
            key={cat.statId}
            className={`inline-flex items-center px-1.5 py-0.5 rounded border text-caption font-semibold ${categoryFitClasses(fit)}`}
            title={fit === 'punted'
              ? `${cat.label} punted`
              : `${cat.label} avg ${score}/100 across ${starts.length} start${starts.length === 1 ? '' : 's'}`}
          >
            {cat.label}
          </span>
        );
      })}
    </div>
  );
}

function VerdictStack({ score, label, tone }: { score: number; label: string; tone: Verdict['tone'] }) {
  const toneClass =
    tone === 'success' ? 'text-success' :
    tone === 'error' ? 'text-error' :
    'text-accent';
  return (
    <div className="text-right leading-tight">
      <div className={`text-lg font-bold tabular-nums ${toneClass}`}>{Math.round(score)}</div>
      <div className={`text-caption font-semibold uppercase tracking-wide ${toneClass}`}>
        {label}
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
  onToggleExpand: (key: string) => void;
  teamOffense: Record<number, TeamOffense>;
  scoredPitcherCategories?: EnrichedLeagueStatCategory[];
  focusMap?: Record<number, Focus>;
  /** When set, the row is being rendered inside a by-day section. The
   *  score column shows that day's per-start score (not the week sum)
   *  and the matching day pill is highlighted. */
  activeDate?: string;
}

function Row({
  candidate, rank, isExpanded, onToggleExpand,
  teamOffense, scoredPitcherCategories, focusMap, activeDate,
}: RowProps) {
  const c = candidate;
  const startCount = c.starts.length;
  const activeStart = activeDate ? c.starts.find(s => s.date === activeDate) : undefined;

  // Score + verdict + tier — by-day view uses the active day's per-start
  // score; week view uses the per-start average for tier color but
  // displays the summed weekly score.
  const weeklyScore = c.score.projection.weeklyScore;
  const headlineScore =
    activeStart?.rating?.score ?? (startCount > 0 ? weeklyScore / startCount : 0);
  const displayScore = activeStart?.rating?.score ?? weeklyScore;
  const verdict = perStartVerdict(headlineScore);
  const rowTint =
    headlineScore >= 70 ? 'bg-success/5'
    : headlineScore < 50 ? 'bg-error/5'
    : '';

  // The pitcher's throwing hand and tier come from the headline start
  // (highest-scoring start when in week view; the active day's start
  // when in by-day view).
  const refStart = activeStart ?? c.starts.reduce((best, s) =>
    (s.rating?.score ?? 0) > (best.rating?.score ?? 0) ? s : best,
    c.starts[0],
  );

  return (
    <div className={`rounded-lg overflow-hidden ${rowTint}`}>
      <button
        type="button"
        onClick={() => onToggleExpand(c.score.player.player_key)}
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
            <span className={`text-caption font-bold ${tierColor(tierFromScore(headlineScore))}`}>
              {tierLabel(tierFromScore(headlineScore))}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {c.score.player.editorial_team_abbr} · {c.score.player.display_position}
            </span>
            {startCount >= 2 && !activeDate && (
              <Badge color="success">{startCount} starts</Badge>
            )}
            {c.score.player.ownership_type === 'waivers' && (
              <Badge color="accent">WW</Badge>
            )}
          </div>

          <DayPills starts={c.starts} activeDate={activeDate} />
          <CategoryStrip starts={c.starts} />
        </div>

        <div className="shrink-0 flex items-start gap-2 mt-0.5">
          <VerdictStack score={displayScore} label={verdict.label} tone={verdict.tone} />
          <Icon
            icon={FiChevronDown}
            size={16}
            className={`text-muted-foreground transition-transform mt-1.5 ${isExpanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {isExpanded && (
        <div className="space-y-1.5 px-2 pb-2">
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
              <div key={start.date} className="bg-surface-muted/20 rounded-md">
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
    <div className="inline-flex items-center gap-0.5 rounded-md bg-surface-muted/60 p-0.5 border border-border">
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
  days,
  teamOffense,
  loading,
  scoredPitcherCategories,
  focusMap,
  helper,
}: StreamingBoardProps) {
  const candidates = useMemo(() => buildCandidates(weekScores), [weekScores]);
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
              onToggleExpand={toggleExpand}
              teamOffense={teamOffense}
              scoredPitcherCategories={scoredPitcherCategories}
              focusMap={focusMap}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {dayGroups.map(({ day, candidates: dayCands }) => (
            <section key={day.date}>
              <h3 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-2">
                <span className="text-foreground">{day.dayLabel}</span>
                <span className="text-muted-foreground/70">·</span>
                <span>{dayCands.length} starter{dayCands.length !== 1 ? 's' : ''}</span>
              </h3>
              <div className="space-y-1">
                {dayCands.map((c, i) => (
                  <Row
                    key={`${day.date}-${c.score.player.player_key}`}
                    candidate={c}
                    rank={i + 1}
                    isExpanded={expandedKey === `${day.date}-${c.score.player.player_key}`}
                    onToggleExpand={k => setExpandedKey(prev => (prev === k ? null : k))}
                    teamOffense={teamOffense}
                    scoredPitcherCategories={scoredPitcherCategories}
                    focusMap={focusMap}
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
