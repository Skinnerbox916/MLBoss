'use client';

import { useState, useMemo, useCallback } from 'react';
import { FiAlertTriangle, FiTrendingUp, FiLayers, FiChevronUp, FiChevronDown, FiTarget, FiShield } from 'react-icons/fi';
import { usePitcherTalent } from '@/lib/hooks/usePitcherTalent';
import { getPitcherSeasonRating } from '@/lib/pitching/roster';
import type { PitcherRating } from '@/lib/pitching/rating';
import { tierColor } from '@/lib/pitching/display';
import { tierLabel, supportsPitcherStatId } from '@/lib/pitching/rating';
import Icon from '@/components/Icon';
import Badge from '@/components/ui/Badge';
import Panel from '@/components/ui/Panel';
import Tabs from '@/components/ui/Tabs';
import { Heading, Text } from '@/components/typography';
import { useFantasyContext } from '@/lib/hooks/useFantasyContext';
import { useRoster } from '@/lib/hooks/useRoster';
import { useRosterStats } from '@/lib/hooks/useRosterStats';
import { useLeagueCategories } from '@/lib/hooks/useLeagueCategories';
import { useAvailableBatters } from '@/lib/hooks/useAvailableBatters';
import { useAvailablePitchers } from '@/lib/hooks/useAvailablePitchers';
import { useFreeAgentStats } from '@/lib/hooks/useFreeAgentStats';
import { useRosterPositions } from '@/lib/hooks/useRosterPositions';
import { usePlayerMarketSignals } from '@/lib/hooks/usePlayerMarketSignals';
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
  getBatterPositions,
  parseStartingSlots,
  computeReplacementLevel,
  computeRosterValue,
  generateSwapSuggestions,
  getDefaultDepth,
} from '@/lib/roster/depth';
import { computeOpenSlotCount } from '@/lib/roster/openSlots';
import { isStashableIL } from '@/lib/roster/playerPool';
import RosterMoveCard, { type MoveCardDelta } from '@/components/shared/RosterMoveCard';
import PositionalDepthTable, { DepthStepper, type DepthTableRow } from '@/components/shared/PositionalDepthTable';
import { CATEGORIES_PREFERRED_DEPTH_KEY } from '@/lib/roster/preferredDepth';
import { usePreferredDepth } from '@/lib/hooks/usePreferredDepth';
import RosterFocusPanel from './RosterFocusPanel';
import { useLeagueForecast } from '@/lib/hooks/useLeagueForecast';
import {
  useRosterCategoryWeights,
  rosterConcedePersistKey,
  type RosterCategoryWeights,
} from '@/lib/hooks/useRosterCategoryWeights';
import {
  playerContributions,
  playerRosterValue,
  buildIndexScaler,
  type PlayerCatLine,
} from '@/lib/league/rosterValue';
import {
  analyzeSwapStrategy,
  type EnrichedSwap,
  type SwapStrategy,
  type CategoryImpact,
  type CatRole,
} from '@/lib/league/swapStrategy';
import type { LeagueForecast, ForecastEntry } from '@/lib/league/forecast';

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

// ---------------------------------------------------------------------------
// Depth Chart
// ---------------------------------------------------------------------------

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
  const rows: DepthTableRow[] = BATTER_POSITIONS
    .filter(p => (rosterValue.byPosition.get(p)?.startingSlots ?? 0) > 0)
    .map(p => {
      const pv = rosterValue.byPosition.get(p)!;
      return {
        position: pv.position,
        startingSlots: pv.startingSlots,
        eligibleCount: pv.eligibleCount,
        minDepth: pv.minDepth,
        depthShortfall: pv.depthShortfall,
        starters: pv.starters.map(x => x.name),
        firstBackup: pv.firstBackup?.name ?? null,
      };
    });
  return (
    <Panel
      title={
        <div className="flex items-center gap-2">
          <Icon icon={FiLayers} size={14} className="text-accent" />
          <Heading as="h2">Positional Depth</Heading>
        </div>
      }
    >
      <PositionalDepthTable
        rows={rows}
        renderTarget={row => {
          const pos = row.position as BatterPosition;
          const pv = rosterValue.byPosition.get(pos);
          if (!pv) return null;
          const defaultDepth = getDefaultDepth(pv.startingSlots);
          const currentDepth = preferredDepth[pos] ?? defaultDepth;
          return (
            <DepthStepper
              value={currentDepth}
              defaultValue={defaultDepth}
              min={0}
              max={Math.max(defaultDepth + 3, 6)}
              onChange={next => onDepthChange(pos, next)}
            />
          );
        }}
      />
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

function StatCell({ value, name, contested, conceded }: {
  value: number | null;
  name: string;
  contested: boolean;
  conceded: boolean;
}) {
  const formatted = formatStatValue(value, name);
  const color = contested
    ? 'text-success font-semibold'
    : conceded
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
  catRoleFor,
  getStats,
  scoreIndexFor,
}: {
  players: RosterEntry[];
  displayCategories: EnrichedLeagueStatCategory[];
  catRoleFor: (statId: number) => CatRole;
  getStats: (name: string, team: string) => BatterSeasonStats | null;
  scoreIndexFor: (playerKey: string) => number | null;
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
    // Pull the comparable value for each row given the active sort key.
    // Names compare as strings; everything else as numbers (with null
    // sinking to the bottom regardless of direction).
    const valueOf = (p: RosterEntry): string | number | null => {
      if (sortKey === 'name') return p.name.toLowerCase();
      if (sortKey === 'score') return scoreIndexFor(p.player_key);
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
  }, [players, getStats, scoreIndexFor, sortKey, sortDir]);

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
              const role = catRoleFor(cat.stat_id);
              const baseColor = role === 'contested'
                ? 'text-success'
                : role === 'conceded'
                  ? 'text-muted-foreground/40'
                  : 'text-muted-foreground';
              const isActive = sortKey === cat.stat_id;
              return (
                <th
                  key={cat.stat_id}
                  className={`text-right px-2 py-1.5 font-medium w-12 cursor-pointer select-none hover:text-foreground ${baseColor}`}
                  onClick={() => handleSort(cat.stat_id)}
                  title={role === 'contested' ? 'Battleground category — production here carries full weight'
                    : role === 'conceded' ? 'Conceded — production here carries no weight'
                    : 'Cushioned lead — production here carries reduced weight'}
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
            const rowOpacity = rowStatus === 'injured' ? 'opacity-40' : '';
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
                {displayCategories.map(cat => {
                  const role = catRoleFor(cat.stat_id);
                  return (
                    <StatCell
                      key={cat.stat_id}
                      value={stats ? getStatValue(stats, cat.stat_id) : null}
                      name={cat.display_name}
                      contested={role === 'contested'}
                      conceded={role === 'conceded'}
                    />
                  );
                })}
                <ScoreCell index={scoreIndexFor(player.player_key)} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Score column: the 0-100 value index (leverage-weighted value to this
// team, scaled within the current rostered + FA pool; replacement ~ 0).
// Raw move-units never render — see docs/roster-value-proposal.md.
function ScoreCell({ index }: { index: number | null }) {
  if (index === null) {
    return <td className="px-2 py-1.5 text-right text-xs tabular-nums text-muted-foreground/40">—</td>;
  }
  return (
    <td
      className="px-2 py-1.5 text-right text-xs tabular-nums text-success font-semibold"
      title="Value to your team, 0-100 within the current player pool (replacement ≈ 0). Production is weighted by how contested each category still is — see the Roster Focus panel."
    >
      {index}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Upgrade Targets Table
// ---------------------------------------------------------------------------

function UpgradeTargetsTable({
  players,
  displayCategories,
  catRoleFor,
  getStats,
  scoreIndexFor,
}: {
  players: FreeAgentPlayer[];
  displayCategories: EnrichedLeagueStatCategory[];
  catRoleFor: (statId: number) => CatRole;
  getStats: (name: string, team: string) => BatterSeasonStats | null;
  scoreIndexFor: (playerKey: string) => number | null;
}) {
  const sorted = useMemo(() => {
    return [...players]
      .filter(p => {
        // 5% ownership floor: a healthy player with consensus < 5% owned
        // is the league's collective "no" — almost certainly not a real
        // upgrade target. The caller pre-splits the pool: the Upgrade
        // Targets panel is fed only healthy bats (IL already removed) so
        // the floor is all that applies here; the Stash Targets panel is
        // fed only IL bats, which bypass the floor since a dropped IL stud
        // is exactly the play we want surfaced regardless of ownership.
        // (isStashableIL matches real IL only — NA / DTD / SUSP are not IL
        // and never reach the stash panel.)
        if (isStashableIL(p)) return true;
        return (p.percent_owned ?? 0) >= UPGRADE_TARGET_OWNERSHIP_FLOOR;
      })
      .map(p => ({
        player: p,
        stats: getStats(p.name, p.editorial_team_abbr),
        index: scoreIndexFor(p.player_key),
      }))
      // Drop rows we have nothing to rank by — players with no stats or
      // no value line just fill rows with em-dashes. Keeping them pushes
      // real candidates out of the top 30.
      .filter(({ stats, index }) => stats !== null && index !== null)
      .sort((a, b) => (b.index ?? 0) - (a.index ?? 0))
      .slice(0, 30);
  }, [players, getStats, scoreIndexFor]);

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
            {displayCategories.map(cat => {
              const role = catRoleFor(cat.stat_id);
              return (
                <th
                  key={cat.stat_id}
                  className={`text-right px-2 py-1.5 font-medium w-12 ${
                    role === 'contested'
                      ? 'text-success'
                      : role === 'conceded'
                        ? 'text-muted-foreground/40'
                        : 'text-muted-foreground'
                  }`}
                >
                  {cat.display_name}
                </th>
              );
            })}
            <th className="text-right px-2 py-1.5 text-success font-medium w-14">Score</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ player, stats, index }) => {
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
                  const role = catRoleFor(cat.stat_id);
                  return (
                    <StatCell
                      key={cat.stat_id}
                      value={val}
                      name={cat.display_name}
                      contested={role === 'contested'}
                      conceded={role === 'conceded'}
                    />
                  );
                })}
                <ScoreCell index={index} />
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

/**
 * Strategic-alignment badge sourced from the swap's plan-aware analysis.
 *
 * Three flavours, in priority order:
 *  - **Erodes anchor** (error tone) — swap hurts a category we've
 *    committed to winning. Surfaces alongside (not in place of) the
 *    positional reason badge so the user sees the warning explicitly.
 *  - **Pushes swing** (accent tone) — swap advances a swing-target
 *    category. The triangulation goal: this is the move type the
 *    chase/hold/punt UI is steering toward.
 *  - **Reinforces anchor** (success tone, low-emphasis) — swap pads a
 *    locked-in win. Less urgent than swing pushes; shown when no
 *    swing/erosion exists.
 *
 * Returns null when no plan-relevant signal — the positional reason
 * badge alone is the explanation.
 */
function strategyBadge(strategy: SwapStrategy) {
  if (strategy.erodesCushion) {
    const t = strategy.primaryTarget;
    return (
      <Badge color="error" title={t ? `Drains ${t.displayName} (cushioned lead)` : 'Erodes a cushioned lead'}>
        <Icon icon={FiAlertTriangle} size={10} /> erodes {t ? t.displayName : 'cushion'}
      </Badge>
    );
  }
  if (strategy.pushesContested) {
    const t = strategy.primaryTarget;
    return (
      <Badge color="accent" title={t ? `Improves ${t.displayName} (battleground cat)` : 'Pushes a battleground cat'}>
        <Icon icon={FiTarget} size={10} /> {t ? `pushes ${t.displayName}` : 'pushes battleground'}
      </Badge>
    );
  }
  // Nothing contested pushed, nothing eroded — surface a quiet cushion
  // reinforce when present.
  if (strategy.primaryTarget && strategy.primaryTarget.role === 'cushioned' && strategy.primaryTarget.delta > 0) {
    return (
      <Badge color="success" title={`Pads ${strategy.primaryTarget.displayName} (cushioned lead)`}>
        <Icon icon={FiShield} size={10} /> reinforces {strategy.primaryTarget.displayName}
      </Badge>
    );
  }
  return null;
}

/**
 * Convert leverage-annotated category impacts to the shared move-card
 * delta strip. Tone by role: contested up = accent (the battlegrounds we
 * want moved), cushioned up/down = success/error (padding vs warning),
 * conceded = muted (side-effects on cats we've given up). Values are in
 * move units.
 */
function impactDeltas(impact: CategoryImpact[]): MoveCardDelta[] {
  return impact.map(c => {
    const sign = c.delta >= 0 ? '+' : '';
    const tone =
      c.role === 'conceded' ? 'text-muted-foreground/70' :
      c.role === 'contested' && c.delta > 0 ? 'text-accent' :
      c.role === 'cushioned' && c.delta > 0 ? 'text-success' :
      c.role === 'cushioned' && c.delta < 0 ? 'text-error' :
      c.delta > 0 ? 'text-success' : 'text-error';
    return {
      key: c.statId,
      label: c.displayName,
      text: `${sign}${c.delta.toFixed(2)}`,
      tone,
      title: `${c.displayName} (${c.role}) — drop→add value delta`,
    };
  });
}

function SwapSuggestions({ suggestions, openSlotCount }: { suggestions: EnrichedSwap[]; openSlotCount: number }) {
  if (suggestions.length === 0) {
    return (
      <Panel title="Suggested Moves">
        <Text variant="caption">
          No net-positive moves found. Your roster is balanced for the current category focus.
        </Text>
      </Panel>
    );
  }

  return (
    <Panel
      title="Suggested Moves"
      action={
        <span className="text-caption text-muted-foreground">
          {openSlotCount > 0
            ? `${openSlotCount} open slot${openSlotCount === 1 ? '' : 's'} — pure adds at top`
            : 'Position-aware, leverage-weighted net value'}
        </span>
      }
    >
      <div className="space-y-2">
        {suggestions.slice(0, 8).map((swap, i) => {
          const dropRaw = swap.drop?.raw as RosterEntry | undefined;
          const addRaw = swap.add.raw as FreeAgentPlayer;
          return (
            <RosterMoveCard
              key={i}
              add={{ name: swap.add.name, displayPosition: addRaw.display_position }}
              drop={
                swap.drop
                  ? {
                      name: swap.drop.name,
                      displayPosition: dropRaw?.display_position,
                      percentOwned: dropRaw?.percent_owned,
                      averageDraftPick: dropRaw?.average_draft_pick,
                    }
                  : null
              }
              badges={
                <>
                  {reasonBadge(swap.primaryReason)}
                  {strategyBadge(swap.strategy)}
                </>
              }
              deltas={impactDeltas(swap.strategy.categoryImpact)}
              positionChanges={swap.positionChanges}
              netValueText={`${swap.netValue > 0 ? '+' : ''}${swap.netValue.toFixed(2)}`}
              netValuePositive={swap.netValue > 0}
              resistText={swap.dropResistance > 0.01 ? `−${swap.dropResistance.toFixed(2)} resist` : undefined}
              resistTitle={`Drop resistance applied for a highly-drafted / highly-owned player. Adjusted rank: ${swap.adjustedNetValue.toFixed(2)}`}
            />
          );
        })}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Preferred-depth persistence (localStorage)
// ---------------------------------------------------------------------------

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

  const [tab, setTab] = useState<RosterTab>('batters');
  const { preferredDepth, updatePreferredDepth } = usePreferredDepth(CATEGORIES_PREFERRED_DEPTH_KEY);

  // League forecast: per-cat standings projection + per-player value
  // lines (the projection facts). Leverage — how much each cat is worth
  // fighting for from THIS team's position — is resolved client-side by
  // `useRosterCategoryWeights` so concede/contest toggles re-rank
  // instantly. See src/lib/league/rosterValue.ts.
  const { forecast, isLoading: forecastLoading } = useLeagueForecast(leagueKey, teamKey);

  const batterEntries = useMemo<ForecastEntry[]>(
    () => forecast?.entries.filter(e => e.isBatterStat) ?? [],
    [forecast],
  );
  const allEntries = useMemo<ForecastEntry[]>(
    () => forecast?.entries ?? [],
    [forecast],
  );

  // ONE hook over both sides' cats — the chase-coalition auto-concede
  // reasons about the whole matchup (win a majority of all scored cats),
  // so splitting per side would let each side chase its own majority.
  const rosterWeights = useRosterCategoryWeights(allEntries, {
    persistKey: rosterConcedePersistKey(leagueKey),
  });
  const batterWeights = rosterWeights;
  const pitcherWeights = rosterWeights;

  const battingCategories = useMemo(
    () => categories.filter(c => c.is_batter_stat),
    [categories],
  );

  const displayCategories = useMemo(
    () => battingCategories.filter(c => BATTER_STAT_MAP[c.stat_id]),
    [battingCategories],
  );

  // Column styling role per cat (contested = worth fighting for →
  // highlighted; conceded = muted). Derived from leverage, not a
  // user-picked label.
  const catRoleFor = useCallback(
    (statId: number): CatRole => batterWeights.leverage.byStatId.get(statId)?.status ?? 'contested',
    [batterWeights.leverage],
  );

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

  const startingSlots = useMemo(
    () => parseStartingSlots(leaguePositions),
    [leaguePositions],
  );

  // Per-player value lines from the forecast route (neutral-week weekly
  // category production, role share applied server-side). Keyed by
  // name|team — the same identity join the stats hooks use.
  const nameTeamKey = (name: string, team: string) =>
    `${name.toLowerCase()}|${team.toLowerCase()}`;

  const { rosterLines, faLines } = useMemo(() => {
    const rostered = new Map<string, PlayerCatLine>();
    const fas = new Map<string, PlayerCatLine>();
    for (const line of forecast?.playerValues?.rostered ?? []) {
      rostered.set(nameTeamKey(line.name, line.teamAbbr), line);
    }
    for (const line of forecast?.playerValues?.freeAgents ?? []) {
      fas.set(nameTeamKey(line.name, line.teamAbbr), line);
    }
    return { rosterLines: rostered, faLines: fas };
  }, [forecast]);

  // Contributions (move units per cat) and leverage-weighted value per
  // player. One map for everyone on the page — roster rows, FA rows, and
  // the swap decorator all read the same numbers.
  const { contributionsByPlayerKey, valueByPlayerKey } = useMemo(() => {
    const contributions = new Map<string, Record<number, number>>();
    const values = new Map<string, number>();
    const addPlayer = (playerKey: string, line: PlayerCatLine | undefined) => {
      if (!line) return;
      const contribs = playerContributions(line, batterEntries);
      contributions.set(playerKey, contribs);
      values.set(playerKey, playerRosterValue(contribs, batterWeights.leverage));
    };
    for (const p of rosterBatters) {
      addPlayer(p.player_key, rosterLines.get(nameTeamKey(p.name, p.editorial_team_abbr)));
    }
    for (const p of availableBatters) {
      addPlayer(p.player_key, faLines.get(nameTeamKey(p.name, p.editorial_team_abbr)));
    }
    return { contributionsByPlayerKey: contributions, valueByPlayerKey: values };
  }, [rosterBatters, availableBatters, rosterLines, faLines, batterEntries, batterWeights.leverage]);

  // 0-100 display index within the combined pool (owner decision: raw
  // move-units never render — see docs/roster-value-proposal.md).
  const indexOf = useMemo(
    () => buildIndexScaler(Array.from(valueByPlayerKey.values())),
    [valueByPlayerKey],
  );
  const scoreIndexFor = useCallback(
    (playerKey: string): number | null => {
      const v = valueByPlayerKey.get(playerKey);
      return v === undefined ? null : indexOf(v);
    },
    [valueByPlayerKey, indexOf],
  );

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
        return {
          player_key: p.player_key,
          name: p.name,
          eligibleBatterPositions: getBatterPositions(p.eligible_positions),
          score: valueByPlayerKey.get(p.player_key) ?? 0,
          raw: rawWithSignals,
          percentOwned: rawWithSignals.percent_owned,
          averageDraftPick: rawWithSignals.average_draft_pick,
        };
      })
      .filter(p => p.eligibleBatterPositions.length > 0);
  }, [rosterBatters, rosterMarketSignals, valueByPlayerKey]);

  const scoredFreeAgents = useMemo<ScoredPlayer[]>(() => {
    // Same ownership floor as the upgrade table — the swap optimizer can't
    // recommend adding someone the rest of the league has passed on.
    // IL players are still excluded from the swap pool itself (you can't
    // start them), but the floor matters for healthy FAs.
    return availableBatters
      .filter(p => !isStashableIL(p))
      .filter(p => (p.percent_owned ?? 0) >= UPGRADE_TARGET_OWNERSHIP_FLOOR)
      .filter(p => valueByPlayerKey.has(p.player_key))
      .map(p => ({
        player_key: p.player_key,
        name: p.name,
        eligibleBatterPositions: getBatterPositions(p.eligible_positions),
        score: valueByPlayerKey.get(p.player_key) ?? 0,
        raw: p,
        percentOwned: p.percent_owned,
        averageDraftPick: p.average_draft_pick,
      }))
      .filter(p => p.eligibleBatterPositions.length > 0);
  }, [availableBatters, valueByPlayerKey]);

  const replacementLevel = useMemo(
    () => computeReplacementLevel(scoredFreeAgents),
    [scoredFreeAgents],
  );

  const rosterValue = useMemo(
    () => computeRosterValue(scoredRoster, startingSlots, replacementLevel, undefined, preferredDepth),
    [scoredRoster, startingSlots, replacementLevel, preferredDepth],
  );

  // Open-slot detection — shared cap-space + placement-gate logic in
  // lib/roster/openSlots.ts (see docs/yahoo-api-reference.md#roster-capacity).
  // > 0 enables pure-add suggestions in `generateSwapSuggestions`.
  const openSlotCount = useMemo(
    () => computeOpenSlotCount(roster, leaguePositions),
    [roster, leaguePositions],
  );

  const swapSuggestions = useMemo(() => {
    if (scoredRoster.length === 0 || scoredFreeAgents.length === 0) return [];
    return generateSwapSuggestions(
      scoredRoster,
      scoredFreeAgents,
      startingSlots,
      replacementLevel,
      undefined,
      // minNetValue is in leverage-weighted move units now: 0.05 = a
      // twentieth of a typical move's worth of contested production.
      { minNetValue: 0.05, limit: 15, preferredDepth, openSlotCount },
    );
  }, [scoredRoster, scoredFreeAgents, startingSlots, replacementLevel, preferredDepth, openSlotCount]);

  // Decorate each swap with per-cat deltas in move units, annotated by
  // leverage status ("Pushes K", "Erodes SB", etc.). Reads the same
  // contribution map the scores come from — the strip's numbers ARE the
  // components of the swap's net value.
  const displayNameFor = useCallback(
    (statId: number) =>
      batterEntries.find(e => e.statId === statId)?.displayName ?? String(statId),
    [batterEntries],
  );
  const enrichedSwaps = useMemo<EnrichedSwap[]>(() => {
    return swapSuggestions.map(swap => ({
      ...swap,
      strategy: analyzeSwapStrategy(
        swap,
        key => contributionsByPlayerKey.get(key) ?? null,
        catRoleFor,
        displayNameFor,
      ),
    }));
  }, [swapSuggestions, contributionsByPlayerKey, catRoleFor, displayNameFor]);

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
        <Heading as="h1">Roster Optimizer</Heading>
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

      {tab === 'batters' ? (
        <BattersTab
          forecast={forecast}
          forecastLoading={forecastLoading}
          batterWeights={batterWeights}
          catRoleFor={catRoleFor}
          isLoading={isLoading}
          rosterValue={rosterValue}
          scoredRoster={scoredRoster}
          swapSuggestions={enrichedSwaps}
          openSlotCount={openSlotCount}
          rosterBatters={rosterBatters}
          availableBatters={availableBatters}
          battersLoading={battersLoading}
          displayCategories={displayCategories}
          getRosterPlayerStats={getRosterPlayerStats}
          getFAStats={getFAStats}
          scoreIndexFor={scoreIndexFor}
          preferredDepth={preferredDepth}
          onPreferredDepthChange={updatePreferredDepth}
        />
      ) : (
        <PitchersTab
          rosterPitchers={rosterPitchers}
          availablePitchers={availablePitchers}
          pitchersLoading={pitchersLoading}
          isLoading={isLoading}
          categories={categories}
          pitcherWeights={pitcherWeights}
          forecast={forecast}
          forecastLoading={forecastLoading}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batters tab — the full depth-chart + swap optimizer experience
// ---------------------------------------------------------------------------

function BattersTab({
  forecast,
  forecastLoading,
  batterWeights,
  catRoleFor,
  isLoading,
  rosterValue,
  scoredRoster,
  swapSuggestions,
  openSlotCount,
  rosterBatters,
  availableBatters,
  battersLoading,
  displayCategories,
  getRosterPlayerStats,
  getFAStats,
  scoreIndexFor,
  preferredDepth,
  onPreferredDepthChange,
}: {
  forecast: LeagueForecast | undefined;
  forecastLoading: boolean;
  batterWeights: RosterCategoryWeights;
  catRoleFor: (statId: number) => CatRole;
  isLoading: boolean;
  rosterValue: ReturnType<typeof computeRosterValue>;
  scoredRoster: ScoredPlayer[];
  swapSuggestions: EnrichedSwap[];
  openSlotCount: number;
  rosterBatters: RosterEntry[];
  availableBatters: FreeAgentPlayer[];
  battersLoading: boolean;
  displayCategories: EnrichedLeagueStatCategory[];
  getRosterPlayerStats: (name: string, team: string) => BatterSeasonStats | null;
  getFAStats: (name: string, team: string) => BatterSeasonStats | null;
  scoreIndexFor: (playerKey: string) => number | null;
  preferredDepth: Partial<Record<BatterPosition, number>>;
  onPreferredDepthChange: (pos: BatterPosition, next: number | null) => void;
}) {
  // Split the FA pool the same way the pitchers tab does: IL bats can't be
  // put in an active lineup, so they don't belong in "Upgrade Targets" — a
  // dropped IL stud floats to the top on talent alone (the L6 forecast
  // projects IL players at full role-typical volume) and reads as an
  // actionable add when it isn't. They get their own Stash Targets panel.
  const activeBatters = useMemo(
    () => availableBatters.filter(p => !isStashableIL(p)),
    [availableBatters],
  );
  const stashBatters = useMemo(
    () => availableBatters.filter(p => isStashableIL(p) && scoreIndexFor(p.player_key) !== null),
    [availableBatters, scoreIndexFor],
  );

  return (
    <>
      <RosterFocusPanel
        forecast={forecast}
        isLoading={forecastLoading}
        side="batting"
        leverage={batterWeights.leverage}
        isConceded={batterWeights.isConceded}
        isAutoConceded={batterWeights.isAutoConceded}
        onToggleConcede={batterWeights.toggleConcede}
        onReset={batterWeights.reset}
        hasOverrides={batterWeights.hasOverrides}
      />

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
          <SwapSuggestions suggestions={swapSuggestions} openSlotCount={openSlotCount} />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Panel
              title="Your Batters"
              action={<span className="text-caption text-muted-foreground">{rosterBatters.length} on roster</span>}
            >
              <RosterTable
                players={rosterBatters}
                displayCategories={displayCategories}
                catRoleFor={catRoleFor}
                getStats={getRosterPlayerStats}
                scoreIndexFor={scoreIndexFor}
              />
            </Panel>

            <div className="space-y-4">
              <Panel
                title="Upgrade Targets"
                action={
                  <span className="text-caption text-muted-foreground">
                    {battersLoading ? 'Loading...' : `${activeBatters.length} available`}
                  </span>
                }
              >
                <UpgradeTargetsTable
                  players={activeBatters}
                  displayCategories={displayCategories}
                  catRoleFor={catRoleFor}
                  getStats={getFAStats}
                  scoreIndexFor={scoreIndexFor}
                />
              </Panel>

              {stashBatters.length > 0 && (
                <Panel
                  title="Stash Targets (IL)"
                  action={<span className="text-caption text-muted-foreground">{stashBatters.length} found</span>}
                >
                  <UpgradeTargetsTable
                    players={stashBatters}
                    displayCategories={displayCategories}
                    catRoleFor={catRoleFor}
                    getStats={getFAStats}
                    scoreIndexFor={scoreIndexFor}
                  />
                </Panel>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pitcher UI components
// ---------------------------------------------------------------------------

function RegimeBadge({ regime }: { regime: import('@/lib/pitching/talent').PitcherTalent['regime'] | null }) {
  // regime comes from talent.regime
  if (!regime || Math.abs(regime.score || 0) < 0.8) return null;
  const isBreakout = regime.score > 0;
  return (
    <Badge color={isBreakout ? 'success' : 'error'} title={`Regime Score: ${regime.score?.toFixed(1)}. Confirming indicators: ${isBreakout ? regime.breakouts : regime.declines}`}>
      <Icon icon={isBreakout ? FiTrendingUp : FiChevronDown} size={10} /> {isBreakout ? 'Breakout' : 'Decline'}
    </Badge>
  );
}

function PitcherScoreCell({
  score,
  confidence,
}: {
  score: number;
  confidence: PitcherRating['confidence'];
}) {
  const color = score >= 62 ? 'text-success' : score <= 35 ? 'text-error' : 'text-foreground';
  const title = `${confidence.reason}${confidence.band > 5 ? ` (±${confidence.band.toFixed(0)})` : ''}`;
  return (
    <td className={`px-2 py-1.5 text-right text-xs tabular-nums font-semibold ${color}`} title={title}>
      {score.toFixed(0)}
      {confidence.band > 5 && <span className="text-[10px] opacity-50 ml-0.5">±{confidence.band.toFixed(0)}</span>}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Pitcher Tables
// ---------------------------------------------------------------------------

function PitcherTable({
  players,
  talentMap,
  scoredCategories,
  categoryWeights,
  emptyMessage,
}: {
  players: Array<RosterEntry | FreeAgentPlayer>;
  talentMap: Record<string, import('@/lib/mlb/players').PitcherTalentWithMetadata>;
  scoredCategories: EnrichedLeagueStatCategory[];
  categoryWeights: Record<number, number>;
  emptyMessage: string;
}) {
  const scored = useMemo(() => {
    return players.map(p => {
      const entry = talentMap[`${p.name.toLowerCase()}|${p.editorial_team_abbr.toLowerCase()}`];
      if (!entry) return { player: p, talent: null, rating: null, metadata: null };
      const isFA = 'ownership_type' in p;
      const rating = getPitcherSeasonRating({
        talent: entry.talent,
        scoredCategories,
        categoryWeights,
        metadata: entry.metadata,
        status: p.status,
        ownershipPercent: p.percent_owned,
        isRostered: !isFA,
      });
      return { player: p, talent: entry.talent, rating, metadata: entry.metadata };
    }).sort((a, b) => (b.rating?.score ?? -1) - (a.rating?.score ?? -1));
  }, [players, talentMap, scoredCategories, categoryWeights]);

  if (players.length === 0) {
    return <p className="text-xs text-muted-foreground p-4">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Player</th>
            <th className="text-right px-2 py-1.5 text-muted-foreground font-medium w-12">K%</th>
            <th className="text-right px-2 py-1.5 text-muted-foreground font-medium w-12">BB%</th>
            <th className="text-right px-2 py-1.5 text-muted-foreground font-medium w-12">xERA</th>
            <th className="text-right px-2 py-1.5 text-muted-foreground font-medium w-14">Score</th>
            <th className="text-center px-2 py-1.5 text-muted-foreground font-medium w-14">Tier</th>
          </tr>
        </thead>
        <tbody>
          {scored.map(({ player, talent, rating, metadata }) => {
            const isFA = 'ownership_type' in player;
            const isWaivers = isFA && (player as FreeAgentPlayer).ownership_type === 'waivers';
            const rowStatus = !isFA ? getRowStatus(player as RosterEntry) : null;
            const rowOpacity = rowStatus === 'injured' ? 'opacity-40' : '';

            return (
              <tr key={player.player_key} className={`border-b border-border/50 hover:bg-surface-muted/50 ${rowOpacity}`}>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-foreground font-medium truncate max-w-[140px]">{player.name}</span>
                    {isWaivers && <Badge color="accent">W</Badge>}
                    {player.status && <StatusBadge status={player.status} />}
                    {talent && <RegimeBadge regime={talent.regime} />}
                    {metadata?.role === 'reliever' && <Badge color="muted">RP</Badge>}
                  </div>
                  <span className="text-caption text-muted-foreground">{player.editorial_team_abbr} · {player.display_position}</span>
                </td>
                {talent ? (
                  <>
                    <td className="px-2 py-1.5 text-right text-xs tabular-nums text-foreground">{(talent.kPerPA * 100).toFixed(1)}%</td>
                    <td className="px-2 py-1.5 text-right text-xs tabular-nums text-foreground">{(talent.bbPerPA * 100).toFixed(1)}%</td>
                    <td className="px-2 py-1.5 text-right text-xs tabular-nums text-foreground">
                      {rating?.categories.find(c => c.statId === 26)?.expected.toFixed(2) || '—'}
                    </td>
                    <PitcherScoreCell score={rating?.score ?? 0} confidence={rating?.confidence || { level: 'low', reason: 'No data', band: 15 }} />
                    <td className={`px-2 py-1.5 text-center font-bold ${rating ? tierColor(rating.tier) : ''}`}>
                      {rating ? tierLabel(rating.tier) : '—'}
                    </td>
                  </>
                ) : (
                  <>
                    <td colSpan={5} className="px-2 py-1.5 text-center text-muted-foreground italic">Fetching talent data...</td>
                  </>
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
// Streaming Advisor (Churn)
// ---------------------------------------------------------------------------

function StreamingAdvisor({
  rosterPitchers,
  availablePitchers,
  talentMap,
  scoredCategories,
  categoryWeights,
}: {
  rosterPitchers: RosterEntry[];
  availablePitchers: FreeAgentPlayer[];
  talentMap: Record<string, import('@/lib/mlb/players').PitcherTalentWithMetadata>;
  scoredCategories: EnrichedLeagueStatCategory[];
  categoryWeights: Record<number, number>;
}) {
  const advice = useMemo(() => {
    if (Object.keys(talentMap).length === 0) return null;

    const scoredRoster = rosterPitchers
      .map(p => {
        const entry = talentMap[`${p.name.toLowerCase()}|${p.editorial_team_abbr.toLowerCase()}`];
        if (!entry) return null;
        const rating = getPitcherSeasonRating({ 
          talent: entry.talent, 
          scoredCategories, 
          categoryWeights,
          metadata: entry.metadata,
          status: p.status,
          ownershipPercent: p.percent_owned,
          isRostered: true
        });
        return { player: p, rating };
      })
      .filter((x): x is { player: RosterEntry; rating: PitcherRating } => x !== null && x.rating.score > 0)
      .sort((a, b) => a.rating.score - b.rating.score);

    // Replacement level is "what a healthy streamer produces this week" —
    // IL arms can't be streamed, so they're out of the pool entirely.
    const scoredFAs = availablePitchers
      .slice(0, 50)
      .filter(p => !isStashableIL(p))
      .map(p => {
        const entry = talentMap[`${p.name.toLowerCase()}|${p.editorial_team_abbr.toLowerCase()}`];
        if (!entry) return null;
        const rating = getPitcherSeasonRating({ 
          talent: entry.talent, 
          scoredCategories, 
          categoryWeights,
          metadata: entry.metadata,
          status: p.status,
          ownershipPercent: p.percent_owned,
          isRostered: false
        });
        return { player: p, rating };
      })
      .filter((x): x is { player: FreeAgentPlayer; rating: PitcherRating } => x !== null && x.rating.score > 0)
      .sort((a, b) => b.rating.score - a.rating.score);

    // Replacement level: top 5 streamers average
    const replacementScore = scoredFAs.slice(0, 5).reduce((acc, x) => acc + x.rating.score, 0) / Math.max(1, Math.min(5, scoredFAs.length));

    // Candidates for churn: rostered pitchers below replacement level
    const churnCandidates = scoredRoster.filter(p => p.rating.score < replacementScore - 2);

    return { replacementScore, churnCandidates, topFAs: scoredFAs.slice(0, 3) };
  }, [rosterPitchers, availablePitchers, talentMap, scoredCategories, categoryWeights]);

  if (!advice || advice.churnCandidates.length === 0) return null;

  return (
    <Panel
      title={
        <div className="flex items-center gap-2">
          <Icon icon={FiTarget} size={14} className="text-accent" />
          <Heading as="h2">Streaming Advisor</Heading>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-foreground">
          Current streaming replacement level is <span className="font-bold text-accent">{advice.replacementScore.toFixed(0)}</span>. 
          The following pitchers are underperforming this baseline and could be dropped to open up a streaming slot for higher weekly output:
        </p>
        <div className="space-y-2">
          {advice.churnCandidates.slice(0, 3).map(({ player, rating }) => (
            <div key={player.player_key} className="flex items-center justify-between p-2 rounded bg-surface-muted/50 border border-border/50">
              <div className="flex flex-col">
                <span className="text-xs font-bold text-error">{player.name}</span>
                <span className="text-caption text-muted-foreground">{player.editorial_team_abbr} · Talent Score: {rating.score.toFixed(0)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge color="error">Drop Candidate</Badge>
                <div className="text-right">
                  <span className="text-xs font-bold text-accent">−{(advice.replacementScore - rating.score).toFixed(0)} pts</span>
                  <span className="block text-caption text-muted-foreground">vs streamer</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-caption text-muted-foreground italic">
          Tip: Churning these slots allows you to capture ~2-3 extra starts per week from top-available streamers.
        </p>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Pitchers Tab - Implementation
// ---------------------------------------------------------------------------

function PitchersTab({
  rosterPitchers,
  availablePitchers,
  pitchersLoading,
  isLoading,
  categories,
  pitcherWeights,
  forecast,
  forecastLoading,
}: {
  rosterPitchers: RosterEntry[];
  availablePitchers: FreeAgentPlayer[];
  pitchersLoading: boolean;
  isLoading: boolean;
  categories: EnrichedLeagueStatCategory[];
  pitcherWeights: RosterCategoryWeights;
  forecast: LeagueForecast | undefined;
  forecastLoading: boolean;
}) {
  const { talentMap, isLoading: talentLoading } = usePitcherTalent([...rosterPitchers, ...availablePitchers.slice(0, 50)]);

  const pitchingCategories = useMemo(
    () => categories.filter(c => c.is_pitcher_stat),
    [categories],
  );

  const displayCategories = useMemo(
    () => pitchingCategories.filter(c => supportsPitcherStatId(c.stat_id)),
    [pitchingCategories],
  );

  // All supported cats stay in the score; leverage weights (0 when
  // conceded) do the emphasis work the old punt-filter used to do.
  const scoredCategories = displayCategories;
  const categoryWeights = pitcherWeights.categoryWeights;

  const filteredFAs = useMemo(() => {
    return availablePitchers.slice(0, 50).filter(p => {
      // IL arms can't be started — they belong in Stash Targets below,
      // not in an "Active" upgrade list. Same rubric as the batter
      // upgrade table (isStashableIL): DTD/NA/SUSP still earn their
      // slot through score.
      if (isStashableIL(p)) return false;

      const entry = talentMap[`${p.name.toLowerCase()}|${p.editorial_team_abbr.toLowerCase()}`];
      if (!entry) return true;

      // Compute temporary rating to check score
      const rating = getPitcherSeasonRating({
        talent: entry.talent,
        scoredCategories,
        categoryWeights,
        metadata: entry.metadata,
        status: p.status,
        ownershipPercent: p.percent_owned,
        isRostered: false,
      });

      // Filter out players with 0 score (Inactive/Ghosts who aren't stashed)
      return rating.score > 0;
    });
  }, [availablePitchers, talentMap, scoredCategories, categoryWeights]);

  const stashTargets = useMemo(() => {
    return availablePitchers.slice(0, 80).filter(p => {
      const entry = talentMap[`${p.name.toLowerCase()}|${p.editorial_team_abbr.toLowerCase()}`];
      if (!entry) return false;

      // Stash targets are:
      // 1. On a real Yahoo IL (IL10/IL15/IL60/DL — not DTD/NA/SUSP)
      // 2. Ghosts (0 IP in 2026) with > 15% ownership (Cole/Greene)
      const isStash = entry.metadata.isGhost && (p.percent_owned || 0) >= 15;

      return isStashableIL(p) || isStash;
    });
  }, [availablePitchers, talentMap]);

  if (isLoading || talentLoading) {
    return (
      <Panel className="p-8 text-center">
        <div className="animate-pulse text-sm text-muted-foreground">Loading pitcher talent and evaluation data...</div>
      </Panel>
    );
  }

  return (
    <>
      <RosterFocusPanel
        forecast={forecast}
        isLoading={forecastLoading}
        side="pitching"
        leverage={pitcherWeights.leverage}
        isConceded={pitcherWeights.isConceded}
        isAutoConceded={pitcherWeights.isAutoConceded}
        onToggleConcede={pitcherWeights.toggleConcede}
        onReset={pitcherWeights.reset}
        hasOverrides={pitcherWeights.hasOverrides}
      />

      <StreamingAdvisor 
        rosterPitchers={rosterPitchers}
        availablePitchers={availablePitchers}
        talentMap={talentMap}
        scoredCategories={scoredCategories}
        categoryWeights={categoryWeights}
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel
          title="Your Pitchers"
          action={<span className="text-caption text-muted-foreground">{rosterPitchers.length} on roster</span>}
        >
          <PitcherTable 
            players={rosterPitchers} 
            talentMap={talentMap}
            scoredCategories={scoredCategories}
            categoryWeights={categoryWeights}
            emptyMessage="No pitchers on roster"
          />
        </Panel>

        <div className="space-y-4">
          <Panel
            title="Active Upgrades (Waiver Wire)"
            action={
              <span className="text-caption text-muted-foreground">
                {pitchersLoading ? 'Loading...' : `${filteredFAs.length} active`}
              </span>
            }
          >
            <PitcherTable 
              players={filteredFAs.slice(0, 25)} 
              talentMap={talentMap}
              scoredCategories={scoredCategories}
              categoryWeights={categoryWeights}
              emptyMessage="No active upgrades found"
            />
          </Panel>

          {stashTargets.length > 0 && (
            <Panel
              title="Stash Targets (IL / Prospects)"
              action={<span className="text-caption text-muted-foreground">{stashTargets.length} found</span>}
            >
              <PitcherTable 
                players={stashTargets.slice(0, 10)} 
                talentMap={talentMap}
                scoredCategories={scoredCategories}
                categoryWeights={categoryWeights}
                emptyMessage="No stash targets found"
              />
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}


