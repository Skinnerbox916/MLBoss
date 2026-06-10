'use client';

import { FiArrowRight } from 'react-icons/fi';
import Panel from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import Icon from '@/components/Icon';
import { Text } from '@/components/typography';
import type { SuggestedSwap } from '@/lib/points/moves';

/**
 * Shared points-league "drop → add" upgrade list. Used on /roster and the
 * points dashboard. `limit` caps the rows (dashboard shows a few; roster shows
 * all).
 */
export default function SuggestedMovesPanel({
  moves,
  limit,
}: {
  moves: { batters: SuggestedSwap[]; pitchers: SuggestedSwap[] };
  limit?: number;
}) {
  const all = [...moves.batters, ...moves.pitchers].sort((a, b) => b.gain - a.gain);
  const shown = limit ? all.slice(0, limit) : all;

  return (
    <Panel
      title="Suggested Moves"
      action={<Text as="span" variant="caption" className="text-muted-foreground">drop → add, by weekly gain</Text>}
    >
      {all.length === 0 ? (
        <Text variant="small" className="text-muted-foreground">
          No upgrades available — your roster beats the free-agent pool at every spot.
        </Text>
      ) : (
        <ul className="space-y-2">
          {shown.map((s, i) => (
            <li key={`${s.drop.name}-${s.add.name}-${i}`} className="flex items-center gap-3 rounded bg-primary/5 px-3 py-2">
              <Badge color="success">+{s.gain}</Badge>
              <div className="flex flex-1 items-center gap-2 text-sm min-w-0">
                <span className="text-muted-foreground line-through truncate">{s.drop.name}</span>
                <Icon icon={FiArrowRight} size={14} className="text-muted-foreground shrink-0" />
                <span className="font-medium text-foreground truncate">{s.add.name}</span>
              </div>
              <Badge color={s.kind === 'P' ? 'accent' : 'primary'}>{s.kind === 'P' ? 'P' : 'B'}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
