'use client';

import { useState } from 'react';
import LineupOrderPip from '@/components/ui/LineupOrderPip';
import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import type { MatchupContext } from '@/lib/mlb/analysis';
import type { BatterPointsScore } from '@/lib/points/lineupScoring';
import PlayerRowShell from './PlayerRowShell';
import { MatchupLine } from './PlayerRow';
import { tierStyle, type RowTier } from './tierStyle';
import { getRowStatus } from './types';

/**
 * Points roster-list row. Renders the SHARED `PlayerRowShell` + the SHARED
 * `MatchupLine` (same primitives as the categories `PlayerRow`), so the two
 * lineup surfaces are visually identical. Only the score column (projected
 * points), the value tier, and the expanded breakdown are points-specific.
 */
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-sm font-bold text-foreground">{value}</span>
    </div>
  );
}

export default function PointsPlayerRow({
  player,
  context,
  score,
  tier,
}: {
  player: RosterEntry;
  context: MatchupContext | null;
  score: BatterPointsScore;
  tier: RowTier;
}) {
  const [expanded, setExpanded] = useState(false);
  const out = getRowStatus(player) === 'injured';
  const style = out ? tierStyle('neutral') : tierStyle(tier);
  const initial = player.name.charAt(0).toUpperCase();

  const pip = player.batting_order ? (
    <LineupOrderPip order={player.batting_order} className="shrink-0" />
  ) : player.starting_status === 'NS' && !out ? (
    <LineupOrderPip inLineup={false} className="shrink-0" />
  ) : null;

  return (
    <PlayerRowShell
      tierBorder={style.border}
      tierBg={style.bg}
      imageUrl={player.image_url}
      initials={initial}
      dimmed={out}
      pip={pip}
      name={player.name}
      metaText={`${player.editorial_team_abbr} · ${player.eligible_positions.join(', ')}`}
      matchupLine={<MatchupLine context={context} />}
      right={
        <div className="text-right flex flex-col items-end leading-none gap-0.5">
          <span className="font-mono tabular-nums font-bold text-sm text-foreground">{score.today.toFixed(1)}</span>
          <span className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">proj</span>
        </div>
      }
      expanded={expanded}
      onToggle={() => setExpanded(e => !e)}
    >
      <div className="px-3 py-3 bg-surface-muted/30 border-t border-border-muted space-y-2">
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="today" value={score.today.toFixed(1)} />
          <StatCard label="pts/G" value={score.perGame.toFixed(1)} />
          <StatCard label="pts/wk" value={score.weekly.toFixed(0)} />
          <StatCard label="slot" value={player.selected_position} />
        </div>
        {/* Today = pts/G nudged by the matchup; show the why when it moved. */}
        {Math.abs(score.matchup.multiplier - 1) >= 0.02 && (
          <div className="flex items-baseline gap-2 text-[11px] font-mono">
            <span className={score.matchup.multiplier >= 1 ? 'text-success font-bold' : 'text-error font-bold'}>
              {score.matchup.multiplier >= 1 ? '+' : ''}{Math.round((score.matchup.multiplier - 1) * 100)}% matchup
            </span>
            {score.matchup.hint && <span className="text-muted-foreground truncate">{score.matchup.hint}</span>}
          </div>
        )}
      </div>
    </PlayerRowShell>
  );
}
