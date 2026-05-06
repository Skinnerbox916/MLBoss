'use client';

import { scorePitcher, type PillInput } from '@/lib/pitching/scoring';
import {
  categoryFit, categoryFitClasses,
  type ScoredPitcherCtx,
} from '@/lib/pitching/display';
import type { TeamOffense } from '@/lib/mlb/teams';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import type { Focus } from '@/lib/mlb/batterRating';

interface ScoreBreakdownPanelProps {
  c: ScoredPitcherCtx;
  teamOffense: Record<number, TeamOffense>;
  /** Optional league-scored categories — when provided, the breakdown mirrors
   *  the row's weighting (punt cats are rendered greyed out). */
  scoredCategories?: EnrichedLeagueStatCategory[];
  /** Optional chase/punt focus per stat_id. */
  focusMap?: Record<number, Focus>;
}

/**
 * Expanded evidence panel rendered beneath a pitcher row.
 *
 * Three-section information hierarchy:
 *
 *   1. **Category Fit** — the per-category sub-scores that built the
 *      composite. Pill (label) + score (0-100) + projected stat.
 *   2. **Why** — composite-level multipliers that ACTUALLY moved the score
 *      (velocity, platoon). Skipped entirely when none are available.
 *   3. **Context** — park / weather / opp lineup. Already folded in at
 *      the per-PA layer; surfaced here so the user can see WHY the per-cat
 *      numbers landed where they did. Labelled "(already in cats above)"
 *      so the user doesn't double-count mentally.
 *
 * "Sample" row appears only when confidence is below 'high'. The score
 * band on the composite header always renders when ≥ 5 score points.
 */

// ---------------------------------------------------------------------------
// Helpers — verbal cues mirror StreamingBoard's collapsed line so the
// expanded view tells the same story in slightly more detail.
// ---------------------------------------------------------------------------

function parkLean(park: ScoredPitcherCtx['park']): string {
  if (!park) return 'No park data';
  const pf = park.parkFactor;
  const pfHr = park.parkFactorHR;
  if (pf >= 110) return 'Hitter park';
  if (pf >= 105) return 'Lean hitter';
  if (pf <= 90)  return 'Pitcher park';
  if (pf <= 95)  return 'Lean pitcher';
  if (pfHr >= 115) return `Neutral overall · HR-friendly (HR ${pfHr})`;
  if (pfHr <= 85)  return `Neutral overall · HR-suppressing (HR ${pfHr})`;
  return 'Neutral park';
}

function lineupLean(oppOps: number | null): string {
  if (oppOps === null) return 'No opponent data';
  if (oppOps >= 0.770) return 'Tough lineup';
  if (oppOps >= 0.745) return 'Lean tough';
  if (oppOps <= 0.685) return 'Soft lineup';
  if (oppOps <= 0.700) return 'Lean soft';
  return 'Average lineup';
}

export default function ScoreBreakdownPanel({
  c, teamOffense, scoredCategories, focusMap,
}: ScoreBreakdownPanelProps) {
  const oppOffense = teamOffense[c.opponentMlbId] ?? null;
  const pillInput: PillInput = {
    pp: c.pp,
    oppOffense,
    park: c.park,
    weather: c.weather,
    isHome: c.isHome,
    game: c.game,
    scoredCategories,
    focusMap,
  };
  const rating = scorePitcher(pillInput);

  // ---------------------------------------------------------------------
  // Section 2 — Why (composite-level multipliers that actually moved score)
  // ---------------------------------------------------------------------
  const whyRows: Array<{ label: string; value: string; detail: string; tone: 'pos' | 'neg' | 'neutral' }> = [];
  if (rating.velocity.available) {
    const dp = rating.velocity.deltaPct;
    whyRows.push({
      label: 'Velocity',
      value: `${dp > 0 ? '+' : ''}${dp.toFixed(1)}%`,
      detail: `${rating.velocity.display} · ${rating.velocity.summary}`,
      tone: dp >= 2 ? 'pos' : dp <= -2 ? 'neg' : 'neutral',
    });
  }
  if (rating.platoon.available) {
    const dp = rating.platoon.deltaPct;
    whyRows.push({
      label: 'Platoon',
      value: `${dp > 0 ? '+' : ''}${dp.toFixed(1)}%`,
      detail: `${rating.platoon.display} · ${rating.platoon.summary}`,
      tone: dp >= 2 ? 'pos' : dp <= -2 ? 'neg' : 'neutral',
    });
  }

  // ---------------------------------------------------------------------
  // Section 3 — Context (park / weather / opp; already in per-cat numbers)
  // ---------------------------------------------------------------------
  const contextRows: Array<{ label: string; value: string; detail: string }> = [];
  if (c.park) {
    contextRows.push({
      label: 'Park',
      value: `PF ${c.park.parkFactor}`,
      detail: parkLean(c.park),
    });
  }
  const w = c.weather;
  const hasWeather = w.condition !== null || w.temperature !== null || (w.windSpeed !== null && w.windSpeed > 0);
  if (hasWeather) {
    const parts: string[] = [];
    if (w.temperature !== null) parts.push(`${w.temperature}°F`);
    if (w.windSpeed !== null && w.windSpeed > 0 && w.windDirection) {
      parts.push(`${w.windSpeed}mph ${w.windDirection.toLowerCase()}`);
    }
    contextRows.push({
      label: 'Weather',
      value: parts.slice(0, 2).join(' · ') || (w.condition ?? '—'),
      detail: w.condition ?? 'Outdoor',
    });
  }
  const oppOpsVsHand =
    c.pp.throws === 'L' ? oppOffense?.vsLeft?.ops ?? oppOffense?.ops
    : c.pp.throws === 'R' ? oppOffense?.vsRight?.ops ?? oppOffense?.ops
    : oppOffense?.ops ?? null;
  if (oppOpsVsHand != null) {
    const handNote =
      c.pp.throws === 'L' ? 'vs LHP'
      : c.pp.throws === 'R' ? 'vs RHP'
      : 'team OPS';
    contextRows.push({
      label: 'Opp',
      value: oppOpsVsHand.toFixed(3).replace(/^0\./, '.'),
      detail: `${lineupLean(oppOpsVsHand)} · ${handNote}`,
    });
  }

  // ---------------------------------------------------------------------
  // Confidence / sample row
  // ---------------------------------------------------------------------
  const showSample = rating.confidence.level !== 'high';
  const bandPts = Math.round(rating.confidence.band);
  const bandTone = bandPts >= 10 ? 'neg' : bandPts >= 5 ? 'neutral' : 'pos';

  // Composite header score format — `53` or `53 ± 4` matching the
  // collapsed VerdictStack treatment.
  const compositeScore = Math.round(rating.score * 100);
  const showBandInHeader = bandPts >= 5;

  return (
    <div className="px-4 pb-3 pt-3 border-t border-border-muted bg-surface-muted/20 space-y-3">
      {/* ---------------- Section 1: Category Fit --------------------- */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <p className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">
            Category Fit
          </p>
          <p className="text-caption text-muted-foreground">
            Composite{' '}
            <span className="font-semibold text-foreground tabular-nums">
              {compositeScore}
            </span>
            {showBandInHeader && (
              <span className={`ml-1 tabular-nums ${bandTone === 'neg' ? 'text-error' : 'text-muted-foreground'}`}>
                ± {bandPts}
              </span>
            )}
            <span className="text-muted-foreground"> / 100</span>
          </p>
        </div>
        <div className="space-y-1">
          {rating.categories.map(cat => {
            const fit = categoryFit(cat.subScore, cat.weight);
            const isPunted = fit === 'punted';
            const score = Math.round(cat.subScore * 100);
            const weightPct = Math.round(cat.weight * 100);
            return (
              <div
                key={cat.statId}
                className="grid items-center gap-3"
                style={{ gridTemplateColumns: '64px 40px 1fr' }}
              >
                <span
                  className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded border text-caption font-semibold ${categoryFitClasses(fit)}`}
                  title={isPunted ? `${cat.label} — punted (no weight)` : `${cat.label} · weight ${weightPct}%`}
                >
                  {cat.label}
                </span>
                <span className={`text-caption font-mono text-right tabular-nums ${isPunted ? 'text-muted-foreground/60' : 'text-foreground font-semibold'}`}>
                  {score}
                </span>
                <span className={`text-caption leading-tight ${isPunted ? 'text-muted-foreground/60' : 'text-foreground'}`}>
                  {cat.detail}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------------- Section 2: Why --------------------- */}
      {whyRows.length > 0 && (
        <div>
          <p className="text-caption font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Why{' '}
            <span className="text-[10px] font-normal text-muted-foreground/70 normal-case">
              · multipliers applied to score
            </span>
          </p>
          <div className="space-y-1">
            {whyRows.map(m => {
              const toneClass =
                m.tone === 'pos' ? 'text-success' :
                m.tone === 'neg' ? 'text-error' :
                'text-muted-foreground';
              return (
                <div
                  key={m.label}
                  className="grid items-center gap-3"
                  style={{ gridTemplateColumns: '64px 56px 1fr' }}
                >
                  <span className="text-caption text-muted-foreground">{m.label}</span>
                  <span className={`text-caption font-mono text-right tabular-nums ${toneClass}`}>
                    {m.value}
                  </span>
                  <span className="text-caption text-foreground leading-tight">
                    {m.detail}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---------------- Section 3: Context --------------------- */}
      {contextRows.length > 0 && (
        <div>
          <p className="text-caption font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Context{' '}
            <span className="text-[10px] font-normal text-muted-foreground/70 normal-case">
              · already in cats above
            </span>
          </p>
          <div className="space-y-1">
            {contextRows.map(row => (
              <div
                key={row.label}
                className="grid items-center gap-3"
                style={{ gridTemplateColumns: '64px 64px 1fr' }}
              >
                <span className="text-caption text-muted-foreground">{row.label}</span>
                <span className="text-caption font-mono text-right tabular-nums text-foreground">
                  {row.value}
                </span>
                <span className="text-caption text-muted-foreground leading-tight">
                  {row.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------------- Section 4: Sample (only when not high) --------------------- */}
      {showSample && (
        <div>
          <p className="text-caption font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Sample
          </p>
          <div className="grid items-center gap-3" style={{ gridTemplateColumns: '64px 56px 1fr' }}>
            <span className="text-caption text-muted-foreground">
              {rating.confidence.level === 'medium' ? 'Medium' : 'Thin'}
            </span>
            <span className={`text-caption font-mono text-right tabular-nums ${bandTone === 'neg' ? 'text-error' : 'text-muted-foreground'}`}>
              ± {bandPts}
            </span>
            <span className="text-caption text-foreground leading-tight">
              {rating.confidence.reason}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
