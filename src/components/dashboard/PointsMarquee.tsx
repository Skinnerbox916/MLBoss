'use client';

import Link from 'next/link';
import { FiZap } from 'react-icons/fi';
import Skeleton from '@/components/ui/Skeleton';
import Icon from '@/components/Icon';
import { Text } from '@/components/typography';
import Corner, { MobileTeamRow } from '@/components/dashboard/BossCard/Corner';
import LeverageBar from '@/components/dashboard/BossCard/LeverageBar';
import BossBrief from '@/components/dashboard/BossCard/BossBrief';
import { formatRecord } from '@/components/dashboard/BossCard';
import { useActiveLeague } from '@/lib/hooks/useActiveLeague';
import { useScoreboard } from '@/lib/hooks/useScoreboard';
import { useStandings } from '@/lib/hooks/useStandings';
import { usePointsOpponentWeek } from '@/lib/hooks/usePointsOpponentWeek';
import { getPointsBrief } from '@/lib/points/brief';
import type { PointsTeamResponse } from '@/lib/hooks/usePointsTeam';

/**
 * Points dashboard marquee — the points twin of the categories Boss Card,
 * sharing its fight-card chrome (Corner avatars + crown, week chip,
 * LeverageBar, BossBrief). Numerals are the LIVE matchup score; the bar
 * fills by PROJECTED-final leverage; the subline carries each side's
 * projected final. Season leagues (no weekly opponent) get the season
 * variant: projected week + standings position, same chrome, no corners.
 */
export default function PointsMarquee({ data }: { data: PointsTeamResponse | undefined }) {
  const { leagueKey, teamKey, scoringType, headToHead } = useActiveLeague();
  const { matchups, week, isLoading: scoreLoading } = useScoreboard(headToHead ? leagueKey : undefined);
  const { standings } = useStandings(leagueKey);

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

  if (headToHead && scoreLoading && !me) return <MarqueeSkeleton />;

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
  const myLeader = myLive > oppLive;
  const oppLeader = oppLive > myLive;

  const myStandings = standings.find(s => s.team_key === teamKey);
  const oppStandings = standings.find(s => s.team_key === opp.team_key);

  const briefInput = { myLive, oppLive, myRemaining, oppRemaining: oppRemaining ?? 0, remainingDays, lineupDelta };
  const brief = oppRemaining !== undefined ? getPointsBrief(briefInput) : null;

  // The bar tracks the LIVE score (the numerals it sits under) — fills
  // toward whoever is ahead now, as a share of points scored so far
  // (floored so early-week noise stays calm). The projection is a
  // different question, carried by the subline (proj finals) and the
  // brief line — NOT the bar, so the graphic never contradicts the score.
  const liveLeverage = Math.max(-1, Math.min(1, (myLive - oppLive) / Math.max(myLive + oppLive, 100)));

  const myFinal = Math.round(myLive + myRemaining);
  const oppFinal = oppRemaining !== undefined ? Math.round(oppLive + oppRemaining) : undefined;

  return (
    <section
      aria-label="Current matchup"
      className="relative bg-surface rounded-xl shadow-sm border-y-2 border-accent/40 px-4 sm:px-6 py-5 sm:py-6 overflow-hidden"
    >
      {week !== undefined && (
        <div className="absolute left-1/2 -translate-x-1/2 -top-px z-10" aria-label="Matchup week">
          <span className="inline-block px-3 py-0.5 rounded-b-md bg-primary text-background text-caption font-mono font-numeric uppercase tracking-[0.2em]">
            wk {week}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)] items-center gap-5 lg:gap-6">
        {/* Mobile matchup stack — mirrors the Boss Card's <md treatment. */}
        <div className="md:hidden flex flex-col gap-1.5 pt-3">
          <MobileTeamRow
            teamName={me.name}
            logoUrl={me.team_logos?.[0]?.url}
            record={formatRecord(myStandings?.wins, myStandings?.losses, myStandings?.ties)}
            rank={myStandings?.rank}
            side="left"
            isLeader={myLeader}
          />
          <div className="flex items-center gap-2.5 px-1" aria-hidden="true">
            <span className="flex-1 h-px bg-border-muted" />
            <span className="text-micro font-mono font-bold uppercase tracking-[0.15em] text-muted-foreground">
              vs
            </span>
            <span className="flex-1 h-px bg-border-muted" />
          </div>
          <MobileTeamRow
            teamName={opp.name}
            logoUrl={opp.team_logos?.[0]?.url}
            record={formatRecord(oppStandings?.wins, oppStandings?.losses, oppStandings?.ties)}
            rank={oppStandings?.rank}
            side="right"
            isLeader={oppLeader}
          />
        </div>

        {/* Left corner — md+ */}
        <div className="hidden md:flex order-1 justify-center lg:order-1 lg:justify-start">
          <Corner
            teamName={me.name}
            logoUrl={me.team_logos?.[0]?.url}
            record={formatRecord(myStandings?.wins, myStandings?.losses, myStandings?.ties)}
            rank={myStandings?.rank}
            side="left"
            isLeader={myLeader}
          />
        </div>

        {/* Center: live score numerals over the projected-final leverage bar. */}
        <div className="order-3 lg:order-2 flex flex-col items-stretch gap-3 sm:gap-4 max-w-2xl mx-auto w-full">
          <LeverageBar
            wins={0}
            losses={0}
            ties={0}
            leverage={liveLeverage}
            myScore={myLive}
            oppScore={oppLive}
            ariaLabel={`Live score ${myLive} to ${oppLive}; projected final ${myFinal} to ${oppFinal ?? 'unknown'}`}
            subline={
              <>
                <span className="font-mono font-numeric">
                  proj <span className="text-foreground font-semibold">{myFinal}</span>
                </span>
                <span aria-hidden="true">·</span>
                <span className="uppercase tracking-wider">
                  {remainingDays} day{remainingDays === 1 ? '' : 's'} left
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono font-numeric">
                  proj <span className="text-foreground font-semibold">{oppFinal ?? '—'}</span>
                </span>
              </>
            }
          />
        </div>

        {/* Right corner — md+ */}
        <div className="hidden md:flex order-2 justify-center lg:order-3 lg:justify-end">
          <Corner
            teamName={opp.name}
            logoUrl={opp.team_logos?.[0]?.url}
            record={formatRecord(oppStandings?.wins, oppStandings?.losses, oppStandings?.ties)}
            rank={oppStandings?.rank}
            side="right"
            isLeader={oppLeader}
          />
        </div>
      </div>

      {brief && (
        <div className="mt-4">
          <BossBrief brief={brief} />
        </div>
      )}
    </section>
  );
}

function MarqueeSkeleton() {
  return (
    <section
      aria-label="Loading matchup"
      className="relative bg-surface rounded-xl shadow-sm border-y-2 border-accent/30 px-4 sm:px-6 py-5 sm:py-6"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)] items-center gap-5">
        <div className="flex items-center gap-4">
          <Skeleton className="w-16 h-16 sm:w-20 sm:h-20 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-3 w-full" />
        </div>
        <div className="flex items-center gap-4 lg:flex-row-reverse">
          <Skeleton className="w-16 h-16 sm:w-20 sm:h-20 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      </div>
    </section>
  );
}

/** No weekly opponent (season-points league, or a bye/no-matchup week):
 *  projected week + standings position, same marquee chrome, no corners. */
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
    <section
      aria-label="Week outlook"
      className="relative bg-surface rounded-xl shadow-sm border-y-2 border-accent/40 px-4 sm:px-6 py-5 sm:py-6 overflow-hidden"
    >
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
    </section>
  );
}
