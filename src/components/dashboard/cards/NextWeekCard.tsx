'use client';

import { useState } from 'react';
import { FiCalendar } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';
import DivergingTable, { type DivergingDatum } from '@/components/ui/DivergingRow';
import { useFantasy } from '../FantasyProvider';
import { useScoreboard } from '@/lib/hooks/useScoreboard';
import { useStandings } from '@/lib/hooks/useStandings';
import { useCorrectedMatchupAnalysis } from '@/lib/hooks/useCorrectedMatchupAnalysis';
import { Text } from '@/components/typography';
import { formatStatDelta, formatStatValue } from '@/lib/formatStat';
import type { AnalyzedMatchupRow } from '@/lib/matchup/analysis';

/**
 * Next week's matchup outlook — both sides' projected category totals
 * against next week's opponent (`useCorrectedMatchupAnalysis` in pivot
 * mode: pure projection, no matchup-to-date blend).
 *
 * There is deliberately no current-week twin. A this-week version of this
 * card either restates the live scoreboard (redundant with `BossCard`) or
 * shows a start-of-week projection that contradicts what already happened
 * — see docs/history.md.
 */
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

export default function NextWeekCard() {
  const [activeTab, setActiveTab] = useState<'batting' | 'pitching'>('batting');
  const { leagueKey, teamKey, currentWeek } = useFantasy();

  const weekNumber = currentWeek ? Number(currentWeek) + 1 : undefined;

  const { matchups } = useScoreboard(leagueKey, weekNumber);
  const { standings, isLoading: standingsLoading } = useStandings(leagueKey);
  const {
    analysis,
    opponentName,
    opponentTeamKey,
    isLoading: analysisLoading,
  } = useCorrectedMatchupAnalysis(leagueKey, teamKey, { targetWeek: 'next' });

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

  const table = (rows: DivergingDatum[]) => (
    <DivergingTable rows={rows} oppLabel={opponentName ?? 'Opp'} maxRel={maxRel} />
  );

  return (
    <DashboardCard title="Next Week" icon={FiCalendar} size="full" isLoading={isLoading}>
      {!opponentTeamKey ? (
        <Text variant="small">No matchup data for next week</Text>
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
            <>
              {/* Full width at lg+: both sides at once, no click to see the
                  other half — the marquee shows batting and pitching
                  together and this is its next-week counterpart. Below lg a
                  two-column split leaves each diverging table under ~350px,
                  too tight for label + bar + margin chip, so those widths
                  keep the tab switcher. */}
              <div className="hidden lg:grid lg:grid-cols-2 lg:gap-8 border-t border-border pt-3">
                {([['batting', battingRows], ['pitching', pitchingRows]] as const).map(([side, rows]) => (
                  <div key={side} className="space-y-2">
                    <span className="text-caption text-muted-foreground uppercase tracking-wider">
                      {side}
                    </span>
                    {rows.length > 0 ? (
                      table(rows)
                    ) : (
                      <p className="text-xs text-muted-foreground py-2">No {side} data</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="lg:hidden border-t border-border pt-2 space-y-2">
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
                  table(activeRows)
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-2">No {activeTab} data</p>
                )}
              </div>
            </>
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
