'use client';

import Link from 'next/link';
import { FiZap } from 'react-icons/fi';
import Panel from '@/components/ui/Panel';
import Icon from '@/components/Icon';
import { Text } from '@/components/typography';
import BossBrief from '@/components/dashboard/BossCard/BossBrief';
import { useActiveLeague } from '@/lib/hooks/useActiveLeague';
import { useScoreboard } from '@/lib/hooks/useScoreboard';
import { useStandings } from '@/lib/hooks/useStandings';
import { usePointsOpponentWeek } from '@/lib/hooks/usePointsOpponentWeek';
import { getPointsBrief } from '@/lib/points/brief';
import type { PointsTeamResponse } from '@/lib/hooks/usePointsTeam';

/**
 * Points dashboard marquee — the points twin of the categories Boss Card.
 * H2H leagues: live matchup score, each side's projected final (live +
 * projected remaining), and the points Boss Brief line. Season leagues
 * (Yahoo 'point' — no weekly opponent): projected week + standings
 * position instead; nothing opponent-shaped renders.
 */
export default function PointsMarquee({ data }: { data: PointsTeamResponse | undefined }) {
  const { leagueKey, teamKey, scoringType, headToHead } = useActiveLeague();
  const { matchups } = useScoreboard(headToHead ? leagueKey : undefined);

  const userMatchup = teamKey
    ? matchups.find(m => m.teams.some(t => t.team_key === teamKey))
    : undefined;
  const me = userMatchup?.teams.find(t => t.team_key === teamKey);
  const opp = userMatchup?.teams.find(t => t.team_key !== teamKey);

  const { projectedRemaining: oppRemaining } = usePointsOpponentWeek(
    headToHead ? leagueKey : undefined,
    opp?.team_key,
    scoringType,
  );

  if (!data) return null;
  const myRemaining = data.weekProjectedPoints;
  const remainingDays = data.week.remainingDays;
  const lineupDelta = data.lineup?.deltaPoints ?? 0;

  if (!headToHead || !me || !opp) {
    return (
      <SeasonMarquee
        leagueKey={leagueKey}
        teamKey={teamKey}
        myRemaining={myRemaining}
        remainingDays={remainingDays}
        lineupDelta={lineupDelta}
        headToHead={headToHead}
      />
    );
  }

  const myLive = Number(me.points ?? 0);
  const oppLive = Number(opp.points ?? 0);
  const brief = oppRemaining !== undefined
    ? getPointsBrief({ myLive, oppLive, myRemaining, oppRemaining, remainingDays, lineupDelta })
    : null;

  return (
    <Panel>
      <div className="space-y-3">
        <div className="flex items-stretch justify-between gap-4">
          <ScoreSide
            name={me.name}
            live={myLive}
            projectedFinal={myLive + myRemaining}
            leading={myLive >= oppLive}
          />
          <div className="flex flex-col items-center justify-center shrink-0">
            <Text as="span" variant="caption" className="text-muted-foreground uppercase tracking-wider">
              {remainingDays} day{remainingDays === 1 ? '' : 's'} left
            </Text>
            <span className="text-muted-foreground text-lg font-display">vs</span>
          </div>
          <ScoreSide
            name={opp.name}
            live={oppLive}
            projectedFinal={oppRemaining !== undefined ? oppLive + oppRemaining : undefined}
            leading={oppLive > myLive}
            alignRight
          />
        </div>
        <BossBrief brief={brief} />
      </div>
    </Panel>
  );
}

function ScoreSide({
  name, live, projectedFinal, leading, alignRight = false,
}: {
  name: string;
  live: number;
  projectedFinal: number | undefined;
  leading: boolean;
  alignRight?: boolean;
}) {
  return (
    <div className={`min-w-0 ${alignRight ? 'text-right' : ''}`}>
      <Text variant="small" className="text-muted-foreground truncate">{name}</Text>
      <div className={`font-mono tabular-nums text-3xl font-bold ${leading ? 'text-primary' : 'text-foreground'}`}>
        {live.toFixed(1)}
      </div>
      {projectedFinal !== undefined && (
        <Text variant="caption" className="text-muted-foreground">
          proj final <span className="font-mono tabular-nums font-medium text-foreground">{Math.round(projectedFinal)}</span>
        </Text>
      )}
    </div>
  );
}

/** No weekly opponent (season-points league, or a bye/no-matchup week):
 *  projected week + standings position. */
function SeasonMarquee({
  leagueKey, teamKey, myRemaining, remainingDays, lineupDelta, headToHead,
}: {
  leagueKey: string | undefined;
  teamKey: string | undefined;
  myRemaining: number;
  remainingDays: number;
  lineupDelta: number;
  headToHead: boolean;
}) {
  const { standings } = useStandings(headToHead ? undefined : leagueKey);
  const mine = standings.find(s => s.team_key === teamKey);

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Text variant="caption" className="text-muted-foreground uppercase tracking-wider">
            Projected this week · {remainingDays} day{remainingDays === 1 ? '' : 's'} left
          </Text>
          <div className="flex items-baseline gap-2">
            <span className="font-mono tabular-nums text-4xl font-bold text-primary">{myRemaining}</span>
            <Text as="span" variant="muted">pts</Text>
          </div>
        </div>
        {mine?.rank !== undefined && (
          <div className="text-right">
            <Text variant="caption" className="text-muted-foreground uppercase tracking-wider">Standing</Text>
            <div className="font-mono tabular-nums text-2xl font-bold text-foreground">#{mine.rank}</div>
            {mine.points_for !== undefined && (
              <Text variant="caption" className="text-muted-foreground">{mine.points_for.toFixed(1)} PF</Text>
            )}
          </div>
        )}
        {lineupDelta > 0.5 ? (
          <Link
            href="/lineup"
            className="flex items-center gap-3 rounded-lg bg-accent/10 px-4 py-3 hover:bg-accent/15 transition-colors"
          >
            <Icon icon={FiZap} size={20} className="text-accent shrink-0" />
            <Text as="span" className="font-medium text-accent-900">+{lineupDelta} pts available today</Text>
          </Link>
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3">
            <Icon icon={FiZap} size={18} className="text-success" />
            <Text as="span" variant="small" className="text-success-900 font-medium">Lineup is optimal today</Text>
          </div>
        )}
      </div>
    </Panel>
  );
}
