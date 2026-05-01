'use client';

import Panel from '@/components/ui/Panel';
import { formatStatValue, formatStatDelta } from '@/lib/formatStat';
import type { CategoryRank } from '@/lib/hooks/useSeasonCategoryRanks';

export type RankStripSide = 'batting' | 'pitching';

interface RankStripProps {
  title?: string;
  /** Pre-filtered ranks for the side being displayed. */
  ranks: CategoryRank[];
  isLoading?: boolean;
  /** Optional side label appended to the default title ("Batting" / "Pitching"). */
  side?: RankStripSide;
}

function rankTone(rank: number, teamCount: number): string {
  const third = Math.max(1, Math.ceil(teamCount / 3));
  if (rank <= third) return 'border-success/30 bg-success/5';
  if (rank > teamCount - third) return 'border-error/30 bg-error/5';
  return 'border-border bg-background';
}

function rankColor(rank: number, teamCount: number): string {
  const third = Math.max(1, Math.ceil(teamCount / 3));
  if (rank <= third) return 'text-success';
  if (rank > teamCount - third) return 'text-error';
  return 'text-muted-foreground';
}

/**
 * Format a z-score as "+1.2σ" / "−0.8σ" / "0σ". The unicode minus (−) keeps
 * widths consistent with the plus sign for tidy tile alignment.
 */
function formatZ(z: number): string {
  if (!Number.isFinite(z) || z === 0) return '0σ';
  const sign = z > 0 ? '+' : '−';
  return `${sign}${Math.abs(z).toFixed(1)}σ`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Horizontal per-category rank strip for the Roster page.
 *
 * Shows season-to-date league rank per category, sourced from the same
 * standings data the league page uses. Roster moves are season-long
 * decisions, so "where do I sit for the season" is the right framing —
 * and one number across surfaces beats two computations that drift apart.
 */
export default function RankStrip({
  title,
  ranks,
  isLoading = false,
  side,
}: RankStripProps) {
  const sideLabel = side === 'batting' ? 'Batting' : side === 'pitching' ? 'Pitching' : null;
  const heading = title ?? `${sideLabel ? sideLabel + ' ' : ''}League Rank`;

  if (isLoading) {
    return (
      <Panel title={heading} className="animate-pulse">
        <div className="flex gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 w-24 bg-border-muted rounded" />
          ))}
        </div>
      </Panel>
    );
  }

  if (ranks.length === 0) {
    return (
      <Panel title={heading} helper="Ranks appear once season standings are available.">
        <p className="text-xs text-muted-foreground">
          Standings data not loaded yet.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title={heading}
      action={<span className="text-caption text-muted-foreground">Season-to-date</span>}
    >
      <div className="flex flex-wrap gap-2">
        {ranks.map(r => {
          const tone = rankTone(r.myRank, r.teamCount);
          const color = rankColor(r.myRank, r.teamCount);
          // Gap-to-#1 retained in the tooltip — useful context, just not the
          // headline anymore. Z-score (positive = good, already direction-flipped
          // in the hook) tells you whether the category is closable.
          const deltaVsLeader = formatStatDelta(
            r.betterIs === 'higher' ? -r.delta : r.delta,
            r.displayName,
          );
          const tooltip = [
            `${r.displayName}: you ${formatStatValue(r.myValue, r.displayName)}`,
            `leader ${formatStatValue(r.leaderValue, r.displayName)} (${deltaVsLeader})`,
            `league avg ${formatStatValue(r.leagueMean, r.displayName)}`,
            `z-score ${formatZ(r.zScore)} (positive = above league average)`,
          ].join(' · ');
          return (
            <div
              key={r.statId}
              className={`flex flex-col items-center px-3 py-2 rounded-lg border min-w-[5.5rem] ${tone}`}
              title={tooltip}
            >
              <span className="text-xs font-medium text-muted-foreground">{r.displayName}</span>
              <span className={`text-sm font-bold ${color}`}>
                {ordinal(r.myRank)}
                <span className="text-muted-foreground font-normal"> / {r.teamCount}</span>
              </span>
              <span className={`text-caption ${color}`}>{formatZ(r.zScore)}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
