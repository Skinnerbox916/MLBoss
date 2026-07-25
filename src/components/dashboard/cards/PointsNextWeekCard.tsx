'use client';

import { FiCalendar } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';
import { Text } from '@/components/typography';
import { useActiveLeague } from '@/lib/hooks/useActiveLeague';
import { useScoreboard } from '@/lib/hooks/useScoreboard';
import { useStandings } from '@/lib/hooks/useStandings';
import { usePointsTeam } from '@/lib/hooks/usePointsTeam';
import { usePointsStreaming } from '@/lib/hooks/usePointsStreaming';
import { usePointsOpponentWeek } from '@/lib/hooks/usePointsOpponentWeek';
import { useLeagueStreamRates } from '@/lib/hooks/useLeagueStreamRates';
import { expectedStreamPoints } from '@/lib/points/streamVolume';

/** Inclusive day count between two YYYY-MM-DD stamps; 0 when either is absent. */
function windowLength(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

/**
 * Next week's matchup outlook for points leagues — the twin of the categories
 * `NextWeekCard`, in the one currency points leagues have. Same grammar:
 * opponent identity + records/ranks on top, both sides' projected output
 * below, margin from the user's perspective.
 *
 * Both sides carry their **expected streamed starts** priced in league points
 * ([points/streamVolume.ts](../../../lib/points/streamVolume.ts)) — next week
 * is a pure projection, so a roster-only comparison would assume neither
 * manager adds a starter. Same by-side rule as categories: on a next-week
 * window both sides are expectation, because there's no in-week lever to
 * hold in reserve.
 */
export default function PointsNextWeekCard() {
  const { leagueKey, teamKey, scoringType } = useActiveLeague();

  // Current-week scoreboard only to learn the week number, then next week's
  // for opponent identity — same two-step the categories pivot uses.
  const { week: currentWeek } = useScoreboard(leagueKey);
  const nextWeek = typeof currentWeek === 'number' ? currentWeek + 1 : undefined;
  const { matchups } = useScoreboard(nextWeek !== undefined ? leagueKey : undefined, nextWeek);

  const userMatchup = teamKey
    ? matchups.find(m => m.teams.some(t => t.team_key === teamKey))
    : undefined;
  const opponent = userMatchup?.teams.find(t => t.team_key !== teamKey);

  // Roster-only (`includeFA: false`) — this card wants `weekProjectedPoints`,
  // not the FA-pool fan-out that VOR and suggested swaps need. Same shape the
  // opponent side fetches, so both columns are measured identically.
  const { data: myNext, isLoading: myLoading } = usePointsTeam(
    leagueKey, teamKey, scoringType, 'next', { includeFA: false },
  );
  const { projectedRemaining: oppProjected, isLoading: oppLoading } =
    usePointsOpponentWeek(leagueKey, opponent?.team_key, scoringType, 'next');

  const { data: streaming } = usePointsStreaming(leagueKey, teamKey, scoringType);
  const { startsByTeamKey } = useLeagueStreamRates(leagueKey);
  const { standings, isLoading: standingsLoading } = useStandings(leagueKey);

  // My side is roster-only out of `usePointsTeam`; add my expected streams so
  // the two columns are measured the same way.
  const myWeekLength = windowLength(myNext?.week.start, myNext?.week.end);
  const { points: myStreamPoints } = expectedStreamPoints({
    startsPerWeek: teamKey ? startsByTeamKey.get(teamKey) ?? 0 : 0,
    remainingDays: myWeekLength,
    faStartPointsAvg: streaming?.faStartPointsAvg ?? 0,
  });
  const myProjected = myNext !== undefined ? myNext.weekProjectedPoints + myStreamPoints : undefined;

  const myStandings = standings.find(s => s.team_key === teamKey);
  const oppStandings = standings.find(s => s.team_key === opponent?.team_key);
  const oppRecord = oppStandings
    ? `${oppStandings.wins ?? 0}–${oppStandings.losses ?? 0}${(oppStandings.ties ?? 0) > 0 ? `–${oppStandings.ties}` : ''}`
    : null;

  const isLoading = myLoading || oppLoading || standingsLoading;
  const margin =
    myProjected !== undefined && oppProjected !== undefined ? myProjected - oppProjected : undefined;
  const winning = margin !== undefined && margin >= 0;
  const isPlayoffs = userMatchup?.is_playoffs;

  return (
    <DashboardCard title="Next Week" icon={FiCalendar} size="md" isLoading={isLoading}>
      {!opponent ? (
        <Text variant="small">No matchup data for next week</Text>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Opponent</p>
              <p className="font-semibold text-sm leading-tight">{opponent.name}</p>
              {oppRecord && <p className="text-xs text-muted-foreground mt-0.5">{oppRecord}</p>}
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

          <div className="border-t border-border pt-3 space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-muted-foreground">You</span>
              <span className="font-mono font-numeric text-lg font-semibold text-foreground">
                {myProjected !== undefined ? Math.round(myProjected) : '—'}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-muted-foreground truncate">{opponent.name}</span>
              <span className="font-mono font-numeric text-lg text-muted-foreground">
                {oppProjected !== undefined ? Math.round(oppProjected) : '—'}
              </span>
            </div>
            {margin !== undefined && (
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-caption text-muted-foreground uppercase tracking-wider">
                  Margin
                </span>
                <span
                  className={`font-mono font-numeric text-xs font-semibold px-1.5 py-0.5 rounded ${
                    winning ? 'bg-success/15 text-success' : 'bg-error/15 text-error'
                  }`}
                >
                  {winning ? 'W' : 'L'} {margin >= 0 ? '+' : ''}{Math.round(margin)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </DashboardCard>
  );
}
