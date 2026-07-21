'use client';

import { useCallback, useState } from 'react';
import Panel from '@/components/ui/Panel';
import Skeleton from '@/components/ui/Skeleton';
import { Text } from '@/components/typography';
import { usePointsTeam } from '@/lib/hooks/usePointsTeam';
import { useActiveLeague } from '@/lib/hooks/useActiveLeague';
import { useRosterPositions } from '@/lib/hooks/useRosterPositions';
import { optimizePitcherWeek } from '@/lib/lineup/optimizePitcherWeek';
import type { PointsPlayerRow as PitcherData } from '@/lib/points/analyzeTeam';
import PlayerRowShell from './PlayerRowShell';
import { tierStyle } from './tierStyle';

/**
 * Points pitching tab — surfaces each rostered pitcher's role, weekly starts,
 * and projected points, and (for daily-cadence leagues) an "Optimize Week"
 * button that slots every probable starter into an active pitching slot for
 * the rest of the fantasy week. Reuses the mode-agnostic `optimizePitcherWeek`
 * engine — the same one the categories Lineup pitchers tab uses; it only
 * matches arms to MLB probables and moves benched starters active, so no
 * points-specific scoring is involved. Uses the SHARED `PlayerRowShell` so the
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
  const { data, isLoading, mutate } = usePointsTeam(leagueKey, teamKey, scoringType);
  const { weekBounds, lineupCadence, earliestPlayableDate } = useActiveLeague();
  const { positions: rosterPositions } = useRosterPositions(leagueKey);
  const pitchers = (data?.pitchers ?? []).filter(p => p.owned);

  const [weekRunning, setWeekRunning] = useState(false);
  const [weekStatus, setWeekStatus] = useState<string | null>(null);

  // Per-day slotting is a daily-league concept; weekly leagues lock the whole
  // week's roster at once, so the button only shows for daily cadence.
  const canOptimize = Boolean(teamKey) && lineupCadence !== 'weekly' && rosterPositions.length > 0;

  const handleOptimizeWeek = useCallback(async () => {
    if (!teamKey) return;
    setWeekRunning(true);
    setWeekStatus('Starting…');
    try {
      const result = await optimizePitcherWeek(
        earliestPlayableDate,
        { teamKey, weekEnd: weekBounds?.end, rosterPositions },
        (dateStr, i, total) => setWeekStatus(`Optimizing ${dateStr} (${i + 1}/${total})…`),
      );
      const saved = result.days.filter(d => d.saved).length;
      const noop = result.days.filter(d => !d.saved && !d.error).length;
      const parts: string[] = [];
      if (saved > 0) parts.push(`${saved} saved`);
      if (noop > 0) parts.push(`${noop} already optimal`);
      if (result.failed > 0) parts.push(`${result.failed} failed`);
      setWeekStatus(parts.join(' · ') || 'No changes needed');
      mutate();
    } catch (e) {
      setWeekStatus(`Failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setWeekRunning(false);
    }
  }, [teamKey, earliestPlayableDate, weekBounds, rosterPositions, mutate]);

  return (
    <Panel
      title="Your pitchers"
      action={
        canOptimize ? (
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={handleOptimizeWeek}
              disabled={weekRunning}
              className="px-3 py-2 rounded-lg text-sm font-semibold bg-success/90 text-white hover:bg-success transition-colors disabled:bg-border-muted disabled:text-muted-foreground disabled:cursor-not-allowed whitespace-nowrap"
              title="Move every probable starter into an active pitching slot for each remaining day this fantasy week"
            >
              {weekRunning ? 'Optimizing…' : 'Optimize Week'}
            </button>
            {weekStatus && <Text variant="caption">{weekStatus}</Text>}
          </div>
        ) : (
          <Text as="span" variant="caption" className="text-muted-foreground font-mono">auto-start on game days</Text>
        )
      }
    >
      {isLoading && !data
        ? <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        : pitchers.length === 0
          ? <Text variant="small" className="text-muted-foreground">No active pitchers on roster.</Text>
          : <div className="space-y-1">{pitchers.map(p => <Row key={`${p.name}-${p.team}`} p={p} />)}</div>}
    </Panel>
  );
}
