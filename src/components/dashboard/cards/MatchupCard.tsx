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

function formatDelta(delta: number, name: string): string {
  if (delta === 0) return 'TIE';
  const sign = delta > 0 ? '+' : '-';
  const abs = Math.abs(delta);
  if (name === 'AVG' || name === 'OBP' || name === 'SLG' || name === 'OPS') {
    return sign + abs.toFixed(3).replace(/^0\./, '.');
  }
  if (name === 'ERA' || name === 'WHIP') return sign + abs.toFixed(2);
  if (name === 'IP') return sign + abs.toFixed(1);
  return (delta > 0 ? '+' : '') + (Number.isInteger(delta) ? delta.toString() : delta.toFixed(3));
}

interface StatTile {
  label: string;
  myVal: string;
  oppVal: string;
  delta: string;
  winning: boolean | null;
  isTie: boolean;
}

function buildTiles(
  cats: EnrichedLeagueStatCategory[],
  myMap: Map<number, string>,
  oppMap: Map<number, string>,
): StatTile[] {
  return cats.flatMap(cat => {
    const myRaw = myMap.get(cat.stat_id);
    const oppRaw = oppMap.get(cat.stat_id);
    if (myRaw === undefined || oppRaw === undefined) return [];

    const myNum = parseFloat(myRaw);
    const oppNum = parseFloat(oppRaw);
    const valid = !isNaN(myNum) && !isNaN(oppNum);

    let winning: boolean | null = null;
    let delta = 0;
    if (valid) {
      delta = myNum - oppNum;
      if (delta !== 0) winning = cat.betterIs === 'higher' ? delta > 0 : delta < 0;
    }

    return [{
      label: cat.display_name,
      myVal: myRaw,
      oppVal: oppRaw,
      delta: valid ? formatDelta(delta, cat.name) : '—',
      winning,
      isTie: valid && delta === 0,
    }];
  });
}

function StatTileEl({ tile }: { tile: StatTile }) {
  const bg = tile.winning === true
    ? 'bg-success/10 border-success/30'
    : tile.winning === false
      ? 'bg-error/10 border-error/30'
      : 'bg-surface-muted border-border-muted';
  const textColor = tile.winning === true
    ? 'text-success'
    : tile.winning === false
      ? 'text-error'
      : 'text-muted-foreground';

  return (
    <div className={`border rounded p-2 text-center ${bg}`}>
      <div className="text-xs text-muted-foreground font-medium truncate">{tile.label}</div>
      <div className={`text-sm font-bold ${textColor}`}>{tile.delta}</div>
      <div className="text-xs text-muted-foreground">{tile.myVal} / {tile.oppVal}</div>
    </div>
  );
}

// Yahoo returns team_logos in several shapes depending on the endpoint:
//   Array<{ size, url }>                    — normalized / ideal
//   Array<{ team_logo: { size, url } }>     — common raw shape
//   { team_logo: { size, url } }            — single-logo object shape
// Walk all possibilities and return the first URL found.
function extractLogoUrl(raw: unknown): string | undefined {
  if (!raw) return undefined;
  const items: unknown[] = Array.isArray(raw) ? raw : [raw];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    // Standard flat format
    if (typeof obj.url === 'string' && obj.url) return obj.url;
    // Nested { team_logo: { size, url } }
    const nested = obj.team_logo as Record<string, unknown> | undefined;
    if (nested && typeof nested.url === 'string' && nested.url) return nested.url;
  }
  return undefined;
}

function TeamAvatar({ logos, name, side }: {
  logos: Array<{ size: string; url: string }>;
  name: string;
  side: 'user' | 'opp';
}) {
  const url = extractLogoUrl(logos);
  const initial = name.charAt(0).toUpperCase();
  const bg = side === 'user' ? 'bg-accent/20 text-accent' : 'bg-primary/20 text-primary';

  return (
    <div className="flex flex-col items-center gap-1 min-w-0 flex-1">
      <div className={`h-10 w-10 rounded-full overflow-hidden border-2 border-border flex items-center justify-center ${!url ? bg : ''}`}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={name} className="h-full w-full object-cover"
            onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement!.classList.add(...bg.split(' ')); e.currentTarget.parentElement!.innerHTML = `<span class="font-bold text-sm">${initial}</span>`; }} />
        ) : (
          <span className="font-bold text-sm">{initial}</span>
        )}
      </div>
      <span className="text-xs font-medium text-foreground text-center leading-tight line-clamp-2">{name}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export default function MatchupCard() {
  const { leagueKey, teamKey, isLoading: contextLoading } = useFantasy();
  const { matchups, week, isLoading: scoreLoading } = useScoreboard(leagueKey);
  const { categories, isLoading: catsLoading, isError } = useLeagueCategories(leagueKey);

  const isLoading = contextLoading || scoreLoading || catsLoading;

  const userMatchup = matchups.find(m => m.teams.some(t => t.team_key === teamKey));
  const userTeam = userMatchup?.teams.find(t => t.team_key === teamKey);
  const opponent = userMatchup?.teams.find(t => t.team_key !== teamKey);

  const battingCats = categories.filter(c => c.is_batter_stat);
  const pitchingCats = categories.filter(c => c.is_pitcher_stat);

  let battingTiles: StatTile[] = [];
  let pitchingTiles: StatTile[] = [];
  let wins = 0, losses = 0, ties = 0;

  if (userTeam?.stats && opponent?.stats) {
    const myMap = new Map(userTeam.stats.map(s => [s.stat_id, s.value]));
    const oppMap = new Map(opponent.stats.map(s => [s.stat_id, s.value]));

    battingTiles = buildTiles(battingCats, myMap, oppMap);
    pitchingTiles = buildTiles(pitchingCats, myMap, oppMap);

    for (const t of [...battingTiles, ...pitchingTiles]) {
      if (t.winning === true) wins++;
      else if (t.winning === false) losses++;
      else ties++;
    }
  }

  const hasTiles = battingTiles.length > 0 || pitchingTiles.length > 0;

  return (
    <DashboardCard
      title={week ? `Matchup — Week ${week}` : "This Week's Matchup"}
      icon={GiBaseballGlove}
      size="lg"
      isLoading={isLoading}
    >
      {isError ? (
        <p className="text-sm text-error">Failed to load matchup data</p>
      ) : !userMatchup ? (
        <p className="text-sm text-muted-foreground">No matchup data available</p>
      ) : (
        <div className="space-y-4">
          {/* Face-off header */}
          <div className="flex items-center gap-3">
            <TeamAvatar logos={userTeam?.team_logos ?? []} name="Your Team" side="user" />
            <div className="flex flex-col items-center shrink-0">
              {/* W-L-T */}
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-success">{wins}</span>
                <span className="text-muted-foreground text-sm">-</span>
                <span className="text-2xl font-bold text-error">{losses}</span>
                <span className="text-muted-foreground text-sm">-</span>
                <span className="text-2xl font-bold text-muted-foreground">{ties}</span>
              </div>
              <span className="text-xs text-muted-foreground">W — L — T</span>
            </div>
            <TeamAvatar logos={opponent?.team_logos ?? []} name={opponent?.name ?? 'Opponent'} side="opp" />
          </div>

          {hasTiles ? (
            <>
              {/* Batting categories */}
              {battingTiles.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Batting</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {battingTiles.map(t => <StatTileEl key={t.label} tile={t} />)}
                  </div>
                </div>
              )}
              {/* Pitching categories */}
              {pitchingTiles.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Pitching</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {pitchingTiles.map(t => <StatTileEl key={t.label} tile={t} />)}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Stats will appear once the week begins.</p>
          )}
        </div>
      )}
    </DashboardCard>
  );
}
