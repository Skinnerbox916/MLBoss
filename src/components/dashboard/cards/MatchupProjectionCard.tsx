'use client';

import { useState } from 'react';
import type { IconType } from 'react-icons';
import DashboardCard from '../DashboardCard';
import DivergingTable, { type DivergingDatum } from '@/components/ui/DivergingRow';
import { useFantasy } from '../FantasyProvider';
import { useScoreboard } from '@/lib/hooks/useScoreboard';
import { useStandings } from '@/lib/hooks/useStandings';
import { useCorrectedMatchupAnalysis } from '@/lib/hooks/useCorrectedMatchupAnalysis';
import { Text } from '@/components/typography';
import { formatStatDelta, formatStatValue } from '@/lib/formatStat';
import type { WeekTarget } from '@/lib/dashboard/weekRange';
import type { AnalyzedMatchupRow } from '@/lib/matchup/analysis';

// composeCorrectedRows formats every numeric projection (IP included)
// as a plain decimal string, so parseFloat is safe across all stats.
function rowToCategory(row: AnalyzedMatchupRow): DivergingDatum | null {
  const my = parseFloat(row.myVal);
  const opp = parseFloat(row.oppVal);
  if (!Number.isFinite(my) || !Number.isFinite(opp)) return null;

  const delta = my - opp;
  const maxVal = Math.max(Math.abs(my), Math.abs(opp), 0.001);
  const relDelta = Math.abs(delta) / maxVal;

  return {
    label: row.label,
    myVal: formatStatValue(my, row.name),
    oppVal: formatStatValue(opp, row.name),
    relDelta,
    winning: row.winning,
    deltaStr: formatStatDelta(delta, row.name),
  };
}

interface MatchupProjectionCardProps {
  targetWeek: WeekTarget;
  /** Title prefix — week number is appended automatically when known. */
  titlePrefix: string;
  icon: IconType;
}

export default function MatchupProjectionCard({
  targetWeek,
  titlePrefix,
  icon,
}: MatchupProjectionCardProps) {
  const [activeTab, setActiveTab] = useState<'batting' | 'pitching'>('batting');
  const { leagueKey, teamKey, currentWeek } = useFantasy();

  const isNext = targetWeek === 'next';
  const weekNumber = currentWeek
    ? isNext ? Number(currentWeek) + 1 : Number(currentWeek)
    : undefined;

  const { matchups } = useScoreboard(leagueKey, isNext ? weekNumber : undefined);
  const { standings, isLoading: standingsLoading } = useStandings(leagueKey);
  const {
    analysis,
    opponentName,
    opponentTeamKey,
    isLoading: analysisLoading,
  } = useCorrectedMatchupAnalysis(leagueKey, teamKey, { targetWeek });

  const isLoading = standingsLoading || analysisLoading;

  const myStandings = standings.find(s => s.team_key === teamKey);
  const oppStandings = standings.find(s => s.team_key === opponentTeamKey);
  const oppRecord = oppStandings
    ? `${oppStandings.wins ?? 0}–${oppStandings.losses ?? 0}${(oppStandings.ties ?? 0) > 0 ? `–${oppStandings.ties}` : ''}`
    : null;

  const userMatchup = matchups.find(m => m.teams.some(t => t.team_key === teamKey));
  const isPlayoffs = userMatchup?.is_playoffs;

  const battingRows = analysis.rows
    .filter(r => r.isBatterStat)
    .map(rowToCategory)
    .filter((r): r is DivergingDatum => r !== null);
  const pitchingRows = analysis.rows
    .filter(r => r.isPitcherStat)
    .map(rowToCategory)
    .filter((r): r is DivergingDatum => r !== null);
  const allRows = [...battingRows, ...pitchingRows];
  const maxRel = allRows.reduce((m, r) => Math.max(m, r.relDelta), 0);
  const activeRows = activeTab === 'batting' ? battingRows : pitchingRows;
  const hasRows = allRows.length > 0;

  const title = weekNumber ? `${titlePrefix} — Week ${weekNumber}` : titlePrefix;

  return (
    <DashboardCard title={title} icon={icon} size="lg" isLoading={isLoading}>
      {!opponentTeamKey ? (
        <Text variant="small">
          {isNext ? 'No matchup data for next week' : 'No matchup data available'}
        </Text>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Opponent</p>
              <p className="font-semibold text-sm leading-tight">{opponentName ?? 'TBD'}</p>
              {oppRecord && (
                <p className="text-xs text-muted-foreground mt-0.5">{oppRecord}</p>
              )}
            </div>
            <div className="flex gap-3 text-xs text-muted-foreground shrink-0">
              {myStandings?.rank && (
                <span>You <span className="font-semibold text-foreground">#{myStandings.rank}</span></span>
              )}
              {oppStandings?.rank && (
                <span>Them <span className="font-semibold text-foreground">#{oppStandings.rank}</span></span>
              )}
            </div>
          </div>

          {isPlayoffs && (
            <span className="inline-block px-2 py-0.5 bg-accent-100 text-accent-900 text-xs rounded font-medium">
              Playoffs
            </span>
          )}

          {hasRows ? (
            <div className="border-t border-border pt-2 space-y-2">
              <div className="flex space-x-1 bg-secondary rounded-lg p-0.5">
                {(['batting', 'pitching'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-1 px-2 rounded text-xs font-medium transition-colors ${
                      activeTab === tab
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {activeRows.length > 0 ? (
                <DivergingTable
                  rows={activeRows}
                  oppLabel={opponentName ?? 'Opp'}
                  maxRel={maxRel}
                />
              ) : (
                <p className="text-xs text-muted-foreground text-center py-2">No {activeTab} data</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground border-t border-border pt-2">
              Projection data unavailable
            </p>
          )}
        </div>
      )}
    </DashboardCard>
  );
}
