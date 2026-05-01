'use client';

import { getPitcherRating, type PillInput } from '@/lib/pitching/scoring';
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
 * Split into two sections:
 *   1. Category Fit — per-category sub-score + the evidence that drove it.
 *   2. Adjustments — global multipliers (velocity, platoon, experience)
 *      shown only when they carry meaningful signal.
 *
 * This replaces the older single-list bar chart, which forced unlike things
 * (category sub-scores and global multipliers) into the same row shape and
 * left the evidence text with almost no width.
 */
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
  const rating = getPitcherRating(pillInput);

  const adjustments: Array<{ label: string; value: string; detail: string; tone: 'pos' | 'neg' | 'neutral' }> = [];
  if (rating.velocity.available) {
    const dp = rating.velocity.deltaPct;
    adjustments.push({
      label: 'Velocity',
      value: `${dp > 0 ? '+' : ''}${dp.toFixed(1)}%`,
      detail: `${rating.velocity.display} · ${rating.velocity.summary}`,
      tone: dp >= 2 ? 'pos' : dp <= -2 ? 'neg' : 'neutral',
    });
  }
  if (rating.platoon.available) {
    const dp = rating.platoon.deltaPct;
    adjustments.push({
      label: 'Platoon',
      value: `${dp > 0 ? '+' : ''}${dp.toFixed(1)}%`,
      detail: `${rating.platoon.display} · ${rating.platoon.summary}`,
      tone: dp >= 2 ? 'pos' : dp <= -2 ? 'neg' : 'neutral',
    });
  }
  if (rating.credibility.multiplier < 0.999) {
    const pct = Math.round(rating.credibility.multiplier * 100);
    adjustments.push({
      label: 'Experience',
      value: `×${pct}%`,
      detail: rating.credibility.reason,
      tone: rating.credibility.multiplier < 0.85 ? 'neg' : 'neutral',
    });
  }

  return (
    <div className="px-4 pb-3 pt-3 border-t border-border-muted bg-surface-muted/20 space-y-3">
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <p className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">
            Category Fit
          </p>
          <p className="text-caption text-muted-foreground">
            Composite <span className="font-semibold text-foreground">{(rating.score * 100).toFixed(0)}</span> / 100
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
                style={{ gridTemplateColumns: '88px 52px 1fr' }}
              >
                <span
                  className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded border text-caption font-semibold ${categoryFitClasses(fit)}`}
                  title={isPunted ? 'Punted — no weight' : `Weight ${weightPct}%`}
                >
                  {cat.label}
                </span>
                <span className={`text-caption font-mono text-right tabular-nums ${isPunted ? 'text-muted-foreground/60' : 'text-foreground'}`}>
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

      {adjustments.length > 0 && (
        <div>
          <p className="text-caption font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Adjustments
          </p>
          <div className="space-y-1">
            {adjustments.map(adj => {
              const toneClass =
                adj.tone === 'pos' ? 'text-success' :
                adj.tone === 'neg' ? 'text-error' :
                'text-muted-foreground';
              return (
                <div
                  key={adj.label}
                  className="grid items-center gap-3"
                  style={{ gridTemplateColumns: '88px 52px 1fr' }}
                >
                  <span className="text-caption text-muted-foreground">{adj.label}</span>
                  <span className={`text-caption font-mono text-right tabular-nums ${toneClass}`}>
                    {adj.value}
                  </span>
                  <span className="text-caption text-foreground leading-tight">
                    {adj.detail}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
