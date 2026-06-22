'use client';

import { useState } from 'react';
import Panel from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import { Text } from '@/components/typography';
import PlayerRowShell from '@/components/lineup/PlayerRowShell';
import { tierStyle, type RowTier } from '@/components/lineup/tierStyle';
import type { PointsPitcherStreamRow } from '@/lib/points/streaming';

/**
 * Points pitcher streaming board: FA/waiver arms with probable starts in the
 * pickup window, ranked by expected points. Tier tint is relative to the
 * displayed pool (top quartile / above median) — a display affordance for
 * "best available right now", not an engine constant; everything shown is
 * already the best of the FA pool, so there is no poor/bad tint here.
 */
function tierWithinPool(totalPoints: number, pool: PointsPitcherStreamRow[]): RowTier {
  const sorted = [...pool].map(r => r.totalPoints).sort((a, b) => a - b);
  if (sorted.length < 4) return 'neutral';
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
  if (totalPoints >= q(0.75)) return 'great';
  if (totalPoints >= q(0.5)) return 'good';
  return 'neutral';
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-sm font-bold text-foreground">{value}</span>
    </div>
  );
}

function Row({ p, pool }: { p: PointsPitcherStreamRow; pool: PointsPitcherStreamRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const style = tierStyle(tierWithinPool(p.totalPoints, pool));
  return (
    <PlayerRowShell
      tierBorder={style.border}
      tierBg={style.bg}
      imageUrl={p.imageUrl}
      initials={p.name.charAt(0).toUpperCase()}
      name={p.name}
      statusBadge={
        <>
          {p.starts.length >= 2 ? <Badge color="accent">2 starts</Badge> : null}
          {p.ownershipType === 'waivers' ? <Badge color="muted">W</Badge> : null}
        </>
      }
      metaText={`${p.team} · SP`}
      metaExtra={
        p.percentOwned != null ? (
          <span className="shrink-0">{Math.round(p.percentOwned)}% owned</span>
        ) : undefined
      }
      matchupLine={
        <span className="flex flex-wrap gap-1 text-[11px] font-mono text-muted-foreground">
          {p.starts.map(s => (
            <span key={s.date} className="rounded bg-surface-muted px-1.5 py-0.5" title={s.hint}>
              {s.dayLabel} {s.opp}{s.hint ? ' ·' : ''}
            </span>
          ))}
        </span>
      }
      right={
        <div className="text-right flex flex-col items-end leading-none gap-0.5">
          <span className="font-mono tabular-nums font-bold text-sm text-foreground">{p.totalPoints.toFixed(1)}</span>
          <span className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">pts wk</span>
        </div>
      }
      expanded={expanded}
      onToggle={() => setExpanded(e => !e)}
    >
      <div className="px-3 py-3 bg-surface-muted/30 border-t border-border-muted space-y-2">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {p.starts.map(s => (
            <StatCard key={s.date} label={`${s.dayLabel} ${s.opp}`} value={s.expectedPoints.toFixed(1)} />
          ))}
          <StatCard label="pts/IP" value={p.pointsPerIP.toFixed(2)} />
        </div>
        {p.starts.some(s => s.hint) && (
          <div className="text-[11px] font-mono text-muted-foreground">
            {p.starts.filter(s => s.hint).map(s => `${s.dayLabel}: ${s.hint}`).join(' · ')}
          </div>
        )}
      </div>
    </PlayerRowShell>
  );
}

export default function PointsPitcherStreamBoard({
  rows,
  isLoading,
  windowLabel,
}: {
  rows: PointsPitcherStreamRow[];
  isLoading: boolean;
  /** e.g. "next 4 days" (daily) or "next week" (weekly cadence). */
  windowLabel: string;
}) {
  return (
    <Panel
      title="Stream starts"
      action={
        <Text as="span" variant="caption" className="text-muted-foreground font-mono">
          matchup-adjusted points, {windowLabel}
        </Text>
      }
    >
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <Text variant="small" className="text-muted-foreground">
          No probable starters in the free-agent pool for this window — MLB probables thin out past
          D+3, so check back tomorrow.
        </Text>
      ) : (
        <div className="space-y-1">
          {rows.map(p => <Row key={`${p.name}-${p.team}`} p={p} pool={rows} />)}
        </div>
      )}
    </Panel>
  );
}
