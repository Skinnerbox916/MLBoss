'use client';

import { FiTarget } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';
import { useFantasy } from '../FantasyProvider';
import { useScoreboard } from '@/lib/hooks/useScoreboard';
import { useLeagueCategories } from '@/lib/hooks/useLeagueCategories';
import { parseIPToOuts } from '@/lib/utils';

interface CategoryRow {
  label: string;
  myVal: string;
  oppVal: string;
  delta: number;
  relDelta: number;
  winning: boolean | null;
  deltaStr: string;
}

function formatIPDelta(myRaw: string, oppRaw: string): { deltaStr: string; delta: number; relDelta: number; winning: boolean | null } {
  const myOuts = parseIPToOuts(myRaw);
  const oppOuts = parseIPToOuts(oppRaw);
  const outsDelta = myOuts - oppOuts;
  const maxOuts = Math.max(Math.abs(myOuts), Math.abs(oppOuts), 1);
  const relDelta = Math.abs(outsDelta) / maxOuts;
  let winning: boolean | null = null;
  if (outsDelta !== 0) winning = outsDelta > 0; // higher IP is better
  const sign = outsDelta > 0 ? '+' : outsDelta < 0 ? '-' : '';
  const absOuts = Math.abs(outsDelta);
  const innings = Math.floor(absOuts / 3);
  const rem = absOuts % 3;
  const deltaStr = outsDelta === 0 ? '0' : `${sign}${innings}.${rem}`;
  return { deltaStr, delta: outsDelta, relDelta, winning };
}

function formatDelta(delta: number, name: string): string {
  if (delta === 0) return '0';
  const sign = delta > 0 ? '+' : '';
  if (name === 'ERA' || name === 'WHIP') {
    return sign + delta.toFixed(2);
  }
  return sign + (Number.isInteger(delta) ? delta.toString() : delta.toFixed(3));
}

function DivergingRow({ row, maxRel }: { row: CategoryRow; maxRel: number }) {
  const barPct = maxRel > 0 ? (row.relDelta / maxRel) * 40 : 0;
  const isWin = row.winning === true;
  const isLoss = row.winning === false;
  const barColor = isWin ? 'bg-success' : isLoss ? 'bg-error' : 'bg-muted-foreground';
  const deltaColor = isWin ? 'text-success' : isLoss ? 'text-error' : 'text-muted-foreground';

  return (
    <div className="flex items-center gap-1">
      <span className="w-10 text-[11px] font-medium text-foreground shrink-0 truncate">{row.label}</span>
      <span className={`w-10 text-[11px] text-right tabular-nums font-mono shrink-0 ${isWin ? 'text-success font-semibold' : isLoss ? 'text-muted-foreground' : 'text-foreground'}`}>
        {row.myVal}
      </span>
      <div className="flex-1 flex items-center h-4 relative min-w-0">
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
      <span className={`w-10 text-[11px] text-left tabular-nums font-mono shrink-0 ${isLoss ? 'text-error font-semibold' : isWin ? 'text-muted-foreground' : 'text-foreground'}`}>
        {row.oppVal}
      </span>
      <span className={`w-12 text-[11px] text-right font-bold shrink-0 tabular-nums font-mono ${deltaColor}`}>
        {row.deltaStr}
      </span>
    </div>
  );
}

export default function PitchingCard() {
  const { leagueKey, teamKey, isLoading: contextLoading } = useFantasy();
  const { matchups, isLoading: scoreLoading } = useScoreboard(leagueKey);
  const { categories, isLoading: catsLoading, isError } = useLeagueCategories(leagueKey);

  const isLoading = contextLoading || scoreLoading || catsLoading;

  const userMatchup = matchups.find(m => m.teams.some(t => t.team_key === teamKey));
  const userTeam = userMatchup?.teams.find(t => t.team_key === teamKey);
  const opponent = userMatchup?.teams.find(t => t.team_key !== teamKey);

  const pitchingCats = categories.filter(c => c.is_pitcher_stat);

  const rows: CategoryRow[] = [];
  let wins = 0, losses = 0, ties = 0;

  if (userTeam?.stats && opponent?.stats) {
    const myMap = new Map(userTeam.stats.map(s => [s.stat_id, s.value]));
    const oppMap = new Map(opponent.stats.map(s => [s.stat_id, s.value]));

    for (const cat of pitchingCats) {
      const myRaw = myMap.get(cat.stat_id);
      const oppRaw = oppMap.get(cat.stat_id);
      if (myRaw === undefined || oppRaw === undefined) continue;

      let delta: number, relDelta: number, winning: boolean | null, deltaStr: string;

      if (cat.stat_id === 50) { // stat_id 50 = Innings Pitched — use outs math
        ({ delta, relDelta, winning, deltaStr } = formatIPDelta(myRaw, oppRaw));
      } else {
        const myNum = parseFloat(myRaw);
        const oppNum = parseFloat(oppRaw);
        if (isNaN(myNum) || isNaN(oppNum)) continue;
        delta = myNum - oppNum;
        const maxVal = Math.max(Math.abs(myNum), Math.abs(oppNum), 0.001);
        relDelta = Math.abs(delta) / maxVal;
        winning = delta !== 0 ? (cat.betterIs === 'higher' ? delta > 0 : delta < 0) : null;
        deltaStr = formatDelta(delta, cat.name);
      }

      if (winning === true) wins++;
      else if (winning === false) losses++;
      else ties++;

      rows.push({ label: cat.display_name, myVal: myRaw, oppVal: oppRaw, delta, relDelta, winning, deltaStr });
    }
  }

  const maxRel = rows.reduce((m, r) => Math.max(m, r.relDelta), 0);

  return (
    <DashboardCard
      title="Pitching"
      icon={FiTarget}
      size="md"
      isLoading={isLoading}
    >
      {isError ? (
        <p className="text-sm text-error">Failed to load pitching stats</p>
      ) : !userMatchup ? (
        <p className="text-sm text-muted-foreground">No matchup data available</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pitching categories available</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              vs. <span className="font-medium text-foreground">{opponent?.name ?? 'Opponent'}</span>
            </p>
            <span className="text-xs font-bold font-mono tabular-nums">
              <span className="text-success">{wins}</span>
              <span className="text-muted-foreground">–</span>
              <span className="text-error">{losses}</span>
              {ties > 0 && (
                <>
                  <span className="text-muted-foreground">–</span>
                  <span className="text-muted-foreground">{ties}</span>
                </>
              )}
            </span>
          </div>
          <div className="space-y-0.5">
            {rows.map(row => <DivergingRow key={row.label} row={row} maxRel={maxRel} />)}
          </div>
        </div>
      )}
    </DashboardCard>
  );
}
