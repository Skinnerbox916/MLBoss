'use client';

import { useState, useMemo } from 'react';
import { FiChevronUp, FiChevronDown } from 'react-icons/fi';
import Icon from '@/components/Icon';
import Panel from '@/components/ui/Panel';
import Tabs from '@/components/ui/Tabs';
import { Heading } from '@/components/typography';
import { useFantasyContext } from '@/lib/hooks/useFantasyContext';
import { useStandings } from '@/lib/hooks/useStandings';
import { useLeagueCategories } from '@/lib/hooks/useLeagueCategories';
import { formatStatValue } from '@/lib/formatStat';
import type { StandingsEntry, StatValue } from '@/lib/yahoo-fantasy-api';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStatVal(stats: StatValue[], statId: number): number | null {
  const entry = stats.find(s => s.stat_id === statId);
  if (!entry) return null;
  const num = parseFloat(entry.value);
  return isNaN(num) ? null : num;
}

function formatStat(value: number | null, cat: EnrichedLeagueStatCategory): string {
  return formatStatValue(value, cat.display_name);
}

type SortDir = 'asc' | 'desc';

interface SortState {
  key: 'rank' | number; // 'rank' or stat_id
  dir: SortDir;
}

function rankTeams(
  standings: StandingsEntry[],
  statId: number,
  betterIs: 'higher' | 'lower',
): Map<string, number> {
  const withVal = standings.map(t => ({
    teamKey: t.team_key,
    val: getStatVal(t.stats ?? [], statId),
  }));
  withVal.sort((a, b) => {
    if (a.val === null && b.val === null) return 0;
    if (a.val === null) return 1;
    if (b.val === null) return -1;
    return betterIs === 'higher' ? b.val - a.val : a.val - b.val;
  });
  const ranks = new Map<string, number>();
  withVal.forEach((t, i) => ranks.set(t.teamKey, i + 1));
  return ranks;
}

// ---------------------------------------------------------------------------
// Standings Table
// ---------------------------------------------------------------------------

function StandingsTable({
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
              <th className="text-right px-2 py-1.5 text-muted-foreground font-medium w-14">GB</th>
              {sorted[0]?.streak !== undefined && (
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
                  <td className="px-2 py-1.5 text-right text-muted-foreground">{team.points_back ?? '-'}</td>
                  {sorted[0]?.streak !== undefined && (
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

// ---------------------------------------------------------------------------
// Stat Rankings Table
// ---------------------------------------------------------------------------

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th
      className="text-right px-2 py-1.5 font-medium cursor-pointer select-none hover:text-foreground text-muted-foreground whitespace-nowrap"
      onClick={onClick}
    >
      <span className={active ? 'text-accent' : ''}>{label}</span>
      {active && (
        <Icon
          icon={dir === 'desc' ? FiChevronDown : FiChevronUp}
          size={10}
          className="inline ml-0.5 text-accent"
        />
      )}
    </th>
  );
}

function RankBadge({ rank, total }: { rank: number; total: number }) {
  const color =
    rank === 1 ? 'text-success font-bold' :
    rank <= 3 ? 'text-success' :
    rank >= total - 1 ? 'text-error' :
    rank >= total - 3 ? 'text-accent' :
    'text-muted-foreground';
  return <span className={`text-caption ${color}`}>{rank}</span>;
}

function StatRankingsTable({
  standings,
  categories,
  userTeamKey,
}: {
  standings: StandingsEntry[];
  categories: EnrichedLeagueStatCategory[];
  userTeamKey: string | undefined;
}) {
  const batting = useMemo(() => categories.filter(c => c.is_batter_stat), [categories]);
  const pitching = useMemo(() => categories.filter(c => c.is_pitcher_stat), [categories]);
  const [tab, setTab] = useState<'batting' | 'pitching'>('batting');
  const displayCats = tab === 'batting' ? batting : pitching;

  const [sort, setSort] = useState<SortState>({ key: 'rank', dir: 'asc' });

  const toggleSort = (key: 'rank' | number) => {
    setSort(prev => {
      if (prev.key === key) return { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' };
      // Default sort direction based on betterIs for stat columns
      if (typeof key === 'number') {
        const cat = categories.find(c => c.stat_id === key);
        return { key, dir: cat?.betterIs === 'lower' ? 'asc' : 'desc' };
      }
      return { key, dir: 'asc' };
    });
  };

  // Pre-compute per-stat ranks
  const rankMaps = useMemo(() => {
    const maps: Record<number, Map<string, number>> = {};
    for (const cat of displayCats) {
      maps[cat.stat_id] = rankTeams(standings, cat.stat_id, cat.betterIs);
    }
    return maps;
  }, [standings, displayCats]);

  const sorted = useMemo(() => {
    return [...standings].sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1;
      if (sort.key === 'rank') {
        return ((a.rank ?? 99) - (b.rank ?? 99)) * dir;
      }
      const valA = getStatVal(a.stats ?? [], sort.key);
      const valB = getStatVal(b.stats ?? [], sort.key);
      if (valA === null && valB === null) return 0;
      if (valA === null) return 1;
      if (valB === null) return -1;
      return (valA - valB) * dir;
    });
  }, [standings, sort]);

  return (
    <Panel
      title="Stat Rankings"
      action={
        <Tabs
          variant="underline"
          items={[
            { id: 'batting', label: 'Batting' },
            { id: 'pitching', label: 'Pitching' },
          ]}
          value={tab}
          onChange={setTab}
          ariaLabel="Stat category group"
        />
      }
    >
      <p className="text-caption text-muted-foreground mb-2">
        Click any column header to sort. Rank numbers show league position per category.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <SortHeader
                label="Team"
                active={sort.key === 'rank'}
                dir={sort.dir}
                onClick={() => toggleSort('rank')}
              />
              {displayCats.map(cat => (
                <SortHeader
                  key={cat.stat_id}
                  label={cat.display_name}
                  active={sort.key === cat.stat_id}
                  dir={sort.dir}
                  onClick={() => toggleSort(cat.stat_id)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(team => {
              const isUser = team.team_key === userTeamKey;
              const rowClass = isUser ? 'bg-primary/5' : '';
              return (
                <tr key={team.team_key} className={`border-b border-border/50 hover:bg-surface-muted/50 ${rowClass}`}>
                  <td className="px-2 py-1.5 text-left whitespace-nowrap">
                    <span className={`font-medium ${isUser ? 'text-accent' : 'text-foreground'}`}>
                      {team.name}
                    </span>
                  </td>
                  {displayCats.map(cat => {
                    const val = getStatVal(team.stats ?? [], cat.stat_id);
                    const rank = rankMaps[cat.stat_id]?.get(team.team_key);
                    return (
                      <td key={cat.stat_id} className="px-2 py-1.5 text-right">
                        <span className="text-foreground tabular-nums">
                          {formatStat(val, cat)}
                        </span>
                        {rank !== undefined && (
                          <span className="ml-1">
                            <RankBadge rank={rank} total={standings.length} />
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Main LeagueManager
// ---------------------------------------------------------------------------

export default function LeagueManager() {
  const { teamKey, leagueKey, isLoading: ctxLoading, isError: ctxError } = useFantasyContext();
  const { standings, isLoading: standingsLoading } = useStandings(leagueKey);
  const { categories, isLoading: catsLoading } = useLeagueCategories(leagueKey);

  const isLoading = ctxLoading || standingsLoading || catsLoading;

  if (ctxError) {
    return (
      <div className="p-6">
        <Panel className="p-8 text-center">
          <p className="text-sm text-error">Failed to load fantasy context</p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <Heading as="h1">League Overview</Heading>
        <p className="text-xs text-muted-foreground mt-0.5">
          Standings and stat rankings across your league
        </p>
      </div>

      {isLoading ? (
        <Panel className="p-8 text-center">
          <div className="animate-pulse text-sm text-muted-foreground">Loading league data...</div>
        </Panel>
      ) : (
        <>
          <StandingsTable standings={standings} userTeamKey={teamKey} />
          {categories.length > 0 && (
            <StatRankingsTable
              standings={standings}
              categories={categories}
              userTeamKey={teamKey}
            />
          )}
        </>
      )}
    </div>
  );
}
