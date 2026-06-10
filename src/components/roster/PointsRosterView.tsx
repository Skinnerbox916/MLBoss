'use client';

import { useState } from 'react';
import { FiTrendingUp } from 'react-icons/fi';
import Panel from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import Tabs from '@/components/ui/Tabs';
import Skeleton from '@/components/ui/Skeleton';
import Icon from '@/components/Icon';
import { Heading, Text } from '@/components/typography';
import { usePointsTeam } from '@/lib/hooks/usePointsTeam';
import SuggestedMovesPanel from '@/components/points/SuggestedMovesPanel';
import type { PointsPlayerRow, PointsVORRow } from '@/lib/points/analyzeTeam';

interface PointsRosterViewProps {
  leagueKey: string | undefined;
  teamKey: string | undefined;
  scoringType: string | undefined;
}

/**
 * Points-league /roster experience: rest-of-season player value, value over
 * replacement, and suggested roster moves. Replaces the categories
 * chase/hold/punt RosterFocusPanel + depth-chart flow when the active league
 * scores by points. Talent-neutral ROS lens (matchup-vacuum) — same horizon
 * intent as the categories roster page, just a single points objective.
 */
export default function PointsRosterView({ leagueKey, teamKey, scoringType }: PointsRosterViewProps) {
  const { data, isLoading, isError } = usePointsTeam(leagueKey, teamKey, scoringType);
  const [tab, setTab] = useState<'batters' | 'pitchers'>('batters');

  return (
    <div className="space-y-6">
      <header>
        <Heading as="h1" className="text-primary">Roster</Heading>
        <Text variant="muted">Rest-of-season value &amp; moves · points league</Text>
      </header>

      {isError && (
        <Panel>
          <Text variant="small" className="text-error">Couldn&apos;t load points analysis. Try refreshing.</Text>
        </Panel>
      )}

      {isLoading && !data && (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {data && (
        <>
          <SuggestedMovesPanel moves={data.suggestedMoves} />

          <div>
            <Tabs
              variant="segment"
              items={[{ id: 'batters', label: 'Batters' }, { id: 'pitchers', label: 'Pitchers' }]}
              value={tab}
              onChange={(v) => setTab(v as 'batters' | 'pitchers')}
            />
            <div className="mt-4">
              <ValueBoard
                rows={(tab === 'batters' ? data.batters : data.pitchers).filter(p => p.owned)}
                vor={data.rosterVOR}
                kind={tab === 'batters' ? 'B' : 'P'}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Value board
// ---------------------------------------------------------------------------

function vorTone(vor: number): string {
  if (vor > 3) return 'text-success';
  if (vor < 0) return 'text-error';
  return 'text-muted-foreground';
}

function ValueBoard({
  rows, vor, kind,
}: {
  rows: PointsPlayerRow[];
  vor: PointsVORRow[];
  kind: 'B' | 'P';
}) {
  const vorByName = new Map(vor.filter(v => v.kind === kind).map(v => [v.name, v.vor]));
  const unitLabel = kind === 'B' ? 'pts/G' : 'pts/IP';

  return (
    <Panel
      title={kind === 'B' ? 'Your Batters' : 'Your Pitchers'}
      action={<Text as="span" variant="caption" className="text-muted-foreground">{rows.length} rostered</Text>}
      noPadding
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground font-medium border-b border-border/50">
              <th className="text-left font-medium px-4 py-2">Player</th>
              <th className="text-left font-medium px-2 py-2">Pos</th>
              <th className="text-right font-medium px-2 py-2">{unitLabel}</th>
              <th className="text-right font-medium px-2 py-2">Pts / wk</th>
              <th className="text-right font-medium px-2 py-2">This wk</th>
              <th className="text-right font-medium px-4 py-2">VOR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const v = vorByName.get(p.name);
              return (
                <tr key={`${p.name}-${p.team}`} className="border-b border-border/50 hover:bg-surface-muted/50">
                  <td className="px-4 py-2">
                    <span className="font-medium text-foreground">{p.name}</span>
                    {p.injured && <Badge color="error">IL</Badge>}
                    {p.role === 'reliever' && <span className="ml-1 font-mono text-[10px] text-muted-foreground">RP</span>}
                  </td>
                  <td className="px-2 py-2 font-mono text-[10px] text-muted-foreground">
                    {p.positions.filter(x => x !== 'Util' && x !== 'BN').join(',') || (kind === 'P' ? 'P' : 'UT')}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-muted-foreground">{p.perUnit}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums font-medium text-foreground">{p.weeklyPoints}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-muted-foreground">{p.thisWeekPoints ?? '–'}</td>
                  <td className={`px-4 py-2 text-right font-mono tabular-nums font-medium ${v == null ? 'text-muted-foreground' : vorTone(v)}`}>
                    {v == null ? '–' : (v > 0 ? `+${v}` : v)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 px-4 py-2 border-t border-border/50">
        <Icon icon={FiTrendingUp} size={13} className="text-muted-foreground" />
        <Text as="span" variant="caption" className="text-muted-foreground">
          VOR = weekly points above the readily-available replacement at the position.
          Negative = freely replaceable.
        </Text>
      </div>
    </Panel>
  );
}
