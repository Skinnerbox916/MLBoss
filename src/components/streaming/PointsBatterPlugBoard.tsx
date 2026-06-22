'use client';

import { useState } from 'react';
import Panel from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import { Text } from '@/components/typography';
import PlayerRowShell from '@/components/lineup/PlayerRowShell';
import { tierStyle, pointsTierForPerGame } from '@/components/lineup/tierStyle';
import type { PointsBatterPlugRow } from '@/lib/points/streaming';
import type { LineupCadence } from '@/lib/fantasy/scoringMode';

/**
 * Points batter plug board: FA/waiver bats ranked by the marginal points they
 * add to the optimal lineup across the pickup window. The gain is exact (the
 * engine re-solves the lineup with the bat added), so an open-slot fill shows
 * the bat's full day value while an upgrade over a current starter shows only
 * the delta. Tier tint reuses the shipped per-game anchor from the points
 * lineup page.
 *
 * Weekly cadence: the headline gain is one week-sum lineup marginal, and the
 * chips show the bat's game days (his expected points each day, not
 * marginals) — schedule density is the thing to compare.
 */
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-sm font-bold text-foreground">{value}</span>
    </div>
  );
}

function Row({ p, cadence }: { p: PointsBatterPlugRow; cadence: LineupCadence }) {
  const [expanded, setExpanded] = useState(false);
  const style = tierStyle(pointsTierForPerGame(p.perGame));
  const batPositions = p.positions.filter(x => x !== 'Util' && x !== 'IL' && x !== 'BN');
  // Daily: marginal gain per plug day (+). Weekly: the bat's own expected
  // points on each game day — the net gain lives in the right column only.
  const chips = cadence === 'weekly' ? (p.gameDays ?? []) : p.plugDays;
  const chipText = (d: { dayLabel: string; gain: number }) =>
    cadence === 'weekly' ? `${d.dayLabel} ${d.gain.toFixed(1)}` : `${d.dayLabel} +${d.gain.toFixed(1)}`;
  return (
    <PlayerRowShell
      tierBorder={style.border}
      tierBg={style.bg}
      imageUrl={p.imageUrl}
      initials={p.name.charAt(0).toUpperCase()}
      name={p.name}
      statusBadge={p.ownershipType === 'waivers' ? <Badge color="muted">W</Badge> : undefined}
      metaText={`${p.team} · ${batPositions.join(', ') || p.positions.join(', ')}`}
      metaExtra={
        p.percentOwned != null ? (
          <span className="shrink-0">{Math.round(p.percentOwned)}% owned</span>
        ) : undefined
      }
      matchupLine={
        <span className="flex flex-wrap gap-1 text-[11px] font-mono text-muted-foreground">
          {chips.map(d => (
            <span key={d.date} className="rounded bg-surface-muted px-1.5 py-0.5" title={d.hint}>
              {chipText(d)}{d.hint ? ' ·' : ''}
            </span>
          ))}
        </span>
      }
      right={
        <div className="text-right flex flex-col items-end leading-none gap-0.5">
          <span className="font-mono tabular-nums font-bold text-sm text-foreground">+{p.totalGain.toFixed(1)}</span>
          <span className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">pts wk</span>
        </div>
      }
      expanded={expanded}
      onToggle={() => setExpanded(e => !e)}
    >
      <div className="grid grid-cols-3 gap-3 px-3 py-3 bg-surface-muted/30 border-t border-border-muted sm:grid-cols-4">
        {chips.map(d => (
          <StatCard key={d.date} label={d.dayLabel} value={cadence === 'weekly' ? d.gain.toFixed(1) : `+${d.gain.toFixed(1)}`} />
        ))}
        <StatCard label="pts/G" value={p.perGame.toFixed(1)} />
      </div>
    </PlayerRowShell>
  );
}

export default function PointsBatterPlugBoard({
  rows,
  isLoading,
  openSlotDays,
  cadence,
}: {
  rows: PointsBatterPlugRow[];
  isLoading: boolean;
  openSlotDays: number;
  cadence: LineupCadence;
}) {
  const weekly = cadence === 'weekly';
  return (
    <Panel
      title={weekly ? 'Best bats for next week' : 'Plug the open days'}
      action={
        <Text as="span" variant="caption" className="text-muted-foreground font-mono">
          {weekly ? "by net points added to next week's locked lineup" : 'by points added to your optimal lineup'}
        </Text>
      }
    >
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <Text variant="small" className="text-muted-foreground">
          {weekly
            ? 'No free-agent bat projects to out-produce your locked-in starters next week — spend moves on pitcher starts instead.'
            : openSlotDays === 0
              ? 'Your lineup is covered every day this window, and no free agent outhits your current bats — spend moves on pitcher starts instead.'
              : 'No free-agent bat adds meaningful points over your current lineup this window.'}
        </Text>
      ) : (
        <div className="space-y-1">
          {rows.map(p => <Row key={`${p.name}-${p.team}`} p={p} cadence={cadence} />)}
        </div>
      )}
    </Panel>
  );
}
