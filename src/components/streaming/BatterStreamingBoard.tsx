'use client';

import { useMemo } from 'react';
import Panel from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import type { Focus } from '@/lib/mlb/batterRating';
import type { WeekBatterScore } from '@/lib/hooks/useWeekBatterScores';
import type { FAStreamingValue, SlotAwarePerDay } from '@/lib/projection/slotAware';
import type { PerDayProjection } from '@/lib/projection/batterTeam';
import type { WeekDay } from '@/lib/dashboard/weekRange';

interface BatterStreamingBoardProps {
  faScores: WeekBatterScore[];
  slotAwareValues: Map<string, FAStreamingValue>;
  days: WeekDay[];
  focusMap: Record<number, Focus>;
  faLoading: boolean;
  helper?: string;
}

/**
 * Tier display for the slot-aware `streamingValue` (sum of daily deltas
 * across the rest of the matchup week — typically 0 to ~50). Independent
 * of `batterTierFromScore`, which lives on the per-game 0-100 scale.
 */
type StreamingTier = 'great' | 'good' | 'neutral' | 'poor' | 'bench';
function streamingTier(value: number): StreamingTier {
  if (value >= 30) return 'great';
  if (value >= 15) return 'good';
  if (value >= 5)  return 'neutral';
  if (value > 0)   return 'poor';
  return 'bench';
}
const TIER_LABEL: Record<StreamingTier, string> = {
  great: 'GREAT',
  good: 'GOOD',
  neutral: 'OK',
  poor: 'MARGINAL',
  bench: 'BENCH',
};
const TIER_TONE: Record<StreamingTier, string> = {
  great: 'text-success',
  good: 'text-success',
  neutral: 'text-foreground',
  poor: 'text-accent',
  bench: 'text-muted-foreground',
};

export default function BatterStreamingBoard({
  faScores,
  slotAwareValues,
  days,
  focusMap,
  faLoading,
  helper,
}: BatterStreamingBoardProps) {
  // Decorate every FA with its slot-aware value, then rank.
  const ranked = useMemo(() => {
    return faScores
      .map(s => {
        const sa = slotAwareValues.get(s.player.player_key);
        return {
          ...s,
          streamingValue: sa?.streamingValue ?? 0,
          slotPerDay: sa?.perDay ?? [],
        };
      })
      // Filter out FAs who can't displace anyone — pure roster-page
      // candidates, not streamers.
      .filter(s => s.streamingValue > 0)
      .sort((a, b) => b.streamingValue - a.streamingValue)
      .slice(0, 30);
  }, [faScores, slotAwareValues]);

  const overallLoading = faLoading;

  return (
    <Panel
      title="Available Batters"
      helper={helper}
      action={
        <span className="text-caption text-muted-foreground">
          Ranked by slot-aware weekly contribution · top 30
        </span>
      }
    >
      {overallLoading && ranked.length === 0 ? (
        <p className="text-xs text-muted-foreground p-2">Computing weekly projection…</p>
      ) : ranked.length === 0 ? (
        <p className="text-xs text-muted-foreground p-2">
          No available batters fit your roster shape this week. The candidates with games can&apos;t
          displace any of your current starters — try the roster page for longer-term moves.
        </p>
      ) : (
        <ul className="space-y-2">
          {ranked.map(s => (
            <BatterRow
              key={s.player.player_key}
              entry={s}
              days={days}
              focusMap={focusMap}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Per-FA row
// ---------------------------------------------------------------------------

interface RowEntry extends WeekBatterScore {
  streamingValue: number;
  slotPerDay: SlotAwarePerDay[];
}

function BatterRow({
  entry,
  days,
  focusMap,
}: {
  entry: RowEntry;
  days: WeekDay[];
  focusMap: Record<number, Focus>;
}) {
  const { player, projection, streamingValue, slotPerDay } = entry;
  const tier = streamingTier(streamingValue);
  const tierLabel = TIER_LABEL[tier];
  // Index both per-day projections and slot-aware deltas by date.
  const perDayByDate = useMemo(
    () => new Map(projection.perDay.map(p => [p.date, p])),
    [projection.perDay],
  );
  const slotPerDayByDate = useMemo(
    () => new Map(slotPerDay.map(p => [p.date, p])),
    [slotPerDay],
  );

  // Position-fit summary derived from where the FA was assigned across
  // their starting days. "starts 4× at 2B, 1× at UTIL".
  const fitSummary = useMemo(() => buildFitSummary(slotPerDay), [slotPerDay]);

  // Top 3 contributing cats — same logic as before. Useful even when the
  // slot-aware ranking is the headline number.
  const topCats = useMemo(() => {
    return Array.from(projection.byCategory.entries())
      .map(([statId, cat]) => ({
        statId,
        magnitude: statId === 3 ? cat.expectedDenom / 30 : cat.expectedCount,
      }))
      .filter(c => c.magnitude > 0)
      .sort((a, b) => b.magnitude - a.magnitude)
      .slice(0, 3);
  }, [projection.byCategory]);

  const isStashable = player.on_disabled_list || /^IL\d*$/i.test(player.status ?? '');

  return (
    <li className="flex items-start gap-3 p-2.5 rounded bg-surface-muted/30 border border-border">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-foreground font-medium truncate">{player.name}</span>
          <span className="text-caption text-muted-foreground">{player.editorial_team_abbr}</span>
          <span className="text-caption text-muted-foreground">{player.display_position}</span>
          {isStashable && <Badge color="error">IL</Badge>}
          {player.ownership_type === 'waivers' && <Badge color="accent">W</Badge>}
          {typeof player.percent_owned === 'number' && (
            <span className="text-caption text-muted-foreground">{Math.round(player.percent_owned)}%</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3 flex-wrap">
          <span className="text-caption text-muted-foreground">
            {fitSummary} · {Math.round(projection.weeklyScore)} raw
          </span>
          <DayStrip days={days} perDayByDate={perDayByDate} slotPerDayByDate={slotPerDayByDate} />
        </div>
        {topCats.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {topCats.map(c => (
              <CatBadge
                key={c.statId}
                statId={c.statId}
                cat={projection.byCategory.get(c.statId)!}
                focus={focusMap[c.statId]}
              />
            ))}
          </div>
        )}
      </div>

      <ScoreCell tier={tier} label={tierLabel} value={streamingValue} />
    </li>
  );
}

/**
 * Summarise where the FA actually starts across the week. Reports up to
 * the top two slots they fill, or "blocked" when they never start (this
 * shouldn't happen in `ranked` since we filter on streamingValue > 0,
 * but the helper handles it for completeness).
 */
function buildFitSummary(slotPerDay: SlotAwarePerDay[]): string {
  const counts = new Map<string, number>();
  for (const d of slotPerDay) {
    if (!d.assignedSlot) continue;
    counts.set(d.assignedSlot, (counts.get(d.assignedSlot) ?? 0) + 1);
  }
  if (counts.size === 0) return 'blocked';
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  return sorted.map(([slot, n]) => `${n}× ${slot}`).join(', ');
}

// ---------------------------------------------------------------------------
// Day strip — split off-day vs benched vs starts
// ---------------------------------------------------------------------------

function DayStrip({
  days,
  perDayByDate,
  slotPerDayByDate,
}: {
  days: WeekDay[];
  perDayByDate: Map<string, PerDayProjection>;
  slotPerDayByDate: Map<string, SlotAwarePerDay>;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {days.map(d => {
        const day = perDayByDate.get(d.date);
        const slot = slotPerDayByDate.get(d.date);

        let tone: string;
        let title: string;

        if (!day || !day.hasGame) {
          // Off-day for the FA. Slot is inert.
          tone = 'bg-transparent text-muted-foreground/30';
          title = `${d.dayLabel} · off-day`;
        } else if (slot && slot.delta > 0) {
          // Starts. Color by the size of the contribution — a daily delta
          // ≥ 50 is excellent; ≥ 25 is good; smaller is just a marginal
          // upgrade over a bench bat.
          tone = slot.delta >= 50
            ? 'bg-success/30 text-success'
            : slot.delta >= 25
              ? 'bg-success/15 text-success'
              : 'bg-success/5 text-success';
          title = `${d.dayLabel} vs ${day.opponent ?? '?'} · starts at ${slot.assignedSlot} · +${Math.round(slot.delta)} delta${day.spName ? ` · vs ${day.spName}` : ''}${day.doubleHeader ? ' · DH' : ''}`;
        } else {
          // Has a game but didn't crack the lineup — your day is full.
          tone = 'bg-surface-muted text-muted-foreground/50';
          title = `${d.dayLabel} vs ${day.opponent ?? '?'} · benched (your day is full)${day.spName ? ` · vs ${day.spName}` : ''}`;
        }

        return (
          <span
            key={d.date}
            className={`px-1.5 py-0.5 rounded text-[9px] font-semibold tabular-nums ${tone} ${day?.doubleHeader ? 'ring-1 ring-accent/50' : ''}`}
            title={title}
          >
            {d.dayLabel}
          </span>
        );
      })}
    </div>
  );
}

function CatBadge({
  statId,
  cat,
  focus,
}: {
  statId: number;
  cat: { expectedCount: number; expectedDenom: number };
  focus?: Focus;
}) {
  const label = STAT_LABEL[statId] ?? `#${statId}`;
  const value =
    statId === 3
      ? (cat.expectedDenom > 0 ? cat.expectedCount / cat.expectedDenom : 0).toFixed(3).replace(/^0\./, '.')
      : cat.expectedCount.toFixed(1);
  const focusClass =
    focus === 'chase' ? 'border-success/40 text-success'
    : focus === 'punt' ? 'border-muted-foreground/30 text-muted-foreground/40'
    : 'border-border text-muted-foreground';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-caption font-medium ${focusClass}`}>
      <span className="font-semibold">{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

const STAT_LABEL: Record<number, string> = {
  3: 'AVG',
  7: 'R',
  8: 'H',
  12: 'HR',
  13: 'RBI',
  16: 'SB',
  18: 'BB',
  21: 'K',
  23: 'TB',
};

function ScoreCell({
  tier,
  label,
  value,
}: {
  tier: StreamingTier;
  label: string;
  value: number;
}) {
  const tone = TIER_TONE[tier];
  return (
    <div className="text-right shrink-0 leading-tight">
      <div className={`text-lg font-bold tabular-nums ${tone}`}>+{Math.round(value)}</div>
      <div className={`text-caption font-semibold uppercase tracking-wide ${tone}`}>{label}</div>
    </div>
  );
}
