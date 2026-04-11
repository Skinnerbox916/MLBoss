'use client';

import { useState } from 'react';
import { FiTrendingUp, FiTrendingDown, FiMinus } from 'react-icons/fi';
import DashboardCard from '@/components/dashboard/DashboardCard';
import Icon from '@/components/Icon';
import { useFantasyContext } from '@/lib/hooks/useFantasyContext';
import { useScoreboard } from '@/lib/hooks/useScoreboard';
import { useLeagueCategories } from '@/lib/hooks/useLeagueCategories';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StatRowData {
  label: string;
  name: string;
  myVal: string;
  oppVal: string;
  delta: number;
  betterIs: 'higher' | 'lower';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatVal(value: string, name: string): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  if (['AVG', 'OBP', 'SLG', 'OPS'].includes(name)) return num.toFixed(3).replace(/^0\./, '.');
  if (['ERA', 'WHIP'].includes(name)) return num.toFixed(2);
  if (name === 'IP') return num.toFixed(1);
  return Number.isInteger(num) ? num.toString() : num.toFixed(3);
}

function buildStatRows(
  cats: EnrichedLeagueStatCategory[],
  myMap: Map<number, string>,
  oppMap: Map<number, string>,
): StatRowData[] {
  return cats.flatMap(cat => {
    const myRaw = myMap.get(cat.stat_id);
    const oppRaw = oppMap.get(cat.stat_id);
    if (myRaw === undefined || oppRaw === undefined) return [];
    const myNum = parseFloat(myRaw);
    const oppNum = parseFloat(oppRaw);
    if (isNaN(myNum) || isNaN(oppNum)) return [];
    return [{
      label: cat.display_name,
      name: cat.name,
      myVal: myRaw,
      oppVal: oppRaw,
      delta: myNum - oppNum,
      betterIs: cat.betterIs,
    }];
  });
}

function DeltaIndicator({ delta, betterIs, name }: { delta: number; betterIs: 'higher' | 'lower'; name: string }) {
  if (delta === 0) {
    return (
      <div className="flex items-center text-muted-foreground">
        <Icon icon={FiMinus} size={16} className="mr-1" />
        <span className="text-sm font-medium">0</span>
      </div>
    );
  }

  const isWinning = betterIs === 'higher' ? delta > 0 : delta < 0;
  const abs = Math.abs(delta);
  let deltaStr: string;
  if (['AVG', 'OBP', 'SLG', 'OPS'].includes(name)) {
    deltaStr = abs.toFixed(3).replace(/^0\./, '.');
  } else if (['ERA', 'WHIP'].includes(name)) {
    deltaStr = abs.toFixed(2);
  } else if (name === 'IP') {
    deltaStr = abs.toFixed(1);
  } else {
    deltaStr = Number.isInteger(abs) ? abs.toString() : abs.toFixed(3);
  }

  return (
    <div className={`flex items-center ${isWinning ? 'text-success' : 'text-error'}`}>
      <Icon icon={isWinning ? FiTrendingUp : FiTrendingDown} size={16} className="mr-1" />
      <span className="text-sm font-medium">{deltaStr}</span>
    </div>
  );
}

function StatRow({ stat }: { stat: StatRowData }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
      <div className="flex-1">
        <span className="text-sm font-medium text-foreground">{stat.label}</span>
      </div>
      <div className="flex items-center space-x-4 text-sm">
        <span className="text-foreground font-medium w-12 text-right">
          {formatVal(stat.myVal, stat.name)}
        </span>
        <span className="text-muted-foreground w-12 text-right">
          {formatVal(stat.oppVal, stat.name)}
        </span>
        <div className="w-16 flex justify-end">
          <DeltaIndicator delta={stat.delta} betterIs={stat.betterIs} name={stat.name} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export default function CurrentScoreCard({ leagueKey }: { leagueKey: string | undefined }) {
  const { teamKey } = useFantasyContext();
  const { matchups, week, isLoading: scoreLoading } = useScoreboard(leagueKey);
  const { categories, isLoading: catsLoading, isError } = useLeagueCategories(leagueKey);
  const [activeTab, setActiveTab] = useState<'batting' | 'pitching'>('batting');

  const isLoading = scoreLoading || catsLoading;

  const userMatchup = teamKey
    ? matchups.find(m => m.teams.some(t => t.team_key === teamKey))
    : undefined;
  const userTeam = userMatchup?.teams.find(t => t.team_key === teamKey);
  const opponent = userMatchup?.teams.find(t => t.team_key !== teamKey);

  const battingCats = categories.filter(c => c.is_batter_stat);
  const pitchingCats = categories.filter(c => c.is_pitcher_stat);

  let battingRows: StatRowData[] = [];
  let pitchingRows: StatRowData[] = [];
  let wins = 0, losses = 0, ties = 0;

  if (userTeam?.stats && opponent?.stats) {
    const myMap = new Map(userTeam.stats.map(s => [s.stat_id, s.value]));
    const oppMap = new Map(opponent.stats.map(s => [s.stat_id, s.value]));
    battingRows = buildStatRows(battingCats, myMap, oppMap);
    pitchingRows = buildStatRows(pitchingCats, myMap, oppMap);

    for (const row of [...battingRows, ...pitchingRows]) {
      if (row.delta === 0) ties++;
      else if (row.betterIs === 'higher' ? row.delta > 0 : row.delta < 0) wins++;
      else losses++;
    }
  }

  const overall: 'W' | 'L' | 'T' = wins > losses ? 'W' : losses > wins ? 'L' : 'T';
  const badgeColor = overall === 'W'
    ? 'bg-success/15 text-success'
    : overall === 'L'
      ? 'bg-error/15 text-error'
      : 'bg-primary/15 text-foreground';
  const badgeLabel = overall === 'W' ? 'Winning' : overall === 'L' ? 'Losing' : 'Tied';

  const title = week ? `Matchup Stats — Week ${week}` : 'Matchup Stats';
  const activeRows = activeTab === 'batting' ? battingRows : pitchingRows;

  return (
    <DashboardCard title={title} size="lg" isLoading={isLoading}>
      {isError ? (
        <p className="text-sm text-error">Failed to load matchup data</p>
      ) : !userMatchup ? (
        <p className="text-sm text-muted-foreground">No matchup data available</p>
      ) : (
        <div className="space-y-4">
          {/* Opponent and overall score */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">vs</p>
              <p className="text-lg font-semibold text-foreground">{opponent?.name ?? 'Opponent'}</p>
            </div>
            <div className={`px-3 py-1 rounded-full text-sm font-medium ${badgeColor}`}>
              {badgeLabel} ({wins}–{losses}–{ties})
            </div>
          </div>

          {/* Batting / Pitching tabs */}
          <div className="flex space-x-1 bg-secondary rounded-lg p-1">
            {(['batting', 'pitching'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors capitalize ${
                  activeTab === tab
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Column headers */}
          <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
            <span>Category</span>
            <div className="flex items-center space-x-4">
              <span className="w-12 text-right">You</span>
              <span className="w-12 text-right">Opp</span>
              <span className="w-16 text-right">Diff</span>
            </div>
          </div>

          {/* Stat rows */}
          <div className="space-y-0">
            {activeRows.length > 0 ? (
              activeRows.map(stat => <StatRow key={stat.label} stat={stat} />)
            ) : (
              <p className="text-sm text-muted-foreground text-center py-2">
                Stats will appear once the week begins.
              </p>
            )}
          </div>
        </div>
      )}
    </DashboardCard>
  );
}
