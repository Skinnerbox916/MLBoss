'use client';

import { useState } from 'react';
import { FiTrendingUp, FiLayers } from 'react-icons/fi';
import Panel from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import Tabs from '@/components/ui/Tabs';
import Skeleton from '@/components/ui/Skeleton';
import Icon from '@/components/Icon';
import { Heading, Text } from '@/components/typography';
import { usePointsTeam } from '@/lib/hooks/usePointsTeam';
import SuggestedMovesPanel from '@/components/points/SuggestedMovesPanel';
import RosterMoveCard from '@/components/shared/RosterMoveCard';
import PositionalDepthTable, { DepthStepper } from '@/components/shared/PositionalDepthTable';
import { getDefaultDepth, type BatterPosition } from '@/lib/roster/depth';
import { POINTS_PREFERRED_DEPTH_KEY } from '@/lib/roster/preferredDepth';
import { usePreferredDepth } from '@/lib/hooks/usePreferredDepth';
import type { PointsPlayerRow } from '@/lib/points/analyzeTeam';
import type { PointsBatterMove } from '@/lib/points/rosterStrategy';
import { usePointsRosterStrategy } from '@/lib/hooks/usePointsRosterStrategy';

interface PointsRosterViewProps {
  leagueKey: string | undefined;
  teamKey: string | undefined;
  scoringType: string | undefined;
}

/**
 * Points-league /roster experience — positionally-honest upgrade shopping
 * over a ROS horizon (see docs/roster-strategy.md and the points detail
 * doc). Three sections, in the grammar the categories page established:
 *
 *   1. Positional Depth — the slot picture upgrades must fit within.
 *   2. Suggested Moves — batter moves from the shared position-aware swap
 *      engine, valued in pts/wk (native units); pure adds when slots are
 *      open. Pitcher moves stay on the greedy list until the joint
 *      categories+points pitcher effort.
 *   3. Your Batters ↔ Upgrade Targets — the comparison tables, plus the
 *      pitcher board on its own tab.
 *
 * Talent-neutral ROS lens (matchup-vacuum), single points objective — no
 * strategy header by design: there are no categories to weight or concede.
 */
export default function PointsRosterView({ leagueKey, teamKey, scoringType }: PointsRosterViewProps) {
  const [tab, setTab] = useState<'batters' | 'pitchers'>('batters');

  // Target-depth overrides — persisted per league mode, sent to the server
  // so the depth chart AND the swap engine honor them (the points analysis
  // runs server-side, unlike the categories page's client-side solve).
  const { preferredDepth, updatePreferredDepth } = usePreferredDepth(POINTS_PREFERRED_DEPTH_KEY);

  const { data, isLoading, isError } = usePointsTeam(leagueKey, teamKey, scoringType);
  // Strategy (moves / depth / open slots) solves client-side over the
  // server's facts — a stepper click re-ranks instantly, no refetch.
  const strategy = usePointsRosterStrategy(leagueKey, teamKey, data?.batters, preferredDepth);

  return (
    <div className="space-y-4">
      <header>
        <Heading as="h1" className="text-primary">Roster</Heading>
        <Text variant="muted">Rest-of-season value &amp; moves · points league</Text>
      </header>

      {isError && (
        <Panel>
          <Text variant="small" className="text-error">Couldn&apos;t load points analysis. Try refreshing.</Text>
        </Panel>
      )}

      {isLoading && !data && (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {data && (
        <>
          <Tabs
            variant="segment"
            ariaLabel="Roster tab"
            items={[{ id: 'batters', label: 'Batters' }, { id: 'pitchers', label: 'Pitchers' }]}
            value={tab}
            onChange={(v) => setTab(v as 'batters' | 'pitchers')}
          />

          {tab === 'batters' ? (
            <>
              <Panel
                title={
                  <div className="flex items-center gap-2">
                    <Icon icon={FiLayers} size={14} className="text-accent" />
                    <Heading as="h2">Positional Depth</Heading>
                  </div>
                }
              >
                <PositionalDepthTable
                  rows={strategy.depth}
                  renderTarget={row => {
                    const pos = row.position as BatterPosition;
                    const defaultDepth = getDefaultDepth(row.startingSlots);
                    const currentDepth = preferredDepth[pos] ?? defaultDepth;
                    return (
                      <DepthStepper
                        value={currentDepth}
                        defaultValue={defaultDepth}
                        min={0}
                        max={Math.max(defaultDepth + 3, 6)}
                        onChange={next => updatePreferredDepth(pos, next)}
                      />
                    );
                  }}
                />
                <p className="text-caption text-muted-foreground mt-2">
                  Multi-position players count toward every eligible slot. Values are expected points per week;
                  moves below only suggest players who fit this picture.
                </p>
              </Panel>

              <BatterMovesPanel moves={strategy.moves} openSlots={strategy.openSlots} />

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <PlayerBoard
                  title="Your Batters"
                  rows={data.batters.filter(p => p.owned)}
                  kind="B"
                />
                <PlayerBoard
                  title="Upgrade Targets"
                  rows={data.batters.filter(p => !p.owned).slice(0, 30)}
                  kind="B"
                  showOwnership
                />
              </div>
            </>
          ) : (
            <>
              <SuggestedMovesPanel pitcherMoves={data.pitcherMoves} />
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <PlayerBoard
                  title="Your Pitchers"
                  rows={data.pitchers.filter(p => p.owned)}
                  kind="P"
                />
                <PlayerBoard
                  title="Upgrade Targets"
                  rows={data.pitchers.filter(p => !p.owned).slice(0, 30)}
                  kind="P"
                  showOwnership
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batter moves — the shared position-aware card treatment
// ---------------------------------------------------------------------------

function reasonBadge(reason: PointsBatterMove['primaryReason']) {
  if (reason === 'gap_fill') return <Badge color="error">fills gap</Badge>;
  if (reason === 'matchup_depth') return <Badge color="accent">matchup depth</Badge>;
  return <Badge color="success"><Icon icon={FiTrendingUp} size={10} /> upgrade</Badge>;
}

function BatterMovesPanel({ moves, openSlots }: { moves: PointsBatterMove[]; openSlots: number }) {
  if (moves.length === 0) {
    return (
      <Panel title="Suggested Moves">
        <Text variant="caption">
          No net-positive moves found — your roster beats the free-agent pool at every slot.
        </Text>
      </Panel>
    );
  }
  return (
    <Panel
      title="Suggested Moves"
      action={
        <span className="text-caption text-muted-foreground">
          {openSlots > 0
            ? `${openSlots} open slot${openSlots === 1 ? '' : 's'} — pure adds at top`
            : 'Position-aware net points per week'}
        </span>
      }
    >
      <div className="space-y-2">
        {moves.slice(0, 8).map((m, i) => (
          <RosterMoveCard
            key={i}
            add={{
              name: m.add.name,
              displayPosition: m.add.displayPosition,
            }}
            drop={
              m.drop
                ? {
                    name: m.drop.name,
                    displayPosition: m.drop.displayPosition,
                    percentOwned: m.drop.percentOwned,
                    averageDraftPick: m.drop.averageDraftPick,
                  }
                : null
            }
            badges={reasonBadge(m.primaryReason)}
            deltas={m.impacts.map(imp => ({
              key: imp.statId,
              label: imp.label,
              text: `${imp.delta >= 0 ? '+' : ''}${imp.delta.toFixed(1)}`,
              tone: imp.delta >= 0 ? 'text-success' : 'text-error',
              title: `${imp.label} — pts/wk change from this move`,
            }))}
            positionChanges={m.positionChanges}
            netValueText={`${m.netValue > 0 ? '+' : ''}${m.netValue.toFixed(1)}`}
            netValuePositive={m.netValue > 0}
            netValueLabel="pts/wk"
          />
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Player boards — roster and upgrade-target tables, one component
// ---------------------------------------------------------------------------

function vorTone(vor: number): string {
  if (vor > 3) return 'text-success';
  if (vor < 0) return 'text-error';
  return 'text-muted-foreground';
}

function PlayerBoard({
  title,
  rows,
  kind,
  showOwnership = false,
}: {
  title: string;
  rows: PointsPlayerRow[];
  kind: 'B' | 'P';
  showOwnership?: boolean;
}) {
  const unitLabel = kind === 'B' ? 'pts/G' : 'pts/IP';
  const sorted = [...rows].sort((a, b) => (b.vor ?? -Infinity) - (a.vor ?? -Infinity));

  return (
    <Panel
      title={title}
      action={<Text as="span" variant="caption" className="text-muted-foreground">{rows.length} {showOwnership ? 'available' : 'rostered'}</Text>}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Player</th>
              <th className="text-left px-2 py-1.5 text-muted-foreground font-medium w-16">Pos</th>
              {showOwnership && <th className="text-right px-2 py-1.5 text-muted-foreground font-medium w-12">Own%</th>}
              <th className="text-right px-2 py-1.5 text-muted-foreground font-medium w-12">{unitLabel}</th>
              <th className="text-right px-2 py-1.5 text-muted-foreground font-medium w-14">Pts / wk</th>
              {!showOwnership && <th className="text-right px-2 py-1.5 text-muted-foreground font-medium w-14">This wk</th>}
              <th className="text-right px-2 py-1.5 text-success font-medium w-14">VOR</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.playerKey} className="border-b border-border/50 hover:bg-surface-muted/50">
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-foreground font-medium truncate max-w-[140px]">{p.name}</span>
                    {p.injured && <Badge color="error">IL</Badge>}
                    {p.role === 'reliever' && <span className="font-mono text-[10px] text-muted-foreground">RP</span>}
                  </div>
                  <span className="text-caption text-muted-foreground">{p.team}</span>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">
                  {p.positions.filter(x => x !== 'Util' && x !== 'BN' && x !== 'IL').join(',') || (kind === 'P' ? 'P' : 'UT')}
                </td>
                {showOwnership && (
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    {typeof p.percentOwned === 'number' ? Math.round(p.percentOwned) : '–'}
                  </td>
                )}
                <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{p.perUnit}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-medium text-foreground">{p.weeklyPoints}</td>
                {!showOwnership && (
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{p.thisWeekPoints ?? '–'}</td>
                )}
                <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${p.vor == null ? 'text-muted-foreground' : vorTone(p.vor)}`}>
                  {p.vor == null ? '–' : (p.vor > 0 ? `+${p.vor}` : p.vor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex items-center gap-2 text-caption text-muted-foreground mt-2">
        <Icon icon={FiTrendingUp} size={13} />
        VOR = weekly points above the readily-available replacement at the position, with playing time
        scaled to each player&apos;s actual role. Negative = freely replaceable.
      </p>
    </Panel>
  );
}
