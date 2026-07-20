'use client';

import { useMemo } from 'react';
import Panel from '@/components/ui/Panel';
import type { StandingsEntry } from '@/lib/yahoo-fantasy-api';

/**
 * League standings — scoring-agnostic. Yahoo's standings shape (rank,
 * W/L/T, Pct, GB) is shared by H2H categories and H2H points leagues, so
 * both /league views mount this one table. Columns are data-driven, not
 * mode-flagged: PF/PA render when the league reports points totals
 * (points leagues), the streak column when Yahoo includes it.
 */
export default function StandingsTable({
  standings,
  userTeamKey,
}: {
  standings: StandingsEntry[];
  userTeamKey: string | undefined;
}) {
  const sorted = useMemo(
    () => [...standings].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)),
    [standings],
  );
  const showPoints = standings.some(t => (t.points_for ?? 0) > 0);
  const showGB = standings.some(t => t.points_back !== undefined && t.points_back !== '' && t.points_back !== '-');
  const showStreak = sorted[0]?.streak !== undefined;

  return (
    <Panel title="Standings">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-2 py-1.5 text-muted-foreground font-medium w-8">#</th>
              <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Team</th>
              <th className="text-center px-2 py-1.5 text-muted-foreground font-medium w-14">W</th>
              <th className="text-center px-2 py-1.5 text-muted-foreground font-medium w-14">L</th>
              <th className="text-center px-2 py-1.5 text-muted-foreground font-medium w-14">T</th>
              <th className="text-right px-2 py-1.5 text-muted-foreground font-medium w-14">Pct</th>
              {showPoints && (
                <>
                  <th className="text-right px-2 py-1.5 text-muted-foreground font-medium w-20">PF</th>
                  <th className="text-right px-2 py-1.5 text-muted-foreground font-medium w-20">PA</th>
                </>
              )}
              {showGB && (
                <th className="text-right px-2 py-1.5 text-muted-foreground font-medium w-14">GB</th>
              )}
              {showStreak && (
                <th className="text-center px-2 py-1.5 text-muted-foreground font-medium w-14">Strk</th>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map(team => {
              const isUser = team.team_key === userTeamKey;
              const rowClass = isUser ? 'bg-primary/5' : '';
              return (
                <tr key={team.team_key} className={`border-b border-border/50 hover:bg-surface-muted/50 ${rowClass}`}>
                  <td className="px-2 py-1.5 text-muted-foreground">{team.rank ?? '-'}</td>
                  <td className="px-2 py-1.5">
                    <span className={`font-medium ${isUser ? 'text-accent' : 'text-foreground'}`}>
                      {team.name}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-center text-foreground">{team.wins ?? '-'}</td>
                  <td className="px-2 py-1.5 text-center text-foreground">{team.losses ?? '-'}</td>
                  <td className="px-2 py-1.5 text-center text-foreground">{team.ties ?? '-'}</td>
                  <td className="px-2 py-1.5 text-right text-foreground">{team.percentage ?? '-'}</td>
                  {showPoints && (
                    <>
                      <td className="px-2 py-1.5 text-right text-foreground tabular-nums">
                        {team.points_for !== undefined ? team.points_for.toFixed(1) : '-'}
                      </td>
                      <td className="px-2 py-1.5 text-right text-muted-foreground tabular-nums">
                        {team.points_against !== undefined ? team.points_against.toFixed(1) : '-'}
                      </td>
                    </>
                  )}
                  {showGB && (
                    <td className="px-2 py-1.5 text-right text-muted-foreground">{team.points_back ?? '-'}</td>
                  )}
                  {showStreak && (
                    <td className="px-2 py-1.5 text-center text-muted-foreground">{team.streak ?? '-'}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
