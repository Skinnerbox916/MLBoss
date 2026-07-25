'use client';

import { useMemo } from 'react';
import { FiAlertTriangle } from 'react-icons/fi';
import { GiThrowingBall } from 'react-icons/gi';
import DashboardCard from '@/components/dashboard/DashboardCard';
import Badge from '@/components/ui/Badge';
import { Text } from '@/components/typography';
import { useFantasy } from '../FantasyProvider';
import { useScoreboard } from '@/lib/hooks/useScoreboard';
import { useRoster } from '@/lib/hooks/useRoster';
import { useGameDay } from '@/lib/hooks/useGameDay';
import { useTransactions } from '@/lib/hooks/useTransactions';
import { useLeagueStreamRates } from '@/lib/hooks/useLeagueStreamRates';
import { useLeagueWeekBounds } from '@/lib/hooks/useFantasyContext';
import { getMatchupWeekDays } from '@/lib/dashboard/weekRange';
import { todayStr, tomorrowStr } from '@/lib/pitching/display';
import { matchProbableStarts } from '@/lib/pitching/probableMatch';
import { getRowStatus } from '@/components/lineup/types';
import type { RosterEntry, TransactionPlayer } from '@/lib/yahoo-fantasy-api';

/** Yahoo `display_position` covers starting pitcher. */
function isStartingPitcher(displayPosition: string): boolean {
  return displayPosition.split(',').some(p => p.trim() === 'SP');
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/**
 * Opponent scouting card — the one place that answers "what is my opponent
 * doing?" Their injuries and probable starts decide whether chasing ERA,
 * WHIP, or counting stats is realistic this week, and their **transactions**
 * decide it just as much: a manager who adds a starter every other day
 * out-pitches their own roster projection.
 *
 * Three sections, plus a profile line (adds this week + the expected-stream
 * rate that feeds their projection — see
 * [streamVolume.ts](../../../lib/projection/streamVolume.ts)):
 *
 *  1. Injuries — who they've lost.
 *  2. Probable pitchers (today/tomorrow), with arms acquired this week
 *     chipped `NEW`. The rows come off their CURRENT roster, so a pickup
 *     already showed up here silently; the chip is what makes it legible.
 *  3. Adds this week — SP-eligible first, because the probables window is
 *     only two days and a Thursday stream wouldn't appear above.
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

  const { transactions } = useTransactions(leagueKey);
  const { startsByTeamKey } = useLeagueStreamRates(leagueKey);
  const weekBounds = useLeagueWeekBounds(leagueKey);

  const injuries = useMemo<RosterEntry[]>(
    () => oppRoster.filter(p => getRowStatus(p) === 'injured'),
    [oppRoster],
  );

  // Their adds since this matchup week opened. Local midnight of the week's
  // first day — an add in the small hours of day 1 counting as last week is
  // an acceptable edge for a scouting readout.
  const weekStartMs = useMemo(() => {
    const first = getMatchupWeekDays(new Date(), weekBounds)[0]?.date;
    return first ? new Date(`${first}T00:00:00`).getTime() : undefined;
  }, [weekBounds]);

  const adds = useMemo(() => {
    if (!opponentTeamKey || weekStartMs === undefined) return [];
    const rows: Array<{ player: TransactionPlayer; ts: number }> = [];
    for (const tx of transactions) {
      if (tx.status !== 'successful' || !tx.timestamp) continue;
      if (tx.timestamp * 1000 < weekStartMs) continue;
      for (const p of tx.players) {
        if (p.type === 'add' && p.destination_team_key === opponentTeamKey) {
          rows.push({ player: p, ts: tx.timestamp });
        }
      }
    }
    // SP-eligible first (the ones that change their pitching volume), then
    // most recent.
    return rows.sort((a, b) => {
      const aSp = isStartingPitcher(a.player.display_position) ? 0 : 1;
      const bSp = isStartingPitcher(b.player.display_position) ? 0 : 1;
      return aSp - bSp || b.ts - a.ts;
    });
  }, [transactions, opponentTeamKey, weekStartMs]);

  const newPlayerKeys = useMemo(
    () => new Set(adds.map(a => a.player.player_key)),
    [adds],
  );

  const streamRate = opponentTeamKey ? startsByTeamKey.get(opponentTeamKey) : undefined;

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
        <Text variant="small">No matchup data available</Text>
      ) : (
        <div className="space-y-4">
          {(adds.length > 0 || streamRate !== undefined) && (
            <div className="flex items-center gap-2 text-caption text-muted-foreground font-mono -mt-1">
              {adds.length > 0 && (
                <span>{adds.length} add{adds.length === 1 ? '' : 's'} this wk</span>
              )}
              {adds.length > 0 && streamRate !== undefined && <span>·</span>}
              {streamRate !== undefined && <span>~{streamRate.toFixed(1)} SP/wk</span>}
            </div>
          )}

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
                    {newPlayerKeys.has(player.player_key) && <Badge color="success">NEW</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {adds.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-caption text-muted-foreground uppercase tracking-wider">
                  Adds This Week
                </span>
                <span className="text-caption text-muted-foreground">· {adds.length}</span>
              </div>
              <ul className="space-y-1">
                {adds.slice(0, 4).map(({ player, ts }, i) => (
                  <li key={`${player.player_key}-${i}`} className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-foreground truncate">{player.name}</span>
                    <span className="text-caption text-muted-foreground">
                      {player.editorial_team_abbr} · {player.display_position}
                    </span>
                    {isStartingPitcher(player.display_position) && (
                      <Badge color="accent">SP</Badge>
                    )}
                    <span className="text-caption text-muted-foreground ml-auto font-mono">
                      {timeAgo(ts)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </DashboardCard>
  );
}
