'use client';

import { FiArrowRight } from 'react-icons/fi';
import Panel from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import Icon from '@/components/Icon';
import { Text } from '@/components/typography';
import type { SuggestedSwap } from '@/lib/points/moves';
import type { PointsBatterMove } from '@/lib/points/rosterStrategy';

/**
 * Compact points-league "drop → add" upgrade list — the dashboard's
 * at-a-glance view. Batter rows come from the position-aware swap engine
 * (`batterMoves`); pitcher rows from the greedy value swaps. The roster
 * page renders batter moves with the full shared `RosterMoveCard`
 * treatment instead; this stays the summary form.
 */
interface CompactMove {
  gain: number;
  dropName: string | null;
  addName: string;
  kind: 'B' | 'P';
}

export default function SuggestedMovesPanel({
  batterMoves = [],
  pitcherMoves = [],
  limit,
}: {
  batterMoves?: PointsBatterMove[];
  pitcherMoves?: SuggestedSwap[];
  limit?: number;
}) {
  const all: CompactMove[] = [
    ...batterMoves.map(m => ({
      gain: m.netValue,
      dropName: m.drop?.name ?? null,
      addName: m.add.name,
      kind: 'B' as const,
    })),
    ...pitcherMoves.map(s => ({
      gain: s.gain,
      dropName: s.drop.name,
      addName: s.add.name,
      kind: 'P' as const,
    })),
  ].sort((a, b) => b.gain - a.gain);
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
            <li key={`${s.dropName ?? 'open'}-${s.addName}-${i}`} className="flex items-center gap-3 rounded bg-primary/5 px-3 py-2">
              <Badge color="success">+{s.gain}</Badge>
              <div className="flex flex-1 items-center gap-2 text-sm min-w-0">
                {s.dropName ? (
                  <span className="text-muted-foreground line-through truncate">{s.dropName}</span>
                ) : (
                  <span className="text-caption text-accent uppercase tracking-wide">open slot</span>
                )}
                <Icon icon={FiArrowRight} size={14} className="text-muted-foreground shrink-0" />
                <span className="font-medium text-foreground truncate">{s.addName}</span>
              </div>
              <Badge color={s.kind === 'P' ? 'accent' : 'primary'}>{s.kind === 'P' ? 'P' : 'B'}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
