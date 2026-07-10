'use client';

import { Fragment, useState } from 'react';
import { FiCheck, FiPlus, FiX } from 'react-icons/fi';
import Panel from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import Icon from '@/components/Icon';
import { Text } from '@/components/typography';
import PlayerRowShell from '@/components/lineup/PlayerRowShell';
import { tierStyle, type RowTier } from '@/components/lineup/tierStyle';
import type { WeekMove, WeekMoveDayChip, PlannedMove } from '@/lib/points/weekMoves';

/**
 * Unified points moves board: one list of net-positive add/drop moves for
 * the rest of the window — bats and arms priced in the same currency,
 * strictly sorted by net points. Staging and the drop override live in the
 * expanded panel (the collapsed row is one big toggle button, so no nested
 * controls). Staged moves leave the list (the engine re-prices around them)
 * and pin into the planned block up top with their staged net.
 */

function tierWithinPool(net: number, pool: WeekMove[]): RowTier {
  const sorted = pool.map(r => r.net).sort((a, b) => a - b);
  if (sorted.length < 4) return 'neutral';
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
  if (net >= q(0.75)) return 'great';
  if (net >= q(0.5)) return 'good';
  return 'neutral';
}

function DayChips({ chips }: { chips: WeekMoveDayChip[] }) {
  return (
    <>
      {chips.map(c => (
        <span
          key={c.date}
          className={`rounded px-1.5 py-0.5 ${
            c.kind === 'start' ? 'bg-accent/10 text-accent' : 'bg-surface-muted'
          }`}
        >
          {c.dayName}
        </span>
      ))}
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-sm font-bold text-foreground">{value}</span>
    </div>
  );
}

function MoveRow({
  m,
  pool,
  onStage,
}: {
  m: WeekMove;
  pool: WeekMove[];
  onStage: (staged: WeekMove) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Index into dropOptions — the user's drop override for this row.
  const [choice, setChoice] = useState(0);
  const chosen = m.dropOptions[Math.min(choice, m.dropOptions.length - 1)] ?? {
    drop: m.drop, net: m.net, dropCost: m.dropCost,
  };
  const style = tierStyle(tierWithinPool(m.net, pool));

  const stage = () => {
    onStage({
      ...m,
      id: `${m.add.playerKey}|${chosen.drop?.playerKey ?? 'open'}`,
      drop: chosen.drop,
      net: chosen.net,
      dropCost: chosen.dropCost,
    });
  };

  return (
    <PlayerRowShell
      tierBorder={style.border}
      tierBg={style.bg}
      imageUrl={m.add.imageUrl}
      initials={m.add.name.charAt(0).toUpperCase()}
      name={m.add.name}
      statusBadge={
        <>
          {m.kind === 'P' && m.dayChips.length >= 2 ? <Badge color="accent">2 starts</Badge> : null}
          {m.add.ownershipType === 'waivers' ? <Badge color="muted">W</Badge> : null}
        </>
      }
      metaText={`${m.add.team} · ${m.add.positions.filter(p => p !== 'Util').join(',') || m.add.positions.join(',')}`}
      metaExtra={
        m.add.percentOwned != null ? (
          <span className="shrink-0">{Math.round(m.add.percentOwned)}% owned</span>
        ) : undefined
      }
      matchupLine={
        <span className="flex flex-wrap items-center gap-1 text-[11px] font-mono text-muted-foreground">
          {chosen.drop ? (
            <span className="text-error/80">drop {chosen.drop.name}</span>
          ) : (
            <span className="text-accent">open slot</span>
          )}
          <DayChips chips={m.dayChips} />
        </span>
      }
      right={
        <div className="text-right flex flex-col items-end leading-none gap-0.5">
          <span className="font-mono tabular-nums font-bold text-sm text-success">
            +{chosen.net.toFixed(1)}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">net pts</span>
        </div>
      }
      expanded={expanded}
      onToggle={() => setExpanded(e => !e)}
    >
      <div className="px-3 py-3 bg-surface-muted/30 border-t border-border-muted space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="adds" value={`+${m.addPoints.toFixed(1)}`} />
          <StatCard label="drop cost" value={`−${chosen.dropCost.toFixed(1)}`} />
          <StatCard label="net" value={`+${chosen.net.toFixed(1)}`} />
        </div>

        {m.dropOptions.length > 1 && (
          <div className="space-y-1">
            {m.dropOptions.map((o, i) => {
              const selected = o === chosen;
              return (
                <button
                  key={o.drop?.playerKey ?? 'open'}
                  onClick={() => setChoice(i)}
                  className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] ${
                    selected ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-surface-muted/60'
                  }`}
                >
                  <span
                    className={`w-3 h-3 rounded-full border shrink-0 ${
                      selected ? 'border-primary bg-primary' : 'border-border'
                    }`}
                  />
                  {o.drop ? (
                    <span className="flex-1 min-w-0 truncate">
                      drop <span className="font-semibold">{o.drop.name}</span>
                      <span className="font-mono text-muted-foreground">
                        {' '}· {o.drop.positions.filter(p => p !== 'Util').join(',')}
                        {o.drop.vor != null ? ` · ${o.drop.vor >= 0 ? '+' : ''}${o.drop.vor.toFixed(1)} VOR` : ''}
                      </span>
                    </span>
                  ) : (
                    <span className="flex-1 text-accent">open slot</span>
                  )}
                  <span className="font-mono tabular-nums font-semibold shrink-0">
                    {o.net >= 0 ? '+' : ''}{o.net.toFixed(1)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <button
          onClick={stage}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90"
        >
          <Icon icon={FiPlus} size={14} />
          Add to plan
        </button>
      </div>
    </PlayerRowShell>
  );
}

function PlannedBlock({
  plan,
  onUnstage,
}: {
  plan: PlannedMove[];
  onUnstage: (id: string) => void;
}) {
  const total = plan.reduce((s, m) => s + m.netAtAdd, 0);
  return (
    <div className="rounded-lg border border-success/30 bg-success/5">
      {plan.map(pm => (
        <div key={pm.id} className="flex items-center gap-2 px-3 py-2 border-b border-border-muted/60 last:border-b-0">
          <Icon icon={FiCheck} size={14} className="text-success shrink-0" />
          <div className="flex-1 min-w-0 space-y-0.5">
            <span className="text-sm font-semibold text-foreground">{pm.addName}</span>
            <div className="flex flex-wrap items-center gap-1 text-[11px] font-mono text-muted-foreground">
              {pm.dropName ? (
                <span className="text-error/80">drop {pm.dropName}</span>
              ) : (
                <span className="text-accent">open slot</span>
              )}
              <DayChips chips={pm.dayChips} />
            </div>
          </div>
          <span className="font-mono tabular-nums font-bold text-sm text-success shrink-0">
            +{pm.netAtAdd.toFixed(1)}
          </span>
          <button
            onClick={() => onUnstage(pm.id)}
            aria-label={`Remove ${pm.addName} from plan`}
            className="shrink-0 rounded p-2 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
          >
            <Icon icon={FiX} size={14} />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-success/30">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">planned</span>
        <span className="font-mono tabular-nums font-bold text-sm text-success">+{total.toFixed(1)}</span>
      </div>
    </div>
  );
}

export default function PointsMovesBoard({
  moves,
  plan,
  affordableCount,
  isLoading,
  windowLabel,
  onStage,
  onUnstage,
}: {
  moves: WeekMove[];
  plan: PlannedMove[];
  /** Moves-left after the plan — rows past this sit below the budget divider. */
  affordableCount: number;
  isLoading: boolean;
  windowLabel: string;
  onStage: (staged: WeekMove) => void;
  onUnstage: (id: string) => void;
}) {
  const divider = affordableCount > 0 && affordableCount < moves.length ? affordableCount : null;
  return (
    <Panel
      title="This week's moves"
      action={
        <Text as="span" variant="caption" className="text-muted-foreground font-mono">
          net points, {windowLabel}
        </Text>
      }
    >
      <div className="space-y-2">
        {plan.length > 0 && <PlannedBlock plan={plan} onUnstage={onUnstage} />}

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : moves.length === 0 ? (
          <Text variant="small" className="text-muted-foreground">
            {plan.length > 0
              ? 'No further net-positive moves this window.'
              : 'No net-positive moves this window.'}
          </Text>
        ) : (
          <div className="space-y-1">
            {moves.map((m, i) => (
              <Fragment key={m.add.playerKey}>
                {divider === i && <div className="border-t-2 border-dashed border-border-muted my-2" />}
                <MoveRow m={m} pool={moves} onStage={onStage} />
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
