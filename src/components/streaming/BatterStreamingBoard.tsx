'use client';

import { useMemo, useState } from 'react';
import { FiChevronDown } from 'react-icons/fi';
import Icon from '@/components/Icon';
import Badge from '@/components/ui/Badge';
import Panel from '@/components/ui/Panel';
import { formatStatDelta } from '@/lib/formatStat';
import { isStashableIL } from '@/lib/roster/playerPool';
import { STREAM_STAT_LABEL, DeltaChip } from './streamCats';
import type { WeekBatterScore } from '@/lib/hooks/useWeekBatterScores';
import type { StreamValue } from '@/lib/hooks/useSlotAwareStreaming';
import type { CatDelta } from '@/lib/projection/streamCatImpact';
import type { PerDayProjection } from '@/lib/projection/batterTeam';
import type { SlotAwarePerDay } from '@/lib/projection/slotAware';
import type { WeekDay } from '@/lib/dashboard/weekRange';

interface BatterStreamingBoardProps {
  faScores: WeekBatterScore[];
  slotAwareValues: Map<string, StreamValue>;
  /** Roster player_key → name, for the "over <starter>" swap story. */
  rosterNameByKey: Map<string, string>;
  /** statId → pivotality weight (0 = conceded) — dims chips the matchup
   *  doesn't care about, same signal the Game Plan tiles show. */
  categoryWeights: Record<number, number>;
  days: WeekDay[];
  faLoading: boolean;
  helper?: string;
}

/**
 * Tier bands for the category-impact scalar (weighted, unit-normalized
 * net deltas — see streamCatImpact.ts). Calibrated 2026-07-21 against the
 * live board's distribution: the top adds land ~1.0-1.5, the long tail
 * sits under 0.3.
 */
type ImpactTier = 'great' | 'good' | 'neutral' | 'poor';
function impactTier(impact: number): ImpactTier {
  if (impact >= 1.0) return 'great';
  if (impact >= 0.5) return 'good';
  if (impact >= 0.2) return 'neutral';
  return 'poor';
}
const TIER_LABEL: Record<ImpactTier, string> = {
  great: 'GREAT',
  good: 'GOOD',
  neutral: 'OK',
  poor: 'MARGINAL',
};
const TIER_TONE: Record<ImpactTier, string> = {
  great: 'text-success',
  good: 'text-success',
  neutral: 'text-foreground',
  poor: 'text-muted-foreground',
};

/** Chips ignore contributions this small — decomposition noise. */
const MIN_CHIP_CONTRIBUTION = 0.02;

export default function BatterStreamingBoard({
  faScores,
  slotAwareValues,
  rosterNameByKey,
  categoryWeights,
  days,
  faLoading,
  helper,
}: BatterStreamingBoardProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Decorate every FA with its impact pricing, then rank.
  const ranked = useMemo(() => {
    return faScores
      .map(s => {
        const sa = slotAwareValues.get(s.player.player_key);
        return {
          ...s,
          impact: sa?.impact ?? 0,
          catDeltas: sa?.catDeltas ?? [],
          slotPerDay: sa?.perDay ?? [],
        };
      })
      // FAs whose add doesn't move any contested category aren't streams.
      .filter(s => s.impact > 0)
      .sort((a, b) => b.impact - a.impact)
      .slice(0, 30);
  }, [faScores, slotAwareValues]);

  return (
    <Panel
      title="Available Batters"
      helper={helper}
      action={
        <span className="text-caption text-muted-foreground">
          Ranked by contested-category impact · top 30
        </span>
      }
    >
      {faLoading && ranked.length === 0 ? (
        <p className="text-xs text-muted-foreground p-2">Computing weekly projection…</p>
      ) : ranked.length === 0 ? (
        <p className="text-xs text-muted-foreground p-2">
          No available batters move your contested categories this week — the candidates with
          games can&apos;t out-produce your current starters where it matters. Try the roster
          page for longer-term moves.
        </p>
      ) : (
        <div className="space-y-1">
          {ranked.map((s, i) => (
            <BatterRow
              key={s.player.player_key}
              entry={s}
              rank={i + 1}
              days={days}
              rosterNameByKey={rosterNameByKey}
              categoryWeights={categoryWeights}
              isExpanded={expandedKey === s.player.player_key}
              onToggleExpand={key => setExpandedKey(prev => (prev === key ? null : key))}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Per-FA row — the shared expandable-player-row grammar (see
// docs/ui-patterns.md#expandable-player-row; structure mirrors the pitcher
// StreamingBoard row).
// ---------------------------------------------------------------------------

interface RowEntry extends WeekBatterScore {
  impact: number;
  catDeltas: CatDelta[];
  slotPerDay: SlotAwarePerDay[];
}

function BatterRow({
  entry,
  rank,
  days,
  rosterNameByKey,
  categoryWeights,
  isExpanded,
  onToggleExpand,
}: {
  entry: RowEntry;
  rank: number;
  days: WeekDay[];
  rosterNameByKey: Map<string, string>;
  categoryWeights: Record<number, number>;
  isExpanded: boolean;
  onToggleExpand: (key: string) => void;
}) {
  const { player, projection, impact, catDeltas, slotPerDay } = entry;
  const tier = impactTier(impact);
  const tone = TIER_TONE[tier];

  const perDayByDate = useMemo(
    () => new Map(projection.perDay.map(p => [p.date, p])),
    [projection.perDay],
  );
  const slotPerDayByDate = useMemo(
    () => new Map(slotPerDay.map(p => [p.date, p])),
    [slotPerDay],
  );

  // Chips: the biggest category stories of the swap, contested first
  // (catDeltas arrive sorted by |contribution|).
  const chips = useMemo(
    () => catDeltas.filter(d => Math.abs(d.contribution) >= MIN_CHIP_CONTRIBUTION).slice(0, 3),
    [catDeltas],
  );
  const headline = chips.find(c => c.good) ?? chips[0];

  const rowTint = tier === 'great' ? 'bg-success/5' : '';

  return (
    <div className={`rounded-lg overflow-hidden ${rowTint}`}>
      <button
        type="button"
        onClick={() => onToggleExpand(player.player_key)}
        className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-surface-muted/40 transition-colors"
      >
        <div className="w-5 text-center text-xs font-bold text-muted-foreground mt-2.5 shrink-0">
          {rank}
        </div>

        {player.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={player.image_url}
            alt={player.name}
            className="w-9 h-9 rounded-full border border-border object-cover shrink-0 mt-0.5"
            onError={e => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <div className={`w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold ${player.image_url ? 'hidden' : ''}`}>
          {player.name.charAt(0).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate">{player.name}</span>
            <span className="text-[11px] text-muted-foreground">
              {player.editorial_team_abbr} · {player.display_position}
            </span>
            {isStashableIL(player) && <Badge color="error">IL</Badge>}
            {player.ownership_type === 'waivers' && <Badge color="accent">W</Badge>}
            {typeof player.percent_owned === 'number' && (
              <span className="text-caption text-muted-foreground">{Math.round(player.percent_owned)}%</span>
            )}
          </div>

          <BatterDayPills days={days} perDayByDate={perDayByDate} slotPerDayByDate={slotPerDayByDate} rosterNameByKey={rosterNameByKey} />

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {chips.map(c => (
                <DeltaChip key={c.statId} delta={c} />
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-start gap-2 mt-0.5">
          <div className="text-right leading-tight">
            <div className={`text-sm font-bold tabular-nums ${tone}`}>
              {headline ? `${STREAM_STAT_LABEL[headline.statId] ?? ''} ${formatStatDelta(headline.delta, STREAM_STAT_LABEL[headline.statId] ?? '')}` : '—'}
            </div>
            <div className={`text-caption font-semibold uppercase tracking-wide ${tone}`}>
              {TIER_LABEL[tier]}
            </div>
          </div>
          <Icon
            icon={FiChevronDown}
            size={16}
            className={`text-muted-foreground transition-transform mt-1.5 ${isExpanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {isExpanded && (
        <ExpandedSwapDetail
          entry={entry}
          days={days}
          perDayByDate={perDayByDate}
          slotPerDayByDate={slotPerDayByDate}
          rosterNameByKey={rosterNameByKey}
          categoryWeights={categoryWeights}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Day pills — the shared per-date chip grammar (docs/ui-patterns.md#day-pills),
// batter flavor: game days show opp + that day's rating; a game day where
// your lineup is already stronger renders muted ("benched"); off-days ghost.
// ---------------------------------------------------------------------------

function BatterDayPills({
  days,
  perDayByDate,
  slotPerDayByDate,
  rosterNameByKey,
}: {
  days: WeekDay[];
  perDayByDate: Map<string, PerDayProjection>;
  slotPerDayByDate: Map<string, SlotAwarePerDay>;
  rosterNameByKey: Map<string, string>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {days.map(d => {
        const day = perDayByDate.get(d.date);
        const slot = slotPerDayByDate.get(d.date);

        if (!day || !day.hasGame) {
          return (
            <span
              key={d.date}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-muted-foreground/30"
              title={`${d.dayLabel} · off-day`}
            >
              {d.dayLabel}
            </span>
          );
        }

        const score = day.rating?.score;
        const starts = !!slot?.assignedSlot;
        const over = slot?.displacedKeys
          .map(k => rosterNameByKey.get(k))
          .filter(Boolean)
          .join(', ');
        const baseTone = !starts
          ? 'bg-surface-muted text-muted-foreground/50 border border-border'
          : score !== undefined && score >= 70
            ? 'bg-success/15 text-success border border-border'
            : 'bg-surface-muted text-foreground border border-border';
        const title = starts
          ? `${d.dayLabel} vs ${day.opponent ?? '?'} · starts at ${slot!.assignedSlot}${over ? ` over ${over}` : ' (open slot)'}${day.spName ? ` · vs ${day.spName}` : ''}${day.doubleHeader ? ' · DH' : ''}`
          : `${d.dayLabel} vs ${day.opponent ?? '?'} · benched (your day is full)${day.spName ? ` · vs ${day.spName}` : ''}`;

        return (
          <span
            key={d.date}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${baseTone} ${day.doubleHeader ? 'ring-1 ring-accent/50' : ''}`}
            title={title}
          >
            <span className="text-[10px] font-bold uppercase tracking-wider">{d.dayLabel}</span>
            <span className="text-[11px] text-muted-foreground">{day.opponent ? 'vs' : ''}</span>
            <span className="text-[11px] font-semibold">{day.opponent ?? ''}</span>
            {score !== undefined && (
              <span className="text-[11px] font-bold tabular-nums">{Math.round(score)}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expanded panel — the full swap story: who he replaces day by day, and the
// net effect on every scored category (contested cats carry the color;
// conceded cats render dimmed).
// ---------------------------------------------------------------------------

function ExpandedSwapDetail({
  entry,
  days,
  perDayByDate,
  slotPerDayByDate,
  rosterNameByKey,
  categoryWeights,
}: {
  entry: RowEntry;
  days: WeekDay[];
  perDayByDate: Map<string, PerDayProjection>;
  slotPerDayByDate: Map<string, SlotAwarePerDay>;
  rosterNameByKey: Map<string, string>;
  categoryWeights: Record<number, number>;
}) {
  const startDays = days.filter(d => slotPerDayByDate.get(d.date)?.assignedSlot);

  return (
    <div className="px-3 pb-2 space-y-2">
      {startDays.length > 0 && (
        <div className="bg-surface-muted/20 rounded-lg px-3 py-2 space-y-1">
          {startDays.map(d => {
            const slot = slotPerDayByDate.get(d.date)!;
            const day = perDayByDate.get(d.date);
            const over = slot.displacedKeys
              .map(k => rosterNameByKey.get(k))
              .filter(Boolean)
              .join(', ');
            return (
              <div key={d.date} className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{d.dayLabel}</span>{' '}
                {day?.opponent ? `vs ${day.opponent}` : ''} · {slot.assignedSlot}
                {over ? <> over <span className="text-foreground">{over}</span></> : ' into an open slot'}
                {day?.rating && <> · {Math.round(day.rating.score)} rating</>}
              </div>
            );
          })}
        </div>
      )}

      {entry.catDeltas.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {entry.catDeltas.map(c => {
            const conceded = (categoryWeights[c.statId] ?? 1) <= 0;
            return (
              <DeltaChip key={c.statId} delta={c} dimmed={conceded} />
            );
          })}
        </div>
      )}
    </div>
  );
}
