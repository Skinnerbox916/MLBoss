'use client';

import { GiBaseballGlove } from 'react-icons/gi';
import DashboardCard from '../DashboardCard';
import { useFantasy } from '../FantasyProvider';
import { useScoreboard } from '@/lib/hooks/useScoreboard';
import { useLeagueCategories } from '@/lib/hooks/useLeagueCategories';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countResults(
  cats: EnrichedLeagueStatCategory[],
  myMap: Map<number, string>,
  oppMap: Map<number, string>,
): { wins: number; losses: number; ties: number } {
  let wins = 0, losses = 0, ties = 0;
  for (const cat of cats) {
    const myRaw = myMap.get(cat.stat_id);
    const oppRaw = oppMap.get(cat.stat_id);
    if (myRaw === undefined || oppRaw === undefined) continue;
    const myNum = parseFloat(myRaw);
    const oppNum = parseFloat(oppRaw);
    if (isNaN(myNum) || isNaN(oppNum)) continue;
    const delta = myNum - oppNum;
    if (delta === 0) { ties++; continue; }
    const winning = cat.betterIs === 'higher' ? delta > 0 : delta < 0;
    if (winning) wins++; else losses++;
  }
  return { wins, losses, ties };
}

function extractLogoUrl(raw: unknown): string | undefined {
  if (!raw) return undefined;
  const items: unknown[] = Array.isArray(raw) ? raw : [raw];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.url === 'string' && obj.url) return obj.url;
    const nested = obj.team_logo as Record<string, unknown> | undefined;
    if (nested && typeof nested.url === 'string' && nested.url) return nested.url;
  }
  return undefined;
}

function TeamBadge({ logos, name, side }: {
  logos: Array<{ size: string; url: string }>;
  name: string;
  side: 'user' | 'opp';
}) {
  const url = extractLogoUrl(logos);
  const initial = name.charAt(0).toUpperCase();
  const bg = side === 'user' ? 'bg-accent/20 text-accent' : 'bg-primary/20 text-primary';

  return (
    <div className="flex flex-col items-center gap-1 min-w-0 flex-1">
      <div className={`h-9 w-9 rounded-full overflow-hidden border-2 border-border flex items-center justify-center ${!url ? bg : ''}`}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={name} className="h-full w-full object-cover"
            onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement!.classList.add(...bg.split(' ')); e.currentTarget.parentElement!.innerHTML = `<span class="font-bold text-xs">${initial}</span>`; }} />
        ) : (
          <span className="font-bold text-xs">{initial}</span>
        )}
      </div>
      <span className="text-xs font-medium text-foreground text-center leading-tight line-clamp-2">{name}</span>
    </div>
  );
}

function ScoreBar({ wins, losses, ties }: { wins: number; losses: number; ties: number }) {
  const total = wins + losses + ties;
  if (total === 0) return null;
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden bg-border-muted gap-px">
      {wins > 0 && <div className="bg-success rounded-full" style={{ width: `${(wins / total) * 100}%` }} />}
      {ties > 0 && <div className="bg-muted-foreground/30 rounded-full" style={{ width: `${(ties / total) * 100}%` }} />}
      {losses > 0 && <div className="bg-error rounded-full" style={{ width: `${(losses / total) * 100}%` }} />}
    </div>
  );
}

// Fantasy baseball weeks run Mon–Sun. Compute which day of the week it is.
function useWeekProgress(): { day: number; progress: number } {
  const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const day = dayOfWeek === 0 ? 7 : dayOfWeek; // Mon=1 … Sun=7
  return { day, progress: day / 7 };
}

function WeekProgressBar({ day, progress }: { day: number; progress: number }) {
  const remaining = 7 - day;
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Week Progress</span>
        <span className="text-[10px] text-muted-foreground">
          {remaining === 0 ? 'Final day' : `${remaining}d left`}
        </span>
      </div>
      <div className="h-1 rounded-full bg-border-muted overflow-hidden">
        <div
          className="h-full bg-accent/60 rounded-full transition-all"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}

function SubScore({ label, wins, losses, ties }: {
  label: string; wins: number; losses: number; ties: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className="text-sm font-bold font-mono tabular-nums">
        <span className="text-success">{wins}</span>
        <span className="text-muted-foreground">–</span>
        <span className="text-error">{losses}</span>
        {ties > 0 && (
          <>
            <span className="text-muted-foreground">–</span>
            <span className="text-muted-foreground">{ties}</span>
          </>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export default function MatchupCard() {
  const weekProgress = useWeekProgress();
  const { leagueKey, teamKey, currentWeek, isLoading: contextLoading } = useFantasy();
  const { matchups, week, isLoading: scoreLoading } = useScoreboard(leagueKey);
  const { categories, isLoading: catsLoading, isError } = useLeagueCategories(leagueKey);

  const isLoading = contextLoading || scoreLoading || catsLoading;

  const userMatchup = matchups.find(m => m.teams.some(t => t.team_key === teamKey));
  const userTeam = userMatchup?.teams.find(t => t.team_key === teamKey);
  const opponent = userMatchup?.teams.find(t => t.team_key !== teamKey);

  const battingCats = categories.filter(c => c.is_batter_stat);
  const pitchingCats = categories.filter(c => c.is_pitcher_stat);

  let batting = { wins: 0, losses: 0, ties: 0 };
  let pitching = { wins: 0, losses: 0, ties: 0 };

  if (userTeam?.stats && opponent?.stats) {
    const myMap = new Map(userTeam.stats.map(s => [s.stat_id, s.value]));
    const oppMap = new Map(opponent.stats.map(s => [s.stat_id, s.value]));
    batting = countResults(battingCats, myMap, oppMap);
    pitching = countResults(pitchingCats, myMap, oppMap);
  }

  const totalWins = batting.wins + pitching.wins;
  const totalLosses = batting.losses + pitching.losses;
  const totalTies = batting.ties + pitching.ties;
  const totalCats = totalWins + totalLosses + totalTies;

  const displayWeek = userMatchup?.week
    ?? (typeof week === 'number' ? week : undefined)
    ?? currentWeek;

  return (
    <DashboardCard
      title={displayWeek ? `Matchup — Week ${displayWeek}` : "This Week's Matchup"}
      icon={GiBaseballGlove}
      size="md"
      isLoading={isLoading}
    >
      {isError ? (
        <p className="text-sm text-error">Failed to load matchup data</p>
      ) : !userMatchup ? (
        <p className="text-sm text-muted-foreground">No matchup data available</p>
      ) : (
        <div className="space-y-3">
          {/* Face-off header */}
          <div className="flex items-center gap-3">
            <TeamBadge logos={userTeam?.team_logos ?? []} name={userTeam?.name ?? 'Your Team'} side="user" />
            <div className="flex flex-col items-center shrink-0 gap-0.5">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-bold text-success">{totalWins}</span>
                <span className="text-lg text-muted-foreground font-light">·</span>
                <span className="text-3xl font-bold text-error">{totalLosses}</span>
                <span className="text-lg text-muted-foreground font-light">·</span>
                <span className="text-3xl font-bold text-muted-foreground">{totalTies}</span>
              </div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest">W · L · T</span>
            </div>
            <TeamBadge logos={opponent?.team_logos ?? []} name={opponent?.name ?? 'Opponent'} side="opp" />
          </div>

          {/* Category score bar */}
          <ScoreBar wins={totalWins} losses={totalLosses} ties={totalTies} />

          {/* Week progress */}
          <WeekProgressBar day={weekProgress.day} progress={weekProgress.progress} />

          {/* Batting / Pitching sub-scores */}
          {totalCats > 0 && (
            <div className="flex justify-around pt-0.5">
              <SubScore label="Bat" wins={batting.wins} losses={batting.losses} ties={batting.ties} />
              <div className="w-px bg-border self-stretch" />
              <SubScore label="Pitch" wins={pitching.wins} losses={pitching.losses} ties={pitching.ties} />
            </div>
          )}
        </div>
      )}
    </DashboardCard>
  );
}
