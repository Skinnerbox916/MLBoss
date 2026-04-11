'use client';

import { GiBaseballBat } from 'react-icons/gi';
import DashboardCard from '../DashboardCard';
import { useFantasy } from '../FantasyProvider';
import { useScoreboard } from '@/lib/hooks/useScoreboard';
import { useLeagueCategories } from '@/lib/hooks/useLeagueCategories';

interface CategoryRow {
  label: string;
  delta: number;
  relDelta: number;
  winning: boolean | null;
  deltaStr: string;
}

function formatDelta(delta: number, name: string): string {
  if (delta === 0) return '0';
  const sign = delta > 0 ? '+' : '';
  const abs = Math.abs(delta);
  if (name === 'AVG' || name === 'OBP' || name === 'SLG' || name === 'OPS') {
    return sign + (delta < 0 ? '-' : '') + abs.toFixed(3).replace(/^0\./, '.');
  }
  return sign + (Number.isInteger(delta) ? delta.toString() : delta.toFixed(3));
}

function DivergingRow({ row, maxRel }: { row: CategoryRow; maxRel: number }) {
  const barPct = maxRel > 0 ? (row.relDelta / maxRel) * 45 : 0;
  const isWin = row.winning === true;
  const isLoss = row.winning === false;
  const barColor = isWin ? 'bg-success' : isLoss ? 'bg-error' : 'bg-muted-foreground';
  const textColor = isWin ? 'text-success' : isLoss ? 'text-error' : 'text-muted-foreground';

  return (
    <div className="flex items-center gap-1.5">
      <span className="w-10 text-xs font-medium text-foreground shrink-0 truncate">{row.label}</span>
      <div className="flex-1 flex items-center h-5 relative">
        {/* Center line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border" />
        {/* Bar: winning extends right, losing extends left */}
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

export default function BattingCard() {
  const { leagueKey, teamKey, isLoading: contextLoading } = useFantasy();
  const { matchups, isLoading: scoreLoading } = useScoreboard(leagueKey);
  const { categories, isLoading: catsLoading, isError } = useLeagueCategories(leagueKey);

  const isLoading = contextLoading || scoreLoading || catsLoading;

  const userMatchup = matchups.find(m => m.teams.some(t => t.team_key === teamKey));
  const userTeam = userMatchup?.teams.find(t => t.team_key === teamKey);
  const opponent = userMatchup?.teams.find(t => t.team_key !== teamKey);

  const battingCats = categories.filter(c => c.is_batter_stat);

  const rows: CategoryRow[] = [];
  if (userTeam?.stats && opponent?.stats) {
    const myMap = new Map(userTeam.stats.map(s => [s.stat_id, s.value]));
    const oppMap = new Map(opponent.stats.map(s => [s.stat_id, s.value]));

    for (const cat of battingCats) {
      const myRaw = myMap.get(cat.stat_id);
      const oppRaw = oppMap.get(cat.stat_id);
      if (myRaw === undefined || oppRaw === undefined) continue;

      const myNum = parseFloat(myRaw);
      const oppNum = parseFloat(oppRaw);
      if (isNaN(myNum) || isNaN(oppNum)) continue;

      const delta = myNum - oppNum;
      const maxVal = Math.max(Math.abs(myNum), Math.abs(oppNum), 0.001);
      const relDelta = Math.abs(delta) / maxVal;

      let winning: boolean | null = null;
      if (delta !== 0) {
        winning = cat.betterIs === 'higher' ? delta > 0 : delta < 0;
      }

      rows.push({
        label: cat.display_name,
        delta,
        relDelta,
        winning,
        deltaStr: formatDelta(delta, cat.name),
      });
    }
  }

  const maxRel = rows.reduce((m, r) => Math.max(m, r.relDelta), 0);

  return (
    <DashboardCard
      title="Batting"
      icon={GiBaseballBat}
      size="md"
      isLoading={isLoading}
    >
      {isError ? (
        <p className="text-sm text-error">Failed to load batting stats</p>
      ) : !userMatchup ? (
        <p className="text-sm text-muted-foreground">No matchup data available</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No batting categories available</p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            vs. <span className="font-medium text-foreground">{opponent?.name ?? 'Opponent'}</span> — this week
          </p>
          <div className="space-y-1">
            {rows.map(row => <DivergingRow key={row.label} row={row} maxRel={maxRel} />)}
          </div>
        </div>
      )}
    </DashboardCard>
  );
}
