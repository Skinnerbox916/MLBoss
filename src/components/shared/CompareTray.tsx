'use client';

import { FiX } from 'react-icons/fi';
import Icon from '@/components/Icon';
import { categoryFit, categoryFitClasses, type CategoryFit } from '@/lib/pitching/display';

/**
 * One row in the compare tray. Engine-agnostic — pitcher and batter
 * pages each construct slots from their respective rating shapes
 * before passing them in. This keeps the table layout and styling in
 * one place; only the data adapter differs per page.
 */
export interface CompareTraySlot {
  /** Unique id (typically player_key). */
  key: string;
  name: string;
  /** Short trailing context — "STL · vs CHC", "#3 · vs RHP", etc. */
  contextLine: string;
  /** Final composite score on 0-100 scale (50 = neutral). */
  score: number;
  /** Symmetric ± uncertainty band in score points. Renders only when ≥ 5. */
  scoreBand: number;
  /** Verdict label (e.g. "Strong", "Avg", "ACE"). Tier vocabulary varies
   *  by engine; the caller decides the label. */
  tierLabel: string;
  /** Tone for the score and tier text. */
  tone: 'success' | 'accent' | 'error';
  /** Per-cat sub-scores. Each cat's `score` is 0-100. */
  categories: Array<{
    /** Stable key for the React list. */
    statId: number;
    /** Display label ("K", "AVG"). */
    label: string;
    /** 0-100 normalized score for this cat. */
    score: number;
    /** weight × normalized − 0.5 (signed contribution). Used to color
     *  the cell when subScore is borderline. */
    weight: number;
    /** Pre-computed fit classification (mirrors what the row pills show). */
    fit: CategoryFit;
    /** Hover tooltip detail. */
    detail: string;
  }>;
  /** Up to 2 short risk phrases. */
  risk: string[];
}

interface CompareTrayProps {
  slots: CompareTraySlot[];
  onToggle: (key: string) => void;
  onClear: () => void;
  /** Optional title — defaults to "Compare". */
  title?: string;
}

/**
 * Side-by-side comparison table. Hidden when empty; renders one row per
 * selected player with a checkbox-removable column on the right.
 *
 * The pitcher page (StreamingBoard, TodayPitchers) and the batter page
 * (LineupManager) each construct slots from their respective ratings
 * and call the same component. The categories union is derived inside
 * the component so mixed-league rows still align.
 */
export default function CompareTray({ slots, onToggle, onClear, title = 'Compare' }: CompareTrayProps) {
  if (slots.length === 0) return null;

  // Union of categories across selected rows — usually all rows share
  // the same league cat set, but guard for mixed inputs by taking the
  // union in stable insertion order from the first row encountered.
  const labels: Array<{ statId: number; label: string }> = [];
  const seen = new Set<number>();
  for (const s of slots) {
    for (const c of s.categories) {
      if (!seen.has(c.statId)) {
        seen.add(c.statId);
        labels.push({ statId: c.statId, label: c.label });
      }
    }
  }

  return (
    <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-caption font-semibold text-primary uppercase tracking-wide">
          {title} · {slots.length}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="text-caption text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear all
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-caption">
          <thead>
            <tr className="text-muted-foreground border-b border-border-muted">
              <th className="text-left font-medium py-1 pr-3">Player</th>
              <th className="text-center font-medium py-1 px-2">Score</th>
              {labels.map(l => (
                <th key={l.statId} className="text-center font-medium py-1 px-1">{l.label}</th>
              ))}
              <th className="text-left font-medium py-1 px-2">Key risk</th>
              <th className="w-5" />
            </tr>
          </thead>
          <tbody>
            {slots.map(slot => {
              const toneClass =
                slot.tone === 'success' ? 'text-success' :
                slot.tone === 'error' ? 'text-error' :
                'text-accent';
              const byStat = new Map(slot.categories.map(c => [c.statId, c]));
              const bandPts = Math.round(slot.scoreBand);
              return (
                <tr key={slot.key} className="border-b border-border-muted/40 last:border-b-0">
                  <td className="py-1.5 pr-3 align-top">
                    <div className="font-semibold text-foreground leading-tight">{slot.name}</div>
                    <div className="text-caption text-muted-foreground leading-tight">
                      {slot.contextLine}
                    </div>
                  </td>
                  <td className="py-1.5 px-2 text-center align-top">
                    <div className={`text-base font-bold tabular-nums ${toneClass}`}>
                      {Math.round(slot.score)}
                      {bandPts >= 5 && (
                        <span className="text-caption font-medium text-muted-foreground ml-0.5">
                          ±{bandPts}
                        </span>
                      )}
                    </div>
                    <div className={`text-caption font-semibold uppercase ${toneClass}`}>
                      {slot.tierLabel}
                    </div>
                  </td>
                  {labels.map(l => {
                    const cat = byStat.get(l.statId);
                    if (!cat) {
                      return (
                        <td key={l.statId} className="py-1.5 px-1 text-center align-middle text-muted-foreground">
                          —
                        </td>
                      );
                    }
                    return (
                      <td key={l.statId} className="py-1.5 px-1 text-center align-middle">
                        <span
                          className={`inline-flex items-center justify-center min-w-[28px] px-1 py-0.5 rounded border text-caption font-mono font-semibold tabular-nums ${categoryFitClasses(cat.fit)}`}
                          title={cat.fit === 'punted'
                            ? `${cat.label} punted — ${cat.detail}`
                            : `${cat.label} ${Math.round(cat.score)}/100 · ${cat.detail}`}
                        >
                          {Math.round(cat.score)}
                        </span>
                      </td>
                    );
                  })}
                  <td className="py-1.5 px-2 align-top text-caption text-muted-foreground italic">
                    {slot.risk.length > 0 ? slot.risk.join(' · ') : '—'}
                  </td>
                  <td className="py-1.5 align-top">
                    <button
                      type="button"
                      onClick={() => onToggle(slot.key)}
                      className="text-muted-foreground hover:text-error transition-colors"
                      aria-label={`Remove ${slot.name} from compare`}
                      title="Remove from compare"
                    >
                      <Icon icon={FiX} size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Re-export for callers building slots. */
export { categoryFit };
export type { CategoryFit };
