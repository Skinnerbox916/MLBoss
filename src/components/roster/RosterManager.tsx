'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { FiArrowRight, FiAlertTriangle, FiTrendingUp, FiLayers, FiPlus, FiMinus, FiRotateCcw, FiChevronUp, FiChevronDown } from 'react-icons/fi';
import Icon from '@/components/Icon';
import Badge from '@/components/ui/Badge';
import Panel from '@/components/ui/Panel';
import Tabs from '@/components/ui/Tabs';
import { useFantasyContext } from '@/lib/hooks/useFantasyContext';
import { useRoster } from '@/lib/hooks/useRoster';
import { useRosterStats } from '@/lib/hooks/useRosterStats';
import { useLeagueCategories } from '@/lib/hooks/useLeagueCategories';
import { useAvailableBatters } from '@/lib/hooks/useAvailableBatters';
import { useAvailablePitchers } from '@/lib/hooks/useAvailablePitchers';
import { useFreeAgentStats } from '@/lib/hooks/useFreeAgentStats';
import { useRosterPositions } from '@/lib/hooks/useRosterPositions';
import { useSeasonCategoryRanks } from '@/lib/hooks/useSeasonCategoryRanks';
import { usePlayerMarketSignals } from '@/lib/hooks/usePlayerMarketSignals';
import RankStrip from '@/components/shared/RankStrip';
import type { RosterEntry, FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';
import { formatStatValue } from '@/lib/formatStat';
import type { BatterSeasonStats, PlayerStatLine } from '@/lib/mlb/types';
import { fromBatterSeasonStats } from '@/lib/mlb/adapters';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import { isPitcher, getRowStatus } from '@/components/lineup/types';
import {
  BATTER_POSITIONS,
  type BatterPosition,
  type ScoredPlayer,
  type RankedSwap,
  type PositionValue,
  getBatterPositions,
  parseStartingSlots,
  computeReplacementLevel,
  computeRosterValue,
  generateSwapSuggestions,
  getDefaultDepth,
} from '@/lib/roster/depth';
import {
  blendedCategoryScore,
  estimateFullTimePaceRef,
  estimateFullTimeGpRef,
  playingTimeFactor,
} from '@/lib/roster/scoring';
import CategoryFocusBar, {
  nextFocus,
  type FocusState,
} from '@/components/shared/CategoryFocusBar';

// ---------------------------------------------------------------------------
// Stat mapping: league stat_id → PlayerStatLine accessor
// ---------------------------------------------------------------------------
// Pulls from `line.current` (the season the player's primary counting
// data came from — this is `season - 1` for the prior-year fallback case
// where the IL'd player has no current-year line). Falls back to `prior`
// only when current is missing entirely.

type StatGetter = (line: PlayerStatLine) => number | null;

const pickCounting = (line: PlayerStatLine, field: keyof NonNullable<PlayerStatLine['current']>) => {
  const counting = line.current ?? line.prior;
  if (!counting) return null;
  const value = counting[field];
  return typeof value === 'number' ? value : null;
};

const BATTER_STAT_MAP: Record<number, StatGetter> = {
  3:  line => pickCounting(line, 'avg'),
  7:  line => pickCounting(line, 'runs'),
  8:  line => pickCounting(line, 'hits'),
  12: line => pickCounting(line, 'hr'),
  13: line => pickCounting(line, 'rbi'),
  16: line => pickCounting(line, 'sb'),
  18: line => pickCounting(line, 'walks'),
  21: line => pickCounting(line, 'strikeouts'),
  23: line => pickCounting(line, 'totalBases'),
};

function getStatValue(
  input: PlayerStatLine | BatterSeasonStats,
  statId: number,
): number | null {
  const getter = BATTER_STAT_MAP[statId];
  if (!getter) return null;
  // Migration shim: existing call sites pass BatterSeasonStats; the map
  // itself reads from PlayerStatLine. Adapt on the way in until Phase 4
  // moves the producers (hooks, API route) over to the new shape.
  const line = 'identity' in input ? input : fromBatterSeasonStats(input);
  return getter(line);
}

// Healthy free agents below this ownership level are filtered from the
// upgrade table and swap-optimizer FA pool. The league's collective drop
// is a stronger signal than any per-PA rate. IL players bypass the floor
// — a dropped IL'd stud is exactly the stash play we want visible.
const UPGRADE_TARGET_OWNERSHIP_FLOOR = 5;

/**
 * True when a free agent is on a real Injured List status (IL10/IL15/IL60,
 * legacy DL) — i.e. a player who's coming back to the active roster after
 * a defined recovery period. NA (Not Active — minor-league assignments,
 * suspensions, opt-outs), DTD (day-to-day, still playing through it), and
 * other status codes are deliberately excluded. Only true IL gets the
 * stash-bypass treatment in the upgrade table; everything else has to
 * earn its slot through ownership and current performance.
 */
function isStashableIL(p: { on_disabled_list?: boolean; status?: string }): boolean {
  if (p.on_disabled_list) return true;
  if (!p.status) return false;
  return /^IL\d*$/i.test(p.status) || p.status.toUpperCase() === 'DL';
}

// ---------------------------------------------------------------------------
// Depth Chart
// ---------------------------------------------------------------------------

function depthStatus(pv: PositionValue): { label: string; color: string } {
  if (pv.startingSlots === 0) return { label: '—', color: 'text-muted-foreground/50' };
  if (pv.depthShortfall > 0) return { label: 'GAP', color: 'text-error' };
  if (pv.eligibleCount >= pv.minDepth + 2) return { label: 'deep', color: 'text-success' };
  return { label: 'ok', color: 'text-accent' };
}

function DepthStepper({
  value,
  defaultValue,
  min,
  max,
  onChange,
}: {
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  onChange: (next: number | null) => void;
}) {
  const isCustom = value !== defaultValue;
  const canDec = value > min;
  const canInc = value < max;
  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        aria-label="Decrease preferred depth"
        disabled={!canDec}
        onClick={() => canDec && onChange(value - 1)}
        className="flex h-5 w-5 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted-foreground"
      >
        <Icon icon={FiMinus} size={10} />
      </button>
      <span
        className={`tabular-nums text-xs font-semibold min-w-[1.25rem] text-center ${
          isCustom ? 'text-accent' : 'text-foreground'
        }`}
      >
        {value}
      </span>
      <button
        type="button"
        aria-label="Increase preferred depth"
        disabled={!canInc}
        onClick={() => canInc && onChange(value + 1)}
        className="flex h-5 w-5 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted-foreground"
      >
        <Icon icon={FiPlus} size={10} />
      </button>
      {isCustom && (
        <button
          type="button"
          aria-label="Reset to default"
          title={`Reset to default (${defaultValue})`}
          onClick={() => onChange(null)}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-accent"
        >
          <Icon icon={FiRotateCcw} size={10} />
        </button>
      )}
    </div>
  );
}

function DepthChart({
  rosterValue,
  rosterPlayers,
  preferredDepth,
  onDepthChange,
}: {
  rosterValue: ReturnType<typeof computeRosterValue>;
  rosterPlayers: ScoredPlayer[];
  preferredDepth: Partial<Record<BatterPosition, number>>;
  onDepthChange: (pos: BatterPosition, next: number | null) => void;
}) {
  const positions = BATTER_POSITIONS.filter(p => (rosterValue.byPosition.get(p)?.startingSlots ?? 0) > 0);
  return (
    <Panel
      title={
        <div className="flex items-center gap-2">
          <Icon icon={FiLayers} size={14} className="text-accent" />
          <h2 className="text-sm font-semibold text-foreground">Positional Depth</h2>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Pos</th>
              <th className="text-center px-2 py-1.5 text-muted-foreground font-medium w-12">Slots</th>
              <th className="text-center px-2 py-1.5 text-muted-foreground font-medium w-16">Eligible</th>
              <th className="text-center px-2 py-1.5 text-muted-foreground font-medium w-28">Target</th>
              <th className="text-center px-2 py-1.5 text-muted-foreground font-medium w-14">Status</th>
              <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Starters</th>
              <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Best Backup</th>
            </tr>
          </thead>
          <tbody>
            {positions.map(pos => {
              const pv = rosterValue.byPosition.get(pos)!;
              const status = depthStatus(pv);
              const defaultDepth = getDefaultDepth(pv.startingSlots);
              const currentDepth = preferredDepth[pos] ?? defaultDepth;
              return (
                <tr key={pos} className="border-b border-border/50">
                  <td className="px-2 py-1.5 font-semibold text-foreground">{pos}</td>
                  <td className="px-2 py-1.5 text-center text-muted-foreground">{pv.startingSlots}</td>
                  <td className="px-2 py-1.5 text-center text-foreground">{pv.eligibleCount}</td>
                  <td className="px-2 py-1.5 text-center">
                    <DepthStepper
                      value={currentDepth}
                      defaultValue={defaultDepth}
                      min={0}
                      max={Math.max(defaultDepth + 3, 6)}
                      onChange={next => onDepthChange(pos, next)}
                    />
                  </td>
                  <td className={`px-2 py-1.5 text-center font-semibold ${status.color}`}>{status.label}</td>
                  <td className="px-2 py-1.5 text-foreground truncate max-w-[200px]">
                    {pv.starters.map(p => p.name).join(', ') || <span className="text-error">— empty</span>}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[200px]">
                    {pv.firstBackup ? pv.firstBackup.name : <span className="text-error">none</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-caption text-muted-foreground mt-2">
        Multi-position players count toward every eligible slot, including starters who could slide over in a pinch.
        Target = total players you want carried at that position (starters + depth). Set to 0 to skip a position entirely
        (e.g. running without a catcher). Roster has {rosterPlayers.length} batters.
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Player stat cells
// ---------------------------------------------------------------------------

function StatCell({ value, name, chased, punted }: {
  value: number | null;
  name: string;
  chased: boolean;
  punted: boolean;
}) {
  const formatted = formatStatValue(value, name);
  const color = chased
    ? 'text-success font-semibold'
    : punted
      ? 'text-muted-foreground/40'
      : 'text-foreground';
  return <td className={`px-2 py-1.5 text-right text-xs tabular-nums ${color}`}>{formatted}</td>;
}

function StatusBadge({ status }: { status: string }) {
  const isIL = status.includes('IL') || status === 'DL' || status === 'NA';
  return <Badge color={isIL ? 'error' : 'accent'}>{status}</Badge>;
}

// PA acts as a sample-size cue next to the counting stats. Current-season
// counting totals below ~30 PA are thin enough that the category-pill Score
// (Bayesian blended vs. prior-year + league mean) is doing most of the work,
// so we dim those rows' PA to telegraph "don't read the raw numbers straight".
const THIN_SAMPLE_PA = 30;
const IL_STINT_MIN_PERCENT_OWNED = 35;

function PACell({ pa }: { pa: number | null }) {
  if (pa === null) {
    return <td className="px-2 py-1.5 text-right text-xs tabular-nums text-muted-foreground/40">—</td>;
  }
  const thin = pa < THIN_SAMPLE_PA;
  const color = thin ? 'text-muted-foreground/50' : 'text-muted-foreground';
  const title = thin
    ? `${pa} PA — thin sample; Score is regressed to prior-year talent + league mean`
    : `${pa} PA`;
  return (
    <td className={`px-2 py-1.5 text-right text-xs tabular-nums ${color}`} title={title}>
      {pa}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Your Roster Table
// ---------------------------------------------------------------------------

type RosterSortKey = 'name' | 'pa' | 'score' | number; // number = stat_id

function RosterTable({
  players,
  displayCategories,
  focusMap,
  getStats,
  scoringCategories,
  fullTimePaceRef,
  fullTimeGpRef,
}: {
  players: RosterEntry[];
  displayCategories: EnrichedLeagueStatCategory[];
  focusMap: Record<number, FocusState>;
  getStats: (name: string, team: string) => BatterSeasonStats | null;
  scoringCategories: EnrichedLeagueStatCategory[];
  fullTimePaceRef: number;
  fullTimeGpRef: number;
}) {
  const [sortKey, setSortKey] = useState<RosterSortKey>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Toggling a column: same key flips direction; a new key sets the
  // "natural" direction for that data type (descending for numeric
  // higher-is-better, ascending for names and lower-is-better stats).
  const handleSort = useCallback(
    (key: RosterSortKey) => {
      if (key === sortKey) {
        setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
        return;
      }
      setSortKey(key);
      if (key === 'name') {
        setSortDir('asc');
      } else if (typeof key === 'number') {
        const cat = displayCategories.find(c => c.stat_id === key);
        setSortDir(cat?.betterIs === 'lower' ? 'asc' : 'desc');
      } else {
        setSortDir('desc');
      }
    },
    [sortKey, displayCategories],
  );

  const sorted = useMemo(() => {
    const scoreOf = (p: RosterEntry) => {
      const s = getStats(p.name, p.editorial_team_abbr);
      const isOnIL = getRowStatus(p) === 'injured';
      const ptf = playingTimeFactor(s, {
        fullTimePaceRef,
        fullTimeGpRef,
        isOnIL,
        percentOwned: p.percent_owned,
      });
      return blendedCategoryScore(s, scoringCategories, ptf, isOnIL, focusMap);
    };

    // Pull the comparable value for each row given the active sort key.
    // Names compare as strings; everything else as numbers (with null
    // sinking to the bottom regardless of direction).
    const valueOf = (p: RosterEntry): string | number | null => {
      if (sortKey === 'name') return p.name.toLowerCase();
      if (sortKey === 'score') return scoreOf(p);
      const s = getStats(p.name, p.editorial_team_abbr);
      if (!s) return null;
      if (sortKey === 'pa') return s.pa;
      return getStatValue(s, sortKey);
    };

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...players].sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      // Null/undefined always sinks regardless of direction — a player
      // we have no stats for shouldn't outrank one we do.
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'string' && typeof vb === 'string') {
        return va.localeCompare(vb) * dir;
      }
      return ((va as number) - (vb as number)) * dir;
    });
  }, [players, getStats, scoringCategories, fullTimePaceRef, fullTimeGpRef, focusMap, sortKey, sortDir]);

  if (sorted.length === 0) {
    return <p className="text-xs text-muted-foreground p-4">No batters on roster</p>;
  }

  const sortIndicator = (key: RosterSortKey) =>
    key === sortKey ? (
      <Icon
        icon={sortDir === 'desc' ? FiChevronDown : FiChevronUp}
        size={10}
        className="inline ml-0.5 text-accent"
      />
    ) : null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            <th
              className="text-left px-2 py-1.5 text-muted-foreground font-medium cursor-pointer select-none hover:text-foreground"
              onClick={() => handleSort('name')}
            >
              <span className={sortKey === 'name' ? 'text-accent' : ''}>Player</span>
              {sortIndicator('name')}
            </th>
            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium w-10">Pos</th>
            <th
              className="text-right px-2 py-1.5 text-muted-foreground font-medium w-10 cursor-pointer select-none hover:text-foreground"
              onClick={() => handleSort('pa')}
              title="Current-season plate appearances. Counting stats below 30 PA are thin samples; the Score regresses toward prior-year talent."
            >
              <span className={sortKey === 'pa' ? 'text-accent' : ''}>PA</span>
              {sortIndicator('pa')}
            </th>
            {displayCategories.map(cat => {
              const baseColor = focusMap[cat.stat_id] === 'chase'
                ? 'text-success'
                : focusMap[cat.stat_id] === 'punt'
                  ? 'text-muted-foreground/40'
                  : 'text-muted-foreground';
              const isActive = sortKey === cat.stat_id;
              return (
                <th
                  key={cat.stat_id}
                  className={`text-right px-2 py-1.5 font-medium w-12 cursor-pointer select-none hover:text-foreground ${baseColor}`}
                  onClick={() => handleSort(cat.stat_id)}
                >
                  <span className={isActive ? 'text-accent' : ''}>{cat.display_name}</span>
                  {sortIndicator(cat.stat_id)}
                </th>
              );
            })}
            <th
              className="text-right px-2 py-1.5 text-success font-medium w-14 cursor-pointer select-none hover:text-foreground"
              onClick={() => handleSort('score')}
            >
              <span className={sortKey === 'score' ? 'text-accent' : ''}>Score</span>
              {sortIndicator('score')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(player => {
            const stats = getStats(player.name, player.editorial_team_abbr);
            const rowStatus = getRowStatus(player);
            const isOnIL = rowStatus === 'injured';
            const ptf = playingTimeFactor(stats, {
              fullTimePaceRef,
              fullTimeGpRef,
              isOnIL,
              percentOwned: player.percent_owned,
            });
            const score = blendedCategoryScore(stats, scoringCategories, ptf, isOnIL, focusMap);
            const rowOpacity = isOnIL ? 'opacity-40' : '';
            return (
              <tr key={player.player_key} className={`border-b border-border/50 hover:bg-surface-muted/50 ${rowOpacity}`}>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-foreground font-medium truncate max-w-[140px]">{player.name}</span>
                    {player.status && <StatusBadge status={player.status} />}
                  </div>
                  <span className="text-caption text-muted-foreground">{player.editorial_team_abbr}</span>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{player.display_position}</td>
                <PACell pa={stats?.pa ?? null} />
                {displayCategories.map(cat => (
                  <StatCell
                    key={cat.stat_id}
                    value={stats ? getStatValue(stats, cat.stat_id) : null}
                    name={cat.display_name}
                    chased={focusMap[cat.stat_id] === 'chase'}
                    punted={focusMap[cat.stat_id] === 'punt'}
                  />
                ))}
                <ScoreCell
                  score={score}
                  ptf={ptf}
                  isOnIL={isOnIL}
                  stats={stats}
                  fullTimeGpRef={fullTimeGpRef}
                  percentOwned={player.percent_owned}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Score column with a tooltip that surfaces the playing-time factor so
// users can see why a counting-stat star got dampened vs. a full-timer.
function ScoreCell({
  score,
  ptf,
  isOnIL,
  stats,
  fullTimeGpRef,
  percentOwned,
}: {
  score: number;
  ptf: number;
  isOnIL: boolean;
  stats: BatterSeasonStats | null;
  fullTimeGpRef: number;
  percentOwned: number | undefined;
}) {
  const pct = Math.round(ptf * 100);
  // Mirror the `playingTimeFactor` inferred-IL criteria exactly so the
  // tooltip tells the truth about why a score came out the way it did.
  // Keep thresholds in sync with scoring.ts (IL_STINT_* constants).
  const ilStintShape =
    !isOnIL &&
    stats != null &&
    fullTimeGpRef > 0 &&
    stats.gp > 0 &&
    (stats.priorSeason?.gp ?? 0) / 140 >= 0.8 &&
    stats.gp / fullTimeGpRef < 0.7 &&
    stats.pa / stats.gp >= 3.5;
  const marketStillValues = percentOwned === undefined || percentOwned >= IL_STINT_MIN_PERCENT_OWNED;
  const inferredILStint = ilStintShape && marketStillValues;
  // Market-overridden: shape matches but ownership has fallen — surface
  // that we consciously ignored the stint pattern for this player.
  const demotionSuspected = ilStintShape && !marketStillValues;

  let title: string;
  if (isOnIL) {
    title = `PT ${pct}% — using prior-year role (currently on IL)`;
  } else if (inferredILStint) {
    title = `PT ${pct}% — inferred IL stint (missed a block of games); using prior-year role until current-season volume catches up`;
  } else if (demotionSuspected) {
    title = `PT ${pct}% — stats look like an IL returnee, but only ${Math.round(percentOwned ?? 0)}% owned suggests role demotion; using current-year volume`;
  } else {
    title = `PT ${pct}% of a full-time starter's expected volume`;
  }
  return (
    <td
      className="px-2 py-1.5 text-right text-xs tabular-nums text-success font-semibold"
      title={title}
    >
      {score.toFixed(2)}
    </td>
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
  scoringCategories,
  fullTimePaceRef,
  fullTimeGpRef,
}: {
  players: FreeAgentPlayer[];
  displayCategories: EnrichedLeagueStatCategory[];
  focusMap: Record<number, FocusState>;
  getStats: (name: string, team: string) => BatterSeasonStats | null;
  scoringCategories: EnrichedLeagueStatCategory[];
  fullTimePaceRef: number;
  fullTimeGpRef: number;
}) {
  const sorted = useMemo(() => {
    return [...players]
      .filter(p => {
        // 5% ownership floor: a healthy player with consensus < 5% owned
        // is the league's collective "no" — almost certainly not a real
        // upgrade target. IL'd players bypass the floor since dropped IL
        // studs are exactly the stash plays we want surfaced. NA / DTD /
        // other statuses are NOT IL — minor-league assignments and day-
        // to-day flags shouldn't get the bypass.
        if (isStashableIL(p)) return true;
        return (p.percent_owned ?? 0) >= UPGRADE_TARGET_OWNERSHIP_FLOOR;
      })
      .map(p => {
        const stats = getStats(p.name, p.editorial_team_abbr);
        const isOnIL = isStashableIL(p);
        const ptf = playingTimeFactor(stats, {
          fullTimePaceRef,
          fullTimeGpRef,
          isOnIL,
          percentOwned: p.percent_owned,
        });
        const score = blendedCategoryScore(stats, scoringCategories, ptf, isOnIL, focusMap);
        return { player: p, stats, ptf, isOnIL, score };
      })
      // Drop rows we have nothing to rank by — players whose stats lookup
      // returned null (no MLB ID resolved, or no current/prior data) end
      // up at score 0 and just fill rows with em-dashes. Keeping them
      // pushes real candidates out of the top 30.
      .filter(({ stats, score }) => stats !== null && score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);
  }, [players, getStats, scoringCategories, fullTimePaceRef, fullTimeGpRef, focusMap]);

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
            <th
              className="text-right px-2 py-1.5 text-muted-foreground font-medium w-10"
              title="Current-season plate appearances. Counting stats below 30 PA are thin samples; the Score regresses toward prior-year talent."
            >
              PA
            </th>
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
            <th className="text-right px-2 py-1.5 text-success font-medium w-14">Score</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ player, stats, ptf, isOnIL, score }) => {
            const isWaivers = player.ownership_type === 'waivers';
            return (
              <tr key={player.player_key} className="border-b border-border/50 hover:bg-surface-muted/50">
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-foreground font-medium truncate max-w-[140px]">{player.name}</span>
                    {isWaivers && <Badge color="accent">W</Badge>}
                    {player.status && <StatusBadge status={player.status} />}
                  </div>
                  <span className="text-caption text-muted-foreground">{player.editorial_team_abbr}</span>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{player.display_position}</td>
                <PACell pa={stats?.pa ?? null} />
                {displayCategories.map(cat => {
                  const val = stats ? getStatValue(stats, cat.stat_id) : null;
                  return (
                    <StatCell
                      key={cat.stat_id}
                      value={val}
                      name={cat.display_name}
                      chased={focusMap[cat.stat_id] === 'chase'}
                      punted={focusMap[cat.stat_id] === 'punt'}
                    />
                  );
                })}
                <ScoreCell
                  score={score}
                  ptf={ptf}
                  isOnIL={isOnIL}
                  stats={stats}
                  fullTimeGpRef={fullTimeGpRef}
                  percentOwned={player.percent_owned}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Swap Suggestions (position-aware)
// ---------------------------------------------------------------------------

function reasonBadge(reason: RankedSwap['primaryReason']) {
  if (reason === 'gap_fill') {
    return <Badge color="error"><Icon icon={FiAlertTriangle} size={10} /> fills gap</Badge>;
  }
  if (reason === 'matchup_depth') {
    return <Badge color="accent"><Icon icon={FiLayers} size={10} /> matchup depth</Badge>;
  }
  return <Badge color="success"><Icon icon={FiTrendingUp} size={10} /> upgrade</Badge>;
}

function SwapSuggestions({ suggestions }: { suggestions: RankedSwap[] }) {
  if (suggestions.length === 0) {
    return (
      <Panel title="Suggested Swaps">
        <p className="text-xs text-muted-foreground">
          No net-positive swaps found. Your roster is balanced for the current category focus.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Suggested Swaps"
      action={
        <span className="text-caption text-muted-foreground">
          Ranked by net value, dampened by draft pedigree & ownership
        </span>
      }
    >
      <div className="space-y-2">
        {suggestions.slice(0, 8).map((swap, i) => {
          const dropRaw = swap.drop.raw as RosterEntry;
          const addRaw = swap.add.raw as FreeAgentPlayer;
          const dropPos = dropRaw.display_position;
          const addPos = addRaw.display_position;
          const dropPct = dropRaw.percent_owned;
          const dropPick = dropRaw.average_draft_pick;
          return (
            <div key={i} className="flex items-start gap-3 p-2.5 rounded bg-surface-muted/50">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-error font-medium truncate">{swap.drop.name}</span>
                  <span className="text-caption text-muted-foreground">{dropPos}</span>
                  {typeof dropPct === 'number' && (
                    <span className="text-caption text-muted-foreground" title="Yahoo percent owned">
                      {Math.round(dropPct)}%
                    </span>
                  )}
                  {typeof dropPick === 'number' && dropPick > 0 && (
                    <span className="text-caption text-muted-foreground" title="Preseason average draft pick">
                      ADP {dropPick.toFixed(0)}
                    </span>
                  )}
                  <Icon icon={FiArrowRight} size={12} className="text-muted-foreground shrink-0" />
                  <span className="text-xs text-success font-medium truncate">{swap.add.name}</span>
                  <span className="text-caption text-muted-foreground">{addPos}</span>
                  {reasonBadge(swap.primaryReason)}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                  {swap.positionChanges
                    .sort((a, b) => Math.abs(b.valueDelta) - Math.abs(a.valueDelta))
                    .map(c => {
                      const sign = c.valueDelta >= 0 ? '+' : '';
                      const tone = c.valueDelta >= 0 ? 'text-success' : 'text-error';
                      const gap = c.depthShortfallDelta < 0
                        ? ' (gap→filled)'
                        : c.depthShortfallDelta > 0
                          ? ' (gap!)' : '';
                      return (
                        <span key={c.position} className={`text-caption font-semibold ${tone}`}>
                          {c.position}: {sign}{c.valueDelta.toFixed(2)}{gap}
                        </span>
                      );
                    })}
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className={`text-xs font-bold ${swap.netValue > 0 ? 'text-success' : 'text-error'}`}>
                  {swap.netValue > 0 ? '+' : ''}{swap.netValue.toFixed(2)}
                </span>
                <span className="block text-caption text-muted-foreground">net value</span>
                {swap.dropResistance > 0.01 && (
                  <span
                    className="block text-caption text-accent/80"
                    title={`Drop resistance applied for a highly-drafted / highly-owned player. Adjusted rank: ${swap.adjustedNetValue.toFixed(2)}`}
                  >
                    −{swap.dropResistance.toFixed(2)} resist
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Preferred-depth persistence (localStorage)
// ---------------------------------------------------------------------------

const PREFERRED_DEPTH_KEY = 'roster.preferredDepth';
const ROSTER_FOCUS_KEY_PREFIX = 'roster.categoryFocus';

function loadPreferredDepth(): Partial<Record<BatterPosition, number>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(PREFERRED_DEPTH_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<BatterPosition, number>>;
    const clean: Partial<Record<BatterPosition, number>> = {};
    for (const pos of BATTER_POSITIONS) {
      const v = parsed[pos];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        clean[pos] = Math.floor(v);
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function rosterFocusKey(leagueKey: string | null | undefined): string | null {
  return leagueKey ? `${ROSTER_FOCUS_KEY_PREFIX}:${leagueKey}` : null;
}

function loadRosterFocus(leagueKey: string | null | undefined): Record<number, FocusState> {
  const key = rosterFocusKey(leagueKey);
  if (!key || typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const clean: Record<number, FocusState> = {};
    for (const [statId, value] of Object.entries(parsed)) {
      const id = Number(statId);
      if (
        Number.isFinite(id) &&
        (value === 'chase' || value === 'punt' || value === 'neutral')
      ) {
        clean[id] = value;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function persistRosterFocus(
  leagueKey: string | null | undefined,
  focusMap: Record<number, FocusState>,
) {
  const key = rosterFocusKey(leagueKey);
  if (!key || typeof window === 'undefined') return;
  try {
    const persistent = Object.fromEntries(
      Object.entries(focusMap).filter(([, value]) => value !== 'neutral'),
    );
    if (Object.keys(persistent).length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(persistent));
    }
  } catch {
    // ignore quota/serialization errors — focus preference just won't persist
  }
}

// ---------------------------------------------------------------------------
// Main RosterManager
// ---------------------------------------------------------------------------

type RosterTab = 'batters' | 'pitchers';

export default function RosterManager() {
  const { teamKey, leagueKey, isLoading: ctxLoading, isError: ctxError } = useFantasyContext();
  const { roster, isLoading: rosterLoading } = useRoster(teamKey);
  const { categories, isLoading: catsLoading } = useLeagueCategories(leagueKey);
  const { positions: leaguePositions, isLoading: posLoading } = useRosterPositions(leagueKey);
  const { getPlayerStats: getRosterPlayerStats } = useRosterStats(roster);
  const { batters: availableBatters, isLoading: battersLoading } = useAvailableBatters(leagueKey, true);
  const { players: availablePitchers, isLoading: pitchersLoading } = useAvailablePitchers(leagueKey);
  const { getPlayerStats: getFAStats } = useFreeAgentStats(availableBatters);
  const { ranks, isLoading: ranksLoading } = useSeasonCategoryRanks(leagueKey, teamKey);

  const [tab, setTab] = useState<RosterTab>('batters');
  const [focusMap, setFocusMap] = useState<Record<number, FocusState>>({});
  const [preferredDepth, setPreferredDepth] = useState<Partial<Record<BatterPosition, number>>>({});

  useEffect(() => {
    setPreferredDepth(loadPreferredDepth());
  }, []);

  useEffect(() => {
    setFocusMap(loadRosterFocus(leagueKey));
  }, [leagueKey]);

  const updatePreferredDepth = useCallback((pos: BatterPosition, next: number | null) => {
    setPreferredDepth(prev => {
      const updated = { ...prev };
      if (next === null) {
        delete updated[pos];
      } else {
        updated[pos] = next;
      }
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(PREFERRED_DEPTH_KEY, JSON.stringify(updated));
        } catch {
          // ignore quota/serialization errors — preference just won't persist
        }
      }
      return updated;
    });
  }, []);

  const toggleFocus = useCallback((statId: number) => {
    setFocusMap(prev => {
      const next = {
        ...prev,
        [statId]: nextFocus(prev[statId] ?? 'neutral'),
      };
      persistRosterFocus(leagueKey, next);
      return next;
    });
  }, [leagueKey]);

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

  // Scoring: when categories are chased, score chased-only. Otherwise fall back to "overall" —
  // every non-punted batter category with equal weight.
  const scoringCategories = useMemo(() => {
    if (chasedCategories.length > 0) return chasedCategories;
    return displayCategories.filter(c => focusMap[c.stat_id] !== 'punt');
  }, [displayCategories, focusMap, chasedCategories]);

  const rosterBatters = useMemo(
    () => roster.filter(p => !isPitcher(p)),
    [roster],
  );

  const rosterPitchers = useMemo(
    () => roster.filter(p => isPitcher(p)),
    [roster],
  );

  // Fetch Yahoo market signals for roster batters. The roster endpoint doesn't
  // carry percent_owned/draft_analysis, so we hydrate them via a batch call.
  // FA players already have these fields populated from getLeaguePlayers.
  const rosterPlayerKeys = useMemo(
    () => rosterBatters.map(p => p.player_key).filter(Boolean),
    [rosterBatters],
  );
  const { signals: rosterMarketSignals } = usePlayerMarketSignals(rosterPlayerKeys);

  const batterRanks = useMemo(
    () => ranks.filter(r => categories.find(c => c.stat_id === r.statId)?.is_batter_stat),
    [ranks, categories],
  );

  const pitcherRanks = useMemo(
    () => ranks.filter(r => categories.find(c => c.stat_id === r.statId)?.is_pitcher_stat),
    [ranks, categories],
  );

  const startingSlots = useMemo(
    () => parseStartingSlots(leaguePositions),
    [leaguePositions],
  );

  // League-wide pace references from every batter we have stats for (roster +
  // free agents). `paceRef` is the p90 of current-season PA (≈ what a full-
  // time leadoff hitter has accumulated). `gpRef` is the p90 of current-season
  // GP (≈ team games elapsed), used by the IL-stint heuristic. Computing once
  // across the full pool (not per-table) keeps the roster and FA sides on the
  // same scale so swap evaluations stay apples-to-apples.
  const { fullTimePaceRef, fullTimeGpRef } = useMemo(() => {
    const allStats: BatterSeasonStats[] = [];
    for (const p of rosterBatters) {
      const s = getRosterPlayerStats(p.name, p.editorial_team_abbr);
      if (s) allStats.push(s);
    }
    for (const p of availableBatters) {
      const s = getFAStats(p.name, p.editorial_team_abbr);
      if (s) allStats.push(s);
    }
    return {
      fullTimePaceRef: estimateFullTimePaceRef(allStats),
      fullTimeGpRef: estimateFullTimeGpRef(allStats),
    };
  }, [rosterBatters, availableBatters, getRosterPlayerStats, getFAStats]);

  const scoredRoster = useMemo<ScoredPlayer[]>(() => {
    return rosterBatters
      .filter(p => getRowStatus(p) !== 'injured')
      .map(p => {
        const signals = rosterMarketSignals[p.player_key];
        const rawWithSignals = {
          ...p,
          percent_owned: signals?.percent_owned ?? p.percent_owned,
          average_draft_pick: signals?.average_draft_pick ?? p.average_draft_pick,
          percent_drafted: signals?.percent_drafted ?? p.percent_drafted,
        };
        const stats = getRosterPlayerStats(p.name, p.editorial_team_abbr);
        const isOnIL = isStashableIL(p);
        const ptf = playingTimeFactor(stats, {
          fullTimePaceRef,
          fullTimeGpRef,
          isOnIL,
          percentOwned: rawWithSignals.percent_owned,
        });
        return {
          player_key: p.player_key,
          name: p.name,
          eligibleBatterPositions: getBatterPositions(p.eligible_positions),
          score: blendedCategoryScore(stats, scoringCategories, ptf, isOnIL, focusMap),
          raw: rawWithSignals,
          percentOwned: rawWithSignals.percent_owned,
          averageDraftPick: rawWithSignals.average_draft_pick,
        };
      })
      .filter(p => p.eligibleBatterPositions.length > 0);
  }, [rosterBatters, getRosterPlayerStats, scoringCategories, rosterMarketSignals, fullTimePaceRef, fullTimeGpRef, focusMap]);

  const scoredFreeAgents = useMemo<ScoredPlayer[]>(() => {
    // Same ownership floor as the upgrade table — the swap optimizer can't
    // recommend adding someone the rest of the league has passed on.
    // IL players are still excluded from the swap pool itself (you can't
    // start them), but the floor matters for healthy FAs.
    return availableBatters
      .filter(p => !p.on_disabled_list)
      .filter(p => (p.percent_owned ?? 0) >= UPGRADE_TARGET_OWNERSHIP_FLOOR)
      .map(p => {
        const stats = getFAStats(p.name, p.editorial_team_abbr);
        const ptf = playingTimeFactor(stats, {
          fullTimePaceRef,
          fullTimeGpRef,
          percentOwned: p.percent_owned,
        });
        return {
          player_key: p.player_key,
          name: p.name,
          eligibleBatterPositions: getBatterPositions(p.eligible_positions),
          score: blendedCategoryScore(stats, scoringCategories, ptf, false, focusMap),
          raw: p,
          percentOwned: p.percent_owned,
          averageDraftPick: p.average_draft_pick,
        };
      })
      .filter(p => p.eligibleBatterPositions.length > 0);
  }, [availableBatters, getFAStats, scoringCategories, fullTimePaceRef, fullTimeGpRef, focusMap]);

  const replacementLevel = useMemo(
    () => computeReplacementLevel(scoredFreeAgents),
    [scoredFreeAgents],
  );

  const rosterValue = useMemo(
    () => computeRosterValue(scoredRoster, startingSlots, replacementLevel, undefined, preferredDepth),
    [scoredRoster, startingSlots, replacementLevel, preferredDepth],
  );

  const swapSuggestions = useMemo(() => {
    if (scoredRoster.length === 0 || scoredFreeAgents.length === 0) return [];
    return generateSwapSuggestions(
      scoredRoster,
      scoredFreeAgents,
      startingSlots,
      replacementLevel,
      undefined,
      { minNetValue: 0.05, limit: 15, preferredDepth },
    );
  }, [scoredRoster, scoredFreeAgents, startingSlots, replacementLevel, preferredDepth]);

  const isLoading = ctxLoading || rosterLoading || catsLoading || posLoading;

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
        <h1 className="text-xl font-semibold text-foreground">Roster Optimizer</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Long-term construction moves. Batters get a full depth-chart optimizer; pitchers live here too — use Streaming for daily pickups.
        </p>
      </div>

      <Tabs<RosterTab>
        variant="segment"
        ariaLabel="Roster tab"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'batters', label: 'Batters', meta: `${rosterBatters.length}` },
          { id: 'pitchers', label: 'Pitchers', meta: `${rosterPitchers.length}` },
        ]}
      />

      <RankStrip
        side={tab === 'batters' ? 'batting' : 'pitching'}
        ranks={tab === 'batters' ? batterRanks : pitcherRanks}
        isLoading={ranksLoading}
      />

      {tab === 'batters' ? (
        <BattersTab
          categories={categories}
          catsLoading={catsLoading}
          focusMap={focusMap}
          toggleFocus={toggleFocus}
          isLoading={isLoading}
          rosterValue={rosterValue}
          scoredRoster={scoredRoster}
          swapSuggestions={swapSuggestions}
          rosterBatters={rosterBatters}
          availableBatters={availableBatters}
          battersLoading={battersLoading}
          displayCategories={displayCategories}
          getRosterPlayerStats={getRosterPlayerStats}
          getFAStats={getFAStats}
          scoringCategories={scoringCategories}
          preferredDepth={preferredDepth}
          onPreferredDepthChange={updatePreferredDepth}
          fullTimePaceRef={fullTimePaceRef}
          fullTimeGpRef={fullTimeGpRef}
        />
      ) : (
        <PitchersTab
          rosterPitchers={rosterPitchers}
          availablePitchers={availablePitchers}
          pitchersLoading={pitchersLoading}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batters tab — the full depth-chart + swap optimizer experience
// ---------------------------------------------------------------------------

function BattersTab({
  categories,
  catsLoading,
  focusMap,
  toggleFocus,
  isLoading,
  rosterValue,
  scoredRoster,
  swapSuggestions,
  rosterBatters,
  availableBatters,
  battersLoading,
  displayCategories,
  getRosterPlayerStats,
  getFAStats,
  scoringCategories,
  preferredDepth,
  onPreferredDepthChange,
  fullTimePaceRef,
  fullTimeGpRef,
}: {
  categories: EnrichedLeagueStatCategory[];
  catsLoading: boolean;
  focusMap: Record<number, FocusState>;
  toggleFocus: (statId: number) => void;
  isLoading: boolean;
  rosterValue: ReturnType<typeof computeRosterValue>;
  scoredRoster: ScoredPlayer[];
  swapSuggestions: RankedSwap[];
  rosterBatters: RosterEntry[];
  availableBatters: FreeAgentPlayer[];
  battersLoading: boolean;
  displayCategories: EnrichedLeagueStatCategory[];
  getRosterPlayerStats: (name: string, team: string) => BatterSeasonStats | null;
  getFAStats: (name: string, team: string) => BatterSeasonStats | null;
  scoringCategories: EnrichedLeagueStatCategory[];
  preferredDepth: Partial<Record<BatterPosition, number>>;
  onPreferredDepthChange: (pos: BatterPosition, next: number | null) => void;
  fullTimePaceRef: number;
  fullTimeGpRef: number;
}) {
  return (
    <>
      {!catsLoading && categories.length > 0 && (
        <CategoryFocusBar
          categories={categories.filter(c => c.is_batter_stat)}
          focusMap={focusMap}
          onToggle={toggleFocus}
        />
      )}

      {isLoading ? (
        <Panel className="p-8 text-center">
          <div className="animate-pulse text-sm text-muted-foreground">Loading roster data...</div>
        </Panel>
      ) : (
        <>
          <DepthChart
            rosterValue={rosterValue}
            rosterPlayers={scoredRoster}
            preferredDepth={preferredDepth}
            onDepthChange={onPreferredDepthChange}
          />
          <SwapSuggestions suggestions={swapSuggestions} />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Panel
              title="Your Batters"
              action={<span className="text-caption text-muted-foreground">{rosterBatters.length} on roster</span>}
            >
              <RosterTable
                players={rosterBatters}
                displayCategories={displayCategories}
                focusMap={focusMap}
                getStats={getRosterPlayerStats}
                scoringCategories={scoringCategories}
                fullTimePaceRef={fullTimePaceRef}
                fullTimeGpRef={fullTimeGpRef}
              />
            </Panel>

            <Panel
              title="Upgrade Targets"
              action={
                <span className="text-caption text-muted-foreground">
                  {battersLoading ? 'Loading...' : `${availableBatters.length} available`}
                </span>
              }
            >
              <UpgradeTargetsTable
                players={availableBatters}
                displayCategories={displayCategories}
                focusMap={focusMap}
                getStats={getFAStats}
                scoringCategories={scoringCategories}
                fullTimePaceRef={fullTimePaceRef}
                fullTimeGpRef={fullTimeGpRef}
              />
            </Panel>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pitchers tab — yahoo-sourced season line + free-agent board. The
// depth-chart / swap optimizer lives in `depth.ts` and is currently
// batter-only; a proper `PITCHER_STAT_MAP` + `PitcherSeasonStats` lift is
// needed to extend it to pitchers, flagged as follow-up work in the plan.
// ---------------------------------------------------------------------------

function PitcherTable({
  players,
}: {
  players: Array<RosterEntry | FreeAgentPlayer>;
}) {
  if (players.length === 0) {
    return <p className="text-xs text-muted-foreground p-4">No pitchers</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Player</th>
            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium w-16">Pos</th>
            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium w-12">Team</th>
            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium w-16">Status</th>
          </tr>
        </thead>
        <tbody>
          {players.map(p => {
            const isFA = 'ownership_type' in p;
            const isWaivers = isFA && (p as FreeAgentPlayer).ownership_type === 'waivers';
            const rowStatus = !isFA ? getRowStatus(p as RosterEntry) : null;
            const rowOpacity = rowStatus === 'injured' ? 'opacity-40' : '';
            return (
              <tr
                key={p.player_key}
                className={`border-b border-border/50 hover:bg-surface-muted/50 ${rowOpacity}`}
              >
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-foreground font-medium truncate max-w-[160px]">{p.name}</span>
                    {isWaivers && <Badge color="accent">W</Badge>}
                    {p.status && <StatusBadge status={p.status} />}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{p.display_position}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{p.editorial_team_abbr}</td>
                <td className="px-2 py-1.5 text-muted-foreground">
                  {!isFA
                    ? (p as RosterEntry).selected_position
                    : isWaivers
                      ? 'Waivers'
                      : 'FA'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PitchersTab({
  rosterPitchers,
  availablePitchers,
  pitchersLoading,
  isLoading,
}: {
  rosterPitchers: RosterEntry[];
  availablePitchers: FreeAgentPlayer[];
  pitchersLoading: boolean;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Panel className="p-8 text-center">
        <div className="animate-pulse text-sm text-muted-foreground">Loading pitcher data...</div>
      </Panel>
    );
  }

  return (
    <>
      <Panel
        helper="Long-term pitcher moves live here. For daily pickups against today/tomorrow's matchups, use the Streaming page."
      >
        <p className="text-xs text-muted-foreground">
          Full depth-chart + swap suggestions for pitchers is on the roadmap. Today this tab surfaces
          the rostered and available pitchers so you can decide on structural long-term adds.
        </p>
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel
          title="Your Pitchers"
          action={<span className="text-caption text-muted-foreground">{rosterPitchers.length} on roster</span>}
        >
          <PitcherTable players={rosterPitchers} />
        </Panel>

        <Panel
          title="Available Pitchers"
          action={
            <span className="text-caption text-muted-foreground">
              {pitchersLoading ? 'Loading...' : `${availablePitchers.length} available`}
            </span>
          }
        >
          <PitcherTable players={availablePitchers.slice(0, 40)} />
        </Panel>
      </div>
    </>
  );
}
