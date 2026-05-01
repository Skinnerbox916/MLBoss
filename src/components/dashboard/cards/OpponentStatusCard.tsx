'use client';

import { useMemo } from 'react';
import { FiAlertTriangle } from 'react-icons/fi';
import { GiThrowingBall } from 'react-icons/gi';
import DashboardCard from '@/components/dashboard/DashboardCard';
import Badge from '@/components/ui/Badge';
import { useFantasy } from '../FantasyProvider';
import { useScoreboard } from '@/lib/hooks/useScoreboard';
import { useRoster } from '@/lib/hooks/useRoster';
import { useGameDay } from '@/lib/hooks/useGameDay';
import { todayStr, tomorrowStr } from '@/lib/pitching/display';
import { matchProbableStarts } from '@/lib/pitching/probableMatch';
import { getRowStatus } from '@/components/lineup/types';
import type { RosterEntry } from '@/lib/yahoo-fantasy-api';

/**
 * Opponent scouting card. Fills the gap the old Matchup page had — the
 * opposing team has its own injuries and probable pitchers that directly
 * affect whether chasing ERA, WHIP, or counting stats is realistic this
 * week. Complements the Season Stats card (which is purely analytical).
 */
export default function OpponentStatusCard() {
  const { leagueKey, teamKey } = useFantasy();
  const { matchups, isLoading: scoreLoading } = useScoreboard(leagueKey);

  const userMatchup = teamKey
    ? matchups.find(m => m.teams.some(t => t.team_key === teamKey))
    : undefined;
  const opponent = userMatchup?.teams.find(t => t.team_key !== teamKey);
  const opponentTeamKey = opponent?.team_key;

  const today = todayStr();
  const tomorrow = tomorrowStr();
  const { roster: oppRoster, isLoading: rosterLoading } = useRoster(opponentTeamKey, today);
  const { games: todayGames, isLoading: todayGamesLoading } = useGameDay(today);
  const { games: tomorrowGames, isLoading: tomorrowGamesLoading } = useGameDay(tomorrow);

  const injuries = useMemo<RosterEntry[]>(
    () => oppRoster.filter(p => getRowStatus(p) === 'injured'),
    [oppRoster],
  );

  // Match opponent's rostered pitchers to probable starts (today/tomorrow).
  const probables = useMemo(() => {
    const results: Array<{ player: RosterEntry; when: 'Today' | 'Tomorrow'; opponent: string }> = [];
    for (const label of ['Today', 'Tomorrow'] as const) {
      const games = label === 'Today' ? todayGames : tomorrowGames;
      for (const m of matchProbableStarts(oppRoster, games)) {
        results.push({
          player: m.player,
          when: label,
          opponent: `${m.isHome ? 'vs' : '@'} ${m.opponentAbbr}`,
        });
      }
    }
    return results;
  }, [oppRoster, todayGames, tomorrowGames]);

  const isLoading = scoreLoading || rosterLoading || todayGamesLoading || tomorrowGamesLoading;

  return (
    <DashboardCard
      title={opponent ? `Scouting: ${opponent.name}` : 'Opponent Scouting'}
      icon={FiAlertTriangle}
      size="lg"
      isLoading={isLoading}
    >
      {!opponent ? (
        <p className="text-sm text-muted-foreground">No matchup data available</p>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-caption text-muted-foreground uppercase tracking-wider">
                Injuries
              </span>
              <span className="text-caption text-muted-foreground">· {injuries.length}</span>
            </div>
            {injuries.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No injuries — they&apos;re at full strength.</p>
            ) : (
              <ul className="space-y-1">
                {injuries.map(p => (
                  <li key={p.player_key} className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-foreground truncate">{p.name}</span>
                    <span className="text-caption text-muted-foreground">
                      {p.editorial_team_abbr} · {p.display_position}
                    </span>
                    {p.status && <Badge color="error">{p.status}</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <GiThrowingBall className="text-primary" size={14} />
              <span className="text-caption text-muted-foreground uppercase tracking-wider">
                Probable Pitchers
              </span>
              <span className="text-caption text-muted-foreground">· {probables.length}</span>
            </div>
            {probables.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No confirmed starts in the next 2 days.</p>
            ) : (
              <ul className="space-y-1">
                {probables.map(({ player, when, opponent: oppLabel }, i) => (
                  <li key={`${player.player_key}-${when}-${i}`} className="flex items-center gap-2 text-xs">
                    <Badge color={when === 'Today' ? 'accent' : 'muted'}>{when}</Badge>
                    <span className="font-medium text-foreground truncate">{player.name}</span>
                    <span className="text-caption text-muted-foreground">{oppLabel}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </DashboardCard>
  );
}
