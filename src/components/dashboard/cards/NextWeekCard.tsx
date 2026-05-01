'use client';

import { useState } from 'react';
import { FiCalendar } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';
import DivergingRow from '@/components/ui/DivergingRow';
import { useFantasy } from '../FantasyProvider';
import { useScoreboard } from '@/lib/hooks/useScoreboard';
import { useStandings } from '@/lib/hooks/useStandings';
import { useTeamStats } from '@/lib/hooks/useTeamStats';
import { useLeagueCategories } from '@/lib/hooks/useLeagueCategories';
import { parseIPToOuts } from '@/lib/utils';
import { formatStatDelta } from '@/lib/formatStat';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';

function formatIPDelta(myRaw: string, oppRaw: string): { deltaStr: string; relDelta: number; winning: boolean | null } {
  const myOuts = parseIPToOuts(myRaw);
  const oppOuts = parseIPToOuts(oppRaw);
  const outsDelta = myOuts - oppOuts;
  const maxOuts = Math.max(Math.abs(myOuts), Math.abs(oppOuts), 1);
  const sign = outsDelta > 0 ? '+' : outsDelta < 0 ? '-' : '';
  const absOuts = Math.abs(outsDelta);
  const deltaStr = outsDelta === 0 ? '0' : `${sign}${Math.floor(absOuts / 3)}.${absOuts % 3}`;
  return {
    deltaStr,
    relDelta: Math.abs(outsDelta) / maxOuts,
    winning: outsDelta !== 0 ? outsDelta > 0 : null,
  };
}

// ---------------------------------------------------------------------------
// Row building
// ---------------------------------------------------------------------------

interface CategoryRow {
  label: string;
  relDelta: number;
  winning: boolean | null;
  deltaStr: string;
}

function buildRows(
  cats: EnrichedLeagueStatCategory[],
  myMap: Map<number, string>,
  oppMap: Map<number, string>,
): CategoryRow[] {
  return cats.flatMap(cat => {
    const myRaw = myMap.get(cat.stat_id);
    const oppRaw = oppMap.get(cat.stat_id);
    if (myRaw === undefined || oppRaw === undefined) return [];

    if (cat.stat_id === 50) { // Innings Pitched — outs math
      const { deltaStr, relDelta, winning } = formatIPDelta(myRaw, oppRaw);
      return [{ label: cat.display_name, relDelta, winning, deltaStr }];
    }

    const myNum = parseFloat(myRaw);
    const oppNum = parseFloat(oppRaw);
    if (isNaN(myNum) || isNaN(oppNum)) return [];

    const delta = myNum - oppNum;
    const maxVal = Math.max(Math.abs(myNum), Math.abs(oppNum), 0.001);
    const relDelta = Math.abs(delta) / maxVal;
    const winning = delta !== 0 ? (cat.betterIs === 'higher' ? delta > 0 : delta < 0) : null;

    return [{ label: cat.display_name, relDelta, winning, deltaStr: formatStatDelta(delta, cat.name) }];
  });
}


// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export default function NextWeekCard() {
  const [activeTab, setActiveTab] = useState<'batting' | 'pitching'>('batting');
  const { leagueKey, teamKey, currentWeek } = useFantasy();
  const nextWeek = currentWeek ? Number(currentWeek) + 1 : undefined;

  const { matchups, isLoading: matchupLoading } = useScoreboard(leagueKey, nextWeek);
  const { standings, isLoading: standingsLoading } = useStandings(leagueKey);
  const { categories, isLoading: catsLoading } = useLeagueCategories(leagueKey);
  const { stats: myStats, isLoading: myStatsLoading } = useTeamStats(teamKey);

  const userMatchup = matchups.find(m => m.teams.some(t => t.team_key === teamKey));
  const opponent = userMatchup?.teams.find(t => t.team_key !== teamKey);
  const opponentTeamKey = opponent?.team_key;

  const { stats: oppStats, isLoading: oppStatsLoading } = useTeamStats(opponentTeamKey);

  const isLoading =
    matchupLoading || standingsLoading || catsLoading || myStatsLoading ||
    (!!opponentTeamKey && oppStatsLoading);

  const oppStandings = standings.find(s => s.team_key === opponentTeamKey);
  const myStandings = standings.find(s => s.team_key === teamKey);

  const oppRecord = oppStandings
    ? `${oppStandings.wins ?? 0}–${oppStandings.losses ?? 0}${(oppStandings.ties ?? 0) > 0 ? `–${oppStandings.ties}` : ''}`
    : null;

  const myMap = new Map(myStats.map(s => [s.stat_id, s.value]));
  const oppMap = new Map(oppStats.map(s => [s.stat_id, s.value]));

  const battingCats = categories.filter(c => c.is_batter_stat);
  const pitchingCats = categories.filter(c => c.is_pitcher_stat);
  const battingRows = buildRows(battingCats, myMap, oppMap);
  const pitchingRows = buildRows(pitchingCats, myMap, oppMap);
  const allRows = [...battingRows, ...pitchingRows];
  const maxRel = allRows.reduce((m, r) => Math.max(m, r.relDelta), 0);
  const activeRows = activeTab === 'batting' ? battingRows : pitchingRows;
  const hasStats = allRows.length > 0;

  return (
    <DashboardCard title={`Next Week${nextWeek ? ` — Week ${nextWeek}` : ''}`} icon={FiCalendar} size="lg" isLoading={isLoading}>
      {!userMatchup ? (
        <p className="text-sm text-muted-foreground">
          {nextWeek ? 'No matchup data for next week' : 'Season week info unavailable'}
        </p>
      ) : (
        <div className="space-y-3">
          {/* Opponent header */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Opponent</p>
              <p className="font-semibold text-sm leading-tight">{opponent?.name ?? 'TBD'}</p>
              {oppRecord && (
                <p className="text-xs text-muted-foreground mt-0.5">{oppRecord}</p>
              )}
            </div>
            <div className="flex gap-3 text-xs text-muted-foreground shrink-0">
              {myStandings?.rank && <span>You <span className="font-semibold text-foreground">#{myStandings.rank}</span></span>}
              {oppStandings?.rank && <span>Them <span className="font-semibold text-foreground">#{oppStandings.rank}</span></span>}
            </div>
          </div>

          {userMatchup.is_playoffs && (
            <span className="inline-block px-2 py-0.5 bg-accent-100 text-accent-800 text-xs rounded font-medium">
              Playoffs
            </span>
          )}

          {/* Season comparison */}
          {hasStats ? (
            <>
              <p className="text-xs text-muted-foreground border-t border-border pt-2">
                Season-to-date vs. <span className="font-medium text-foreground">{opponent?.name ?? 'opponent'}</span>
              </p>

              {/* Tab toggle */}
              <div className="flex space-x-1 bg-secondary rounded-lg p-0.5">
                {(['batting', 'pitching'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-1 px-2 rounded-md text-xs font-medium transition-colors ${
                      activeTab === tab
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              <div className="space-y-0.5">
                {activeRows.length > 0 ? (
                  activeRows.map(row => (
                    <DivergingRow
                      key={row.label}
                      label={row.label}
                      relDelta={row.relDelta}
                      maxRel={maxRel}
                      winning={row.winning}
                      deltaStr={row.deltaStr}
                      deltaWidth="w-10"
                    />
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-2">No {activeTab} data</p>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground border-t border-border pt-2">
              Season stats will appear once available
            </p>
          )}
        </div>
      )}
    </DashboardCard>
  );
}
