'use client';

import { useState, useMemo } from 'react';
import { FiArrowRight } from 'react-icons/fi';
import Icon from '@/components/Icon';
import { useFantasyContext } from '@/lib/hooks/useFantasyContext';
import { useRoster } from '@/lib/hooks/useRoster';
import { useRosterStats } from '@/lib/hooks/useRosterStats';
import { useLeagueCategories } from '@/lib/hooks/useLeagueCategories';
import { useAvailableBatters } from '@/lib/hooks/useAvailableBatters';
import { useFreeAgentStats } from '@/lib/hooks/useFreeAgentStats';
import type { RosterEntry, FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';
import type { BatterSeasonStats } from '@/lib/mlb/types';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import { isPitcher, getRowStatus } from '@/components/lineup/types';

// ---------------------------------------------------------------------------
// Category focus states
// ---------------------------------------------------------------------------

type FocusState = 'neutral' | 'chase' | 'punt';

function nextFocus(current: FocusState): FocusState {
  if (current === 'neutral') return 'chase';
  if (current === 'chase') return 'punt';
  return 'neutral';
}

// ---------------------------------------------------------------------------
// Stat mapping: league stat_id → BatterSeasonStats field
// ---------------------------------------------------------------------------

type StatGetter = (s: BatterSeasonStats) => number | null;

const BATTER_STAT_MAP: Record<number, StatGetter> = {
  3:  s => s.avg,          // AVG
  7:  s => s.runs,         // R
  8:  s => s.hits,         // H
  12: s => s.hr,           // HR
  13: s => s.rbi,          // RBI
  16: s => s.sb,           // SB
  18: s => s.walks,        // BB
  21: s => s.strikeouts,   // K (lower is better)
};

function getStatValue(stats: BatterSeasonStats, statId: number): number | null {
  const getter = BATTER_STAT_MAP[statId];
  return getter ? getter(stats) : null;
}

function formatStatValue(value: number | null, statId: number): string {
  if (value === null) return '-';
  if (statId === 3) return value.toFixed(3).replace(/^0/, ''); // AVG: .285
  return String(value);
}

// ---------------------------------------------------------------------------
// Scoring: rank players by contribution to chased categories
// ---------------------------------------------------------------------------

function chaseScore(
  stats: BatterSeasonStats | null,
  chasedCategories: EnrichedLeagueStatCategory[],
): number {
  if (!stats || chasedCategories.length === 0) return 0;
  let score = 0;
  for (const cat of chasedCategories) {
    const val = getStatValue(stats, cat.stat_id);
    if (val === null) continue;
    const norm = normalizeStatForRank(val, cat);
    score += norm;
  }
  return score;
}

function normalizeStatForRank(value: number, cat: EnrichedLeagueStatCategory): number {
  const id = cat.stat_id;
  // Counting stats: normalize to a 0-1ish scale based on typical season ranges
  const ranges: Record<number, [number, number]> = {
    7:  [20, 100],  // R
    8:  [40, 180],  // H
    12: [5, 45],    // HR
    13: [20, 110],  // RBI
    16: [2, 40],    // SB
    18: [15, 80],   // BB
    21: [30, 180],  // K (inverted below)
  };
  if (id === 3) return value; // AVG already 0-1 scale
  const range = ranges[id];
  if (!range) return value;
  const [min, max] = range;
  let norm = (value - min) / (max - min);
  if (cat.betterIs === 'lower') norm = 1 - norm;
  return Math.max(0, Math.min(1, norm));
}

// ---------------------------------------------------------------------------
// Category Focus Bar
// ---------------------------------------------------------------------------

function CategoryFocusBar({
  categories,
  focusMap,
  onToggle,
}: {
  categories: EnrichedLeagueStatCategory[];
  focusMap: Record<number, FocusState>;
  onToggle: (statId: number) => void;
}) {
  const batting = categories.filter(c => c.is_batter_stat);
  const pitching = categories.filter(c => c.is_pitcher_stat);

  return (
    <div className="bg-surface rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">Category Focus</h2>
        <span className="text-[10px] text-muted-foreground">
          Click: chase (green) / punt (dim) / neutral
        </span>
      </div>
      {batting.length > 0 && (
        <div className="mb-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Batting</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {batting.map(cat => (
              <FocusPill
                key={cat.stat_id}
                label={cat.display_name}
                state={focusMap[cat.stat_id] ?? 'neutral'}
                onClick={() => onToggle(cat.stat_id)}
              />
            ))}
          </div>
        </div>
      )}
      {pitching.length > 0 && (
        <div>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Pitching</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {pitching.map(cat => (
              <FocusPill
                key={cat.stat_id}
                label={cat.display_name}
                state={focusMap[cat.stat_id] ?? 'neutral'}
                onClick={() => onToggle(cat.stat_id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FocusPill({
  label,
  state,
  onClick,
}: {
  label: string;
  state: FocusState;
  onClick: () => void;
}) {
  const base = 'px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer transition-all select-none';
  const styles: Record<FocusState, string> = {
    chase: 'bg-success/20 text-success ring-1 ring-success/40',
    punt: 'bg-surface-muted text-muted-foreground/40 line-through',
    neutral: 'bg-surface-muted text-foreground hover:bg-surface-muted/80',
  };
  return (
    <button className={`${base} ${styles[state]}`} onClick={onClick}>
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Player stat row (shared between roster and free agent tables)
// ---------------------------------------------------------------------------

function StatCell({ value, statId, chased, punted }: {
  value: number | null;
  statId: number;
  chased: boolean;
  punted: boolean;
}) {
  const formatted = formatStatValue(value, statId);
  const color = chased
    ? 'text-success font-semibold'
    : punted
      ? 'text-muted-foreground/40'
      : 'text-foreground';
  return <td className={`px-2 py-1.5 text-right text-xs tabular-nums ${color}`}>{formatted}</td>;
}

function StatusBadge({ status }: { status: string }) {
  const isIL = status.includes('IL') || status === 'DL' || status === 'NA';
  const color = isIL ? 'bg-error/15 text-error' : 'bg-accent/15 text-accent';
  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${color}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Your Roster Table
// ---------------------------------------------------------------------------

function RosterTable({
  players,
  displayCategories,
  focusMap,
  getStats,
  chasedCategories,
}: {
  players: RosterEntry[];
  displayCategories: EnrichedLeagueStatCategory[];
  focusMap: Record<number, FocusState>;
  getStats: (name: string, team: string) => BatterSeasonStats | null;
  chasedCategories: EnrichedLeagueStatCategory[];
}) {
  const sorted = useMemo(() => {
    return [...players].sort((a, b) => {
      const sa = getStats(a.name, a.editorial_team_abbr);
      const sb_ = getStats(b.name, b.editorial_team_abbr);
      return chaseScore(sb_, chasedCategories) - chaseScore(sa, chasedCategories);
    });
  }, [players, getStats, chasedCategories]);

  if (sorted.length === 0) {
    return <p className="text-xs text-muted-foreground p-4">No batters on roster</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Player</th>
            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium w-10">Pos</th>
            {displayCategories.map(cat => (
              <th
                key={cat.stat_id}
                className={`text-right px-2 py-1.5 font-medium w-12 ${
                  focusMap[cat.stat_id] === 'chase'
                    ? 'text-success'
                    : focusMap[cat.stat_id] === 'punt'
                      ? 'text-muted-foreground/40'
                      : 'text-muted-foreground'
                }`}
              >
                {cat.display_name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(player => {
            const stats = getStats(player.name, player.editorial_team_abbr);
            const rowStatus = getRowStatus(player);
            const rowOpacity = rowStatus === 'injured' ? 'opacity-40' : '';
            return (
              <tr key={player.player_key} className={`border-b border-border/50 hover:bg-surface-muted/50 ${rowOpacity}`}>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-foreground font-medium truncate max-w-[140px]">{player.name}</span>
                    {player.status && <StatusBadge status={player.status} />}
                  </div>
                  <span className="text-[10px] text-muted-foreground">{player.editorial_team_abbr}</span>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{player.display_position}</td>
                {displayCategories.map(cat => (
                  <StatCell
                    key={cat.stat_id}
                    value={stats ? getStatValue(stats, cat.stat_id) : null}
                    statId={cat.stat_id}
                    chased={focusMap[cat.stat_id] === 'chase'}
                    punted={focusMap[cat.stat_id] === 'punt'}
                  />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upgrade Targets Table
// ---------------------------------------------------------------------------

function UpgradeTargetsTable({
  players,
  displayCategories,
  focusMap,
  getStats,
  chasedCategories,
  weakestRostered,
}: {
  players: FreeAgentPlayer[];
  displayCategories: EnrichedLeagueStatCategory[];
  focusMap: Record<number, FocusState>;
  getStats: (name: string, team: string) => BatterSeasonStats | null;
  chasedCategories: EnrichedLeagueStatCategory[];
  weakestRostered: BatterSeasonStats | null;
}) {
  const sorted = useMemo(() => {
    return [...players]
      .map(p => ({
        player: p,
        stats: getStats(p.name, p.editorial_team_abbr),
        score: chaseScore(getStats(p.name, p.editorial_team_abbr), chasedCategories),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);
  }, [players, getStats, chasedCategories]);

  if (sorted.length === 0) {
    return <p className="text-xs text-muted-foreground p-4">Loading available players...</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Player</th>
            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium w-10">Pos</th>
            {displayCategories.map(cat => (
              <th
                key={cat.stat_id}
                className={`text-right px-2 py-1.5 font-medium w-12 ${
                  focusMap[cat.stat_id] === 'chase'
                    ? 'text-success'
                    : focusMap[cat.stat_id] === 'punt'
                      ? 'text-muted-foreground/40'
                      : 'text-muted-foreground'
                }`}
              >
                {cat.display_name}
              </th>
            ))}
            {chasedCategories.length > 0 && (
              <th className="text-right px-2 py-1.5 text-success font-medium w-14">Score</th>
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ player, stats, score }) => {
            const isWaivers = player.ownership_type === 'waivers';
            return (
              <tr key={player.player_key} className="border-b border-border/50 hover:bg-surface-muted/50">
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-foreground font-medium truncate max-w-[140px]">{player.name}</span>
                    {isWaivers && (
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-accent/15 text-accent">W</span>
                    )}
                    {player.status && <StatusBadge status={player.status} />}
                  </div>
                  <span className="text-[10px] text-muted-foreground">{player.editorial_team_abbr}</span>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{player.display_position}</td>
                {displayCategories.map(cat => {
                  const val = stats ? getStatValue(stats, cat.stat_id) : null;
                  const weakVal = weakestRostered ? getStatValue(weakestRostered, cat.stat_id) : null;
                  const isChased = focusMap[cat.stat_id] === 'chase';
                  const showDelta = isChased && val !== null && weakVal !== null;
                  const delta = showDelta ? val - weakVal : 0;
                  return (
                    <td key={cat.stat_id} className="px-2 py-1.5 text-right">
                      <span className={`text-xs tabular-nums ${
                        focusMap[cat.stat_id] === 'chase'
                          ? 'text-success font-semibold'
                          : focusMap[cat.stat_id] === 'punt'
                            ? 'text-muted-foreground/40'
                            : 'text-foreground'
                      }`}>
                        {formatStatValue(val, cat.stat_id)}
                      </span>
                      {showDelta && delta !== 0 && (
                        <span className={`block text-[10px] ${delta > 0 ? 'text-success' : 'text-error'}`}>
                          {cat.betterIs === 'lower'
                            ? (delta < 0 ? '+' : '') + String(Math.abs(delta))
                            : (delta > 0 ? '+' : '') + String(delta)
                          }
                        </span>
                      )}
                    </td>
                  );
                })}
                {chasedCategories.length > 0 && (
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums text-success font-semibold">
                    {score.toFixed(2)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drop/Add Suggestions
// ---------------------------------------------------------------------------

interface SwapSuggestion {
  drop: RosterEntry;
  add: FreeAgentPlayer;
  deltas: { label: string; delta: number; betterIs: 'higher' | 'lower' }[];
  netScore: number;
}

function SwapSuggestions({
  suggestions,
}: {
  suggestions: SwapSuggestion[];
}) {
  if (suggestions.length === 0) return null;

  return (
    <div className="bg-surface rounded-lg shadow p-4">
      <h2 className="text-sm font-semibold text-foreground mb-3">Suggested Swaps</h2>
      <div className="space-y-2">
        {suggestions.slice(0, 5).map((swap, i) => (
          <div key={i} className="flex items-center gap-3 p-2 rounded bg-surface-muted/50">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-error font-medium truncate">{swap.drop.name}</span>
                <Icon icon={FiArrowRight} size={12} className="text-muted-foreground shrink-0" />
                <span className="text-xs text-success font-medium truncate">{swap.add.name}</span>
              </div>
              <div className="flex gap-2 mt-0.5">
                {swap.deltas.map(d => {
                  const isGood = d.betterIs === 'higher' ? d.delta > 0 : d.delta < 0;
                  return (
                    <span
                      key={d.label}
                      className={`text-[10px] font-semibold ${isGood ? 'text-success' : 'text-error'}`}
                    >
                      {d.betterIs === 'lower'
                        ? (d.delta < 0 ? '+' : '') + String(Math.abs(d.delta))
                        : (d.delta > 0 ? '+' : '') + String(d.delta)
                      } {d.label}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="text-right shrink-0">
              <span className={`text-xs font-bold ${swap.netScore > 0 ? 'text-success' : 'text-error'}`}>
                {swap.netScore > 0 ? '+' : ''}{swap.netScore.toFixed(2)}
              </span>
              <span className="block text-[10px] text-muted-foreground">net score</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main RosterManager
// ---------------------------------------------------------------------------

export default function RosterManager() {
  const { teamKey, leagueKey, isLoading: ctxLoading, isError: ctxError } = useFantasyContext();
  const { roster, isLoading: rosterLoading } = useRoster(teamKey);
  const { categories, isLoading: catsLoading } = useLeagueCategories(leagueKey);
  const { getPlayerStats: getRosterPlayerStats } = useRosterStats(roster);

  // Fetch available batters (extended pool for optimizer)
  const { batters: availableBatters, isLoading: battersLoading } = useAvailableBatters(leagueKey, true);
  const { getPlayerStats: getFAStats } = useFreeAgentStats(availableBatters);

  // Category focus state
  const [focusMap, setFocusMap] = useState<Record<number, FocusState>>({});

  const toggleFocus = (statId: number) => {
    setFocusMap(prev => ({
      ...prev,
      [statId]: nextFocus(prev[statId] ?? 'neutral'),
    }));
  };

  // Derived data
  const battingCategories = useMemo(
    () => categories.filter(c => c.is_batter_stat),
    [categories],
  );

  const displayCategories = useMemo(
    () => battingCategories.filter(c => BATTER_STAT_MAP[c.stat_id]),
    [battingCategories],
  );

  const chasedCategories = useMemo(
    () => displayCategories.filter(c => focusMap[c.stat_id] === 'chase'),
    [displayCategories, focusMap],
  );

  // Filter roster to batters only
  const rosterBatters = useMemo(
    () => roster.filter(p => !isPitcher(p)),
    [roster],
  );

  // Find the weakest rostered batter (by chase score) for delta comparison
  const weakestRostered = useMemo(() => {
    if (chasedCategories.length === 0 || rosterBatters.length === 0) return null;
    const activeBatters = rosterBatters.filter(p => getRowStatus(p) === 'starter' || getRowStatus(p) === 'bench');
    let weakest: BatterSeasonStats | null = null;
    let weakestScore = Infinity;
    for (const p of activeBatters) {
      const stats = getRosterPlayerStats(p.name, p.editorial_team_abbr);
      if (!stats) continue;
      const score = chaseScore(stats, chasedCategories);
      if (score < weakestScore) {
        weakestScore = score;
        weakest = stats;
      }
    }
    return weakest;
  }, [rosterBatters, getRosterPlayerStats, chasedCategories]);

  // Compute swap suggestions
  const swapSuggestions = useMemo(() => {
    if (chasedCategories.length === 0) return [];
    const activeBatters = rosterBatters.filter(p => getRowStatus(p) !== 'injured');

    const suggestions: SwapSuggestion[] = [];

    // For each roster batter, check if any free agent is a net upgrade on chased stats
    for (const dropCandidate of activeBatters) {
      const dropStats = getRosterPlayerStats(dropCandidate.name, dropCandidate.editorial_team_abbr);
      if (!dropStats) continue;
      const dropScore = chaseScore(dropStats, chasedCategories);

      for (const addCandidate of availableBatters) {
        const addStats = getFAStats(addCandidate.name, addCandidate.editorial_team_abbr);
        if (!addStats) continue;
        const addScore = chaseScore(addStats, chasedCategories);
        const netScore = addScore - dropScore;

        if (netScore > 0.05) {
          const deltas: SwapSuggestion['deltas'] = [];
          for (const cat of chasedCategories) {
            const dropVal = getStatValue(dropStats, cat.stat_id);
            const addVal = getStatValue(addStats, cat.stat_id);
            if (dropVal !== null && addVal !== null) {
              const delta = cat.stat_id === 3
                ? Math.round((addVal - dropVal) * 1000) / 1000
                : addVal - dropVal;
              if (delta !== 0) {
                deltas.push({ label: cat.display_name, delta, betterIs: cat.betterIs });
              }
            }
          }
          suggestions.push({ drop: dropCandidate, add: addCandidate, deltas, netScore });
        }
      }
    }

    suggestions.sort((a, b) => b.netScore - a.netScore);
    // Dedupe: only show each add candidate once (best swap)
    const seenAdds = new Set<string>();
    return suggestions.filter(s => {
      if (seenAdds.has(s.add.player_key)) return false;
      seenAdds.add(s.add.player_key);
      return true;
    });
  }, [rosterBatters, availableBatters, getRosterPlayerStats, getFAStats, chasedCategories]);

  const isLoading = ctxLoading || rosterLoading || catsLoading;

  if (ctxError) {
    return (
      <div className="p-6">
        <div className="bg-surface rounded-lg shadow p-8 text-center">
          <p className="text-sm text-error">Failed to load fantasy context</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">Roster Optimizer</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Chase the stats that matter — click categories to focus your roster moves
        </p>
      </div>

      {/* Category Focus Bar */}
      {!catsLoading && categories.length > 0 && (
        <CategoryFocusBar
          categories={categories}
          focusMap={focusMap}
          onToggle={toggleFocus}
        />
      )}

      {isLoading ? (
        <div className="bg-surface rounded-lg shadow p-8 text-center">
          <div className="animate-pulse text-sm text-muted-foreground">Loading roster data...</div>
        </div>
      ) : (
        <>
          {/* Swap Suggestions */}
          <SwapSuggestions suggestions={swapSuggestions} />

          {/* Two-column layout: roster + upgrade targets */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Your Roster */}
            <div className="bg-surface rounded-lg shadow p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-foreground">Your Batters</h2>
                <span className="text-[10px] text-muted-foreground">{rosterBatters.length} on roster</span>
              </div>
              <RosterTable
                players={rosterBatters}
                displayCategories={displayCategories}
                focusMap={focusMap}
                getStats={getRosterPlayerStats}
                chasedCategories={chasedCategories}
              />
            </div>

            {/* Upgrade Targets */}
            <div className="bg-surface rounded-lg shadow p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-foreground">Upgrade Targets</h2>
                <span className="text-[10px] text-muted-foreground">
                  {battersLoading ? 'Loading...' : `${availableBatters.length} available`}
                </span>
              </div>
              <UpgradeTargetsTable
                players={availableBatters}
                displayCategories={displayCategories}
                focusMap={focusMap}
                getStats={getFAStats}
                chasedCategories={chasedCategories}
                weakestRostered={weakestRostered}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
