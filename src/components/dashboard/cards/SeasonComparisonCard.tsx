'use client';

import { useState } from 'react';
import { FiBarChart } from 'react-icons/fi';
import DashboardCard from '@/components/dashboard/DashboardCard';
import Tabs from '@/components/ui/Tabs';
import { useFantasy } from '../FantasyProvider';
import { useScoreboard } from '@/lib/hooks/useScoreboard';
import { useTeamStats } from '@/lib/hooks/useTeamStats';
import { useLeagueCategories } from '@/lib/hooks/useLeagueCategories';
import { parseIPToOuts } from '@/lib/utils';
import { Text } from '@/components/typography';
import { formatStatDelta } from '@/lib/formatStat';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';

interface CategoryRow {
  label: string;
  delta: number;
  relDelta: number;
  winning: boolean | null;
  deltaStr: string;
  hasData: boolean;
}

function placeholderRow(label: string): CategoryRow {
  return { label, delta: 0, relDelta: 0, winning: null, deltaStr: '—', hasData: false };
}

function buildRows(
  cats: EnrichedLeagueStatCategory[],
  myMap: Map<number, string>,
  oppMap: Map<number, string>,
): CategoryRow[] {
  return cats.map(cat => {
    const myRaw = myMap.get(cat.stat_id);
    const oppRaw = oppMap.get(cat.stat_id);
    if (myRaw === undefined || oppRaw === undefined) return placeholderRow(cat.display_name);

    if (cat.stat_id === 50) {
      const myOuts = parseIPToOuts(myRaw);
      const oppOuts = parseIPToOuts(oppRaw);
      const outsDelta = myOuts - oppOuts;
      const maxOuts = Math.max(Math.abs(myOuts), Math.abs(oppOuts), 1);
      const sign = outsDelta > 0 ? '+' : outsDelta < 0 ? '-' : '';
      const absOuts = Math.abs(outsDelta);
      const deltaStr = outsDelta === 0 ? '0' : `${sign}${Math.floor(absOuts / 3)}.${absOuts % 3}`;
      return {
        label: cat.display_name,
        delta: outsDelta,
        relDelta: Math.abs(outsDelta) / maxOuts,
        winning: outsDelta !== 0 ? outsDelta > 0 : null,
        deltaStr,
        hasData: true,
      };
    }

    const myNum = parseFloat(myRaw);
    const oppNum = parseFloat(oppRaw);
    if (isNaN(myNum) || isNaN(oppNum)) return placeholderRow(cat.display_name);

    const delta = myNum - oppNum;
    const maxVal = Math.max(Math.abs(myNum), Math.abs(oppNum), 0.001);
    const relDelta = Math.abs(delta) / maxVal;

    let winning: boolean | null = null;
    if (delta !== 0) winning = cat.betterIs === 'higher' ? delta > 0 : delta < 0;

    return {
      label: cat.display_name,
      delta,
      relDelta,
      winning,
      deltaStr: formatStatDelta(delta, cat.name),
      hasData: true,
    };
  });
}

function DivergingRow({ row, maxRel }: { row: CategoryRow; maxRel: number }) {
  const barPct = maxRel > 0 ? (row.relDelta / maxRel) * 45 : 0;
  const isWin = row.winning === true;
  const isLoss = row.winning === false;
  const barColor = isWin ? 'bg-success' : isLoss ? 'bg-error' : 'bg-muted-foreground';
  const textColor = !row.hasData ? 'text-muted-foreground/60' :
    isWin ? 'text-success' : isLoss ? 'text-error' : 'text-muted-foreground';

  return (
    <div className="flex items-center gap-1.5">
      <span className="w-10 text-xs font-medium text-foreground shrink-0 truncate">{row.label}</span>
      <div className="flex-1 flex items-center h-5 relative">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border" />
        {barPct > 0 && isWin && (
          <div
            className={`absolute left-1/2 top-0.5 bottom-0.5 rounded-r ${barColor}`}
            style={{ width: `${barPct}%` }}
          />
        )}
        {barPct > 0 && isLoss && (
          <div
            className={`absolute top-0.5 bottom-0.5 rounded-l ${barColor}`}
            style={{ width: `${barPct}%`, right: '50%' }}
          />
        )}
      </div>
      <span className={`w-12 text-xs text-right font-bold shrink-0 ${textColor}`}>
        {row.deltaStr}
      </span>
    </div>
  );
}

export default function SeasonComparisonCard() {
  const { leagueKey, teamKey } = useFantasy();
  const [activeTab, setActiveTab] = useState<'batting' | 'pitching'>('batting');

  const { matchups, isLoading: scoreLoading } = useScoreboard(leagueKey);
  const { categories, isLoading: catsLoading } = useLeagueCategories(leagueKey);
  const { stats: myStats, isLoading: myStatsLoading } = useTeamStats(teamKey);

  const userMatchup = teamKey
    ? matchups.find(m => m.teams.some(t => t.team_key === teamKey))
    : undefined;
  const opponent = userMatchup?.teams.find(t => t.team_key !== teamKey);
  const opponentTeamKey = opponent?.team_key;

  const { stats: oppStats, isLoading: oppStatsLoading } = useTeamStats(opponentTeamKey);

  const isLoading = scoreLoading || catsLoading || myStatsLoading || (!!opponentTeamKey && oppStatsLoading);

  const myMap = new Map(myStats.map(s => [s.stat_id, s.value]));
  const oppMap = new Map(oppStats.map(s => [s.stat_id, s.value]));

  const battingCats = categories.filter(c => c.is_batter_stat);
  const pitchingCats = categories.filter(c => c.is_pitcher_stat);

  const battingRows = buildRows(battingCats, myMap, oppMap);
  const pitchingRows = buildRows(pitchingCats, myMap, oppMap);
  const allRows = [...battingRows, ...pitchingRows];
  const maxRel = allRows.reduce((m, r) => Math.max(m, r.relDelta), 0);

  const hasData = allRows.some(r => r.hasData);
  const activeRows = activeTab === 'batting' ? battingRows : pitchingRows;

  return (
    <DashboardCard title="Season Stats" icon={FiBarChart} size="lg" isLoading={isLoading}>
      {!hasData ? (
        <Text variant="small">
          {opponentTeamKey ? 'Season stats not available' : 'No matchup data available'}
        </Text>
      ) : (
        <div className="space-y-4">
          <Text variant="caption">
            vs. <span className="font-medium text-foreground">{opponent?.name ?? 'Opponent'}</span> — season to date
          </Text>

          <Tabs
            variant="underline"
            items={[
              { id: 'batting', label: 'Batting' },
              { id: 'pitching', label: 'Pitching' },
            ]}
            value={activeTab}
            onChange={setActiveTab}
            ariaLabel="Category group"
          />

          <div className="space-y-1.5">
            {activeRows.length > 0 ? (
              activeRows.map(row => <DivergingRow key={row.label} row={row} maxRel={maxRel} />)
            ) : (
              <p className="text-sm text-muted-foreground text-center py-2">
                No {activeTab} categories available.
              </p>
            )}
          </div>
        </div>
      )}
    </DashboardCard>
  );
}
