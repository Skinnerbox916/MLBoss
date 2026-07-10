'use client';

import Link from 'next/link';
import { FiRepeat } from 'react-icons/fi';
import Panel from '@/components/ui/Panel';
import Icon from '@/components/Icon';
import { Text } from '@/components/typography';
import { usePointsWeekMoves } from '@/lib/hooks/usePointsWeekMoves';

/**
 * Dashboard tile: the week-moves board's top move, linking to /streaming.
 * Renders nothing while loading or empty — the dashboard shouldn't block on
 * the streaming engine's cold-cache fan-out; the fetch this triggers warms
 * the cache for the streaming page instead.
 */
export default function TopWeekMoveTile() {
  const { board, movesBudget } = usePointsWeekMoves();
  const top = board.moves[0];
  if (!top) return null;

  return (
    <Panel
      title="Top move this week"
      action={
        movesBudget?.left != null ? (
          <Text as="span" variant="caption" className="text-muted-foreground font-mono">
            {movesBudget.left} move{movesBudget.left === 1 ? '' : 's'} left
          </Text>
        ) : undefined
      }
    >
      <Link
        href="/streaming"
        className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-surface-muted/50 transition-colors"
      >
        <Icon icon={FiRepeat} size={18} className="text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <Text as="span" className="font-medium text-foreground">
            {top.add.name}
          </Text>
          <div className="flex flex-wrap items-center gap-1 text-[11px] font-mono text-muted-foreground">
            {top.drop ? (
              <span className="text-error/80">drop {top.drop.name}</span>
            ) : (
              <span className="text-accent">open slot</span>
            )}
            {top.dayChips.map(c => (
              <span key={c.date} className="rounded bg-surface-muted px-1.5 py-0.5">{c.dayName}</span>
            ))}
          </div>
        </div>
        <span className="font-mono tabular-nums font-bold text-sm text-success shrink-0">
          +{top.net.toFixed(1)}
        </span>
      </Link>
    </Panel>
  );
}
