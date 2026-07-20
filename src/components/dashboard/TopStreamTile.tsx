'use client';

import Link from 'next/link';
import { FiRepeat } from 'react-icons/fi';
import Panel from '@/components/ui/Panel';
import Icon from '@/components/Icon';
import { Text } from '@/components/typography';
import { useTopWeekStream } from '@/lib/hooks/useTopWeekStream';
import { useMovesBudget } from '@/lib/hooks/useMovesBudget';
import { useActiveLeague } from '@/lib/hooks/useActiveLeague';

/**
 * Categories dashboard tile: the streaming board's #1 batter pickup,
 * linking to /streaming — the categories twin of the points
 * `TopWeekMoveTile` (same "Top move this week" grammar, mode-native
 * value units). Renders nothing while loading or empty; the fetches it
 * triggers warm the streaming page's caches.
 */
export default function TopStreamTile({ className }: { className?: string }) {
  const { leagueKey, teamKey } = useActiveLeague();
  const { top } = useTopWeekStream();
  const { data: budget } = useMovesBudget(leagueKey, teamKey);
  if (!top) return null;

  const playDays = top.perDay.filter(d => d.delta > 0);

  return (
    <Panel
      className={className}
      title="Top move this week"
      action={
        budget?.left != null ? (
          <Text as="span" variant="caption" className="text-muted-foreground font-mono">
            {budget.left} move{budget.left === 1 ? '' : 's'} left
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
            {top.player.name}
          </Text>
          <div className="flex flex-wrap items-center gap-1 text-[11px] font-mono text-muted-foreground">
            <span>{top.player.editorial_team_abbr} · {top.player.display_position}</span>
            {playDays.map(d => (
              <span key={d.date} className="rounded bg-surface-muted px-1.5 py-0.5">
                {d.dayLabel}{d.assignedSlot ? ` ${d.assignedSlot}` : ''}
              </span>
            ))}
          </div>
        </div>
        <span
          className="font-mono tabular-nums font-bold text-sm text-success shrink-0"
          title="Slot-aware streaming value — starter-score gain over your current roster across the pickup window"
        >
          +{top.streamingValue.toFixed(1)}
        </span>
      </Link>
    </Panel>
  );
}
