'use client';

import { useMemo } from 'react';
import { useFantasy } from '@/components/dashboard/FantasyProvider';
import { useScoreboard } from '@/lib/hooks/useScoreboard';
import { useStandings } from '@/lib/hooks/useStandings';
import { useLeagueCategories } from '@/lib/hooks/useLeagueCategories';
import { useLeagueLimits } from '@/lib/hooks/useLeagueLimits';
import { useWeekProbables } from '@/lib/hooks/useWeekProbables';
import { buildMatchupRows, tallyMatchupRows } from '@/components/shared/matchupRows';
import { analyzeMatchup } from '@/lib/matchup/analysis';
import { getMatchupWeekDays } from '@/lib/dashboard/weekRange';
import { getBossBrief } from '@/lib/dashboard/bossBrief';
import Skeleton from '@/components/ui/Skeleton';
import { Text } from '@/components/typography';
import Corner from './Corner';
import LeverageBar from './LeverageBar';
import CategoryRail from './CategoryRail';
import WeekProgress from './WeekProgress';
import BossBrief from './BossBrief';

function formatRecord(wins?: number, losses?: number, ties?: number): string | undefined {
  if (wins === undefined && losses === undefined) return undefined;
  const w = wins ?? 0;
  const l = losses ?? 0;
  const t = ties ?? 0;
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

const STAT_ID_IP = 50;
const STAT_ID_GS = 25;

/**
 * Boss Card — the dashboard marquee.
 *
 * A brand-forward, full-bleed matchup hero that lives above the dashboard
 * grid (not inside it). Tells you in one glance: who you're playing, who's
 * leading, and where you're winning / losing categories.
 *
 * Subsequent stages add probable-pitcher runway, league cap headroom, and
 * a rules-based "Boss Brief" CTA.
 */
export default function BossCard() {
  const { leagueKey, teamKey, currentWeek, isLoading: ctxLoading } = useFantasy();
  const { matchups, week, isLoading: scoreLoading } = useScoreboard(leagueKey);
  const { standings, isLoading: standingsLoading } = useStandings(leagueKey);
  const { categories, isLoading: catsLoading } = useLeagueCategories(leagueKey);
  const { limits } = useLeagueLimits(leagueKey);

  const isLoading = ctxLoading || scoreLoading || standingsLoading || catsLoading;

  const userMatchup = teamKey
    ? matchups.find(m => m.teams.some(t => t.team_key === teamKey))
    : undefined;
  const userTeam = userMatchup?.teams.find(t => t.team_key === teamKey);
  const opponent = userMatchup?.teams.find(t => t.team_key !== teamKey);

  const myStandings = standings.find(s => s.team_key === teamKey);
  const oppStandings = standings.find(s => s.team_key === opponent?.team_key);

  const {
    myStarts,
    oppStarts,
    myRemaining,
    oppRemaining,
    isLoading: probablesLoading,
  } = useWeekProbables(teamKey, opponent?.team_key);

  const { battingRows, pitchingRows, wins, losses, ties, myUsedIp, myUsedGs, oppUsedIp, oppUsedGs } = useMemo(() => {
    if (!userTeam?.stats || !opponent?.stats) {
      return {
        battingRows: [], pitchingRows: [], wins: 0, losses: 0, ties: 0,
        myUsedIp: undefined, myUsedGs: undefined, oppUsedIp: undefined, oppUsedGs: undefined,
      };
    }
    const myMap = new Map(userTeam.stats.map(s => [s.stat_id, s.value]));
    const oppMap = new Map(opponent.stats.map(s => [s.stat_id, s.value]));
    const bat = buildMatchupRows(categories.filter(c => c.is_batter_stat), myMap, oppMap);
    const pit = buildMatchupRows(categories.filter(c => c.is_pitcher_stat), myMap, oppMap);
    const tally = tallyMatchupRows([...bat, ...pit]);
    return {
      battingRows: bat,
      pitchingRows: pit,
      ...tally,
      myUsedIp: myMap.get(STAT_ID_IP),
      myUsedGs: myMap.get(STAT_ID_GS),
      oppUsedIp: oppMap.get(STAT_ID_IP),
      oppUsedGs: oppMap.get(STAT_ID_GS),
    };
  }, [userTeam, opponent, categories]);

  // Days elapsed in the current Mon-Sun matchup week. We treat "today" as
  // half-elapsed because games are still live; the analysis engine clamps to
  // [0.1, 1.0] week progress to avoid div/0 on Monday morning.
  const daysElapsed = useMemo(() => {
    const days = getMatchupWeekDays();
    const finished = days.filter(d => !d.isRemaining).length;
    return finished + 0.5;
  }, []);

  const analysis = useMemo(
    () => analyzeMatchup([...battingRows, ...pitchingRows], { daysElapsed }),
    [battingRows, pitchingRows, daysElapsed],
  );

  // Pick the single most contested losing category to highlight in the rail.
  // It's the one with the highest priority (close to a toss-up) where the
  // user is currently behind — i.e. the category most worth chasing right
  // now. Among ties, the one with the larger negative margin wins (the one
  // that's closer to slipping further out of reach).
  const highlightStatId = useMemo(() => {
    let best: { statId: number; priority: number; margin: number } | null = null;
    for (const row of analysis.rows) {
      if (!row.hasData || row.winning !== false) continue;
      if (
        !best ||
        row.priority > best.priority ||
        (row.priority === best.priority && row.margin < best.margin)
      ) {
        best = { statId: row.statId, priority: row.priority, margin: row.margin };
      }
    }
    return best?.statId;
  }, [analysis]);

  const myLeader = wins > losses;
  const oppLeader = losses > wins;
  const weekLabel = week ?? currentWeek;

  if (isLoading) {
    return <BossCardSkeleton />;
  }

  if (!userMatchup || !userTeam || !opponent) {
    return (
      <section className="relative bg-surface rounded-xl shadow-sm border-y-2 border-accent/30 px-6 py-8 mb-6 text-center">
        <Text variant="small">No active matchup this week.</Text>
      </section>
    );
  }

  const myLogo = userTeam.team_logos?.[0]?.url;
  const oppLogo = opponent.team_logos?.[0]?.url;
  const myRecord = formatRecord(myStandings?.wins, myStandings?.losses, myStandings?.ties);
  const oppRecord = formatRecord(oppStandings?.wins, oppStandings?.losses, oppStandings?.ties);

  const brief = getBossBrief({
    analysis,
    myStarts,
    oppStarts,
    myRemaining,
    oppRemaining,
    limits,
    myUsedIp,
    myUsedGs,
  });

  return (
    <section
      aria-label="Current matchup"
      className="relative bg-surface rounded-xl shadow-sm border-y-2 border-accent/40 px-4 sm:px-6 py-5 sm:py-6 mb-6 overflow-hidden"
    >
      {/* Center week chip — sits in the gutter between the two corners on lg+. */}
      {weekLabel && (
        <div
          className="absolute left-1/2 -translate-x-1/2 -top-px z-10"
          aria-label="Matchup week"
        >
          <span className="inline-block px-3 py-0.5 rounded-b-md bg-primary text-background text-caption font-mono font-numeric uppercase tracking-[0.2em]">
            wk {weekLabel}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)] items-center gap-5 lg:gap-6">
        {/* Left corner */}
        <div className="order-1 lg:order-1 flex justify-center lg:justify-start">
          <Corner
            teamName={userTeam.name}
            logoUrl={myLogo}
            record={myRecord}
            rank={myStandings?.rank}
            side="left"
            isLeader={myLeader}
          />
        </div>

        {/* Center column */}
        <div className="order-3 lg:order-2 flex flex-col items-stretch gap-3 sm:gap-4 max-w-2xl mx-auto w-full">
          <LeverageBar wins={wins} losses={losses} ties={ties} leverage={analysis.leverage} />
          <CategoryRail
            battingRows={battingRows}
            pitchingRows={pitchingRows}
            highlightStatId={highlightStatId}
          />
          <div className="pt-2 border-t border-border-muted">
            <WeekProgress
              myStarts={myStarts}
              oppStarts={oppStarts}
              myRemaining={myRemaining}
              oppRemaining={oppRemaining}
              isLoading={probablesLoading}
              limits={limits}
              myUsedIp={myUsedIp}
              myUsedGs={myUsedGs}
              oppUsedIp={oppUsedIp}
              oppUsedGs={oppUsedGs}
            />
          </div>
        </div>

        {/* Right corner */}
        <div className="order-2 lg:order-3 flex justify-center lg:justify-end">
          <Corner
            teamName={opponent.name}
            logoUrl={oppLogo}
            record={oppRecord}
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

function BossCardSkeleton() {
  return (
    <section
      aria-label="Loading matchup"
      className="relative bg-surface rounded-xl shadow-sm border-y-2 border-accent/30 px-4 sm:px-6 py-5 sm:py-6 mb-6"
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
          <Skeleton className="h-12 w-full" />
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
