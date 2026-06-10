'use client';

import { useState } from 'react';
import Panel from '@/components/ui/Panel';
import Skeleton from '@/components/ui/Skeleton';
import { Text } from '@/components/typography';
import { usePointsTeam } from '@/lib/hooks/usePointsTeam';
import type { PointsPlayerRow as PitcherData } from '@/lib/points/analyzeTeam';
import PlayerRowShell from './PlayerRowShell';
import { tierStyle } from './tierStyle';

/**
 * Points pitching tab — pitchers auto-start on their game days, so there's no
 * sit/start optimization; this just surfaces each rostered pitcher's role,
 * weekly starts, and projected points. Uses the SHARED `PlayerRowShell` so the
 * rows match the batters tab and the categories lineup.
 */
function Row({ p }: { p: PitcherData }) {
  const [expanded, setExpanded] = useState(false);
  const isRP = p.role === 'reliever';
  const initial = p.name.charAt(0).toUpperCase();
  return (
    <PlayerRowShell
      tierBorder={tierStyle('neutral').border}
      initials={initial}
      name={p.name}
      metaText={`${p.team} · ${isRP ? 'RP' : 'SP'}`}
      matchupLine={
        <span className="text-[11px] text-muted-foreground">
          {isRP ? 'reliever' : `${p.thisWeekStarts ?? 0} start${p.thisWeekStarts === 1 ? '' : 's'} this week`}
        </span>
      }
      right={
        <div className="text-right flex flex-col items-end leading-none gap-0.5">
          <span className="font-mono tabular-nums font-bold text-sm text-foreground">{p.thisWeekPoints ?? '–'}</span>
          <span className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">wk</span>
        </div>
      }
      expanded={expanded}
      onToggle={() => setExpanded(e => !e)}
    >
      <div className="grid grid-cols-3 gap-3 px-3 py-3 bg-surface-muted/30 border-t border-border-muted">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">pts/IP</span>
          <span className="font-mono tabular-nums text-sm font-bold text-foreground">{p.perUnit}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">this wk</span>
          <span className="font-mono tabular-nums text-sm font-bold text-foreground">{p.thisWeekPoints ?? '–'}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{isRP ? 'role' : 'starts'}</span>
          <span className="font-mono tabular-nums text-sm font-bold text-foreground">{isRP ? 'RP' : (p.thisWeekStarts ?? 0)}</span>
        </div>
      </div>
    </PlayerRowShell>
  );
}

export default function PointsPitchers({
  leagueKey, teamKey, scoringType,
}: {
  leagueKey: string | undefined;
  teamKey: string | undefined;
  scoringType: string | undefined;
}) {
  const { data, isLoading } = usePointsTeam(leagueKey, teamKey, scoringType);
  const pitchers = (data?.pitchers ?? []).filter(p => p.owned);

  return (
    <Panel
      title="Your pitchers"
      action={<Text as="span" variant="caption" className="text-muted-foreground font-mono">auto-start on game days</Text>}
    >
      {isLoading && !data
        ? <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        : pitchers.length === 0
          ? <Text variant="small" className="text-muted-foreground">No active pitchers on roster.</Text>
          : <div className="space-y-1">{pitchers.map(p => <Row key={`${p.name}-${p.team}`} p={p} />)}</div>}
    </Panel>
  );
}
