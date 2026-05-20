'use client';

import { useMemo } from 'react';
import { FiLock } from 'react-icons/fi';
import Icon from '@/components/Icon';
import Panel from '@/components/ui/Panel';
import type { ForecastEntry, LeagueForecast } from '@/lib/league/forecast';
import {
  assignFocusForBattingSide,
  type BattingFocusPlan,
} from '@/lib/league/forwardFocus';
import type { Focus } from '@/lib/rating/focus';
import type { SuggestedFocus } from '@/lib/matchup/analysis';
import {
  FocusSectionTrio,
  FocusSegmentedControl,
  FocusResetButton,
  deriveFocusSection,
  isFocusOverride,
} from '@/components/shared/focusPanel';

/**
 * Roster Focus: per-cat tiles grouped by chase/hold/punt for ROS
 * roster-construction decisions. Mirrors `GamePlanPanel`'s tile grid +
 * segmented-control focus picker via the shared `focusPanel` chrome,
 * so the visual grammar is identical across the two pages. The tile
 * content differs: this panel shows projected league rank, z-score,
 * and outlier flags instead of this-week's matchup values.
 *
 * The suggestion source is `useLeagueForecast` (talent-only neutral-
 * week per-team projection ranked across the league) → `forwardFocus`
 * mapper, captured in `suggestedFocusMap`. See
 * [docs/roster-strategy.md](../../../docs/roster-strategy.md) for the
 * matchup-vacuum design.
 *
 * One component, two sides — `side` filters to batter or pitcher cats.
 *
 * **Section placement uses the always-jump rule** — see
 * `@/components/shared/focusPanel`. Rows place by the user's effective
 * focus, so clicking PUNT on a tile moves it to PUNT immediately. The
 * override dot still surfaces "engine disagreed" when the user's choice
 * differs from the forecast-driven suggestion.
 */
interface RosterFocusPanelProps {
  forecast: LeagueForecast | undefined;
  isLoading: boolean;
  side?: 'batting' | 'pitching';
  /** Pre-computed batting plan. When the parent already computed the
   *  plan (e.g. to feed the swap-suggestions analyzer), pass it in to
   *  avoid recomputing. Pitcher side ignores this prop. */
  plan?: BattingFocusPlan;
  /** User's effective focus per stat_id. */
  focusMap: Record<number, Focus>;
  /** Direct-select callback — set the stat's focus to a specific value. */
  onSetFocus: (statId: number, focus: Focus) => void;
  /** Suggestion baseline. When provided, tiles whose effective focus
   *  differs render an override dot on the segmented control. */
  suggestedFocusMap?: Record<number, Focus>;
  /** Reset-to-suggested affordance — only renders when `hasOverrides`. */
  onReset?: () => void;
  hasOverrides?: boolean;
}

export default function RosterFocusPanel({
  forecast,
  isLoading,
  side = 'batting',
  plan: planProp,
  focusMap,
  onSetFocus,
  suggestedFocusMap,
  onReset,
  hasOverrides = false,
}: RosterFocusPanelProps) {
  const sideEntries = useMemo(() => {
    if (!forecast) return [];
    return forecast.entries.filter(e =>
      side === 'batting' ? e.isBatterStat : e.isPitcherStat,
    );
  }, [forecast, side]);

  // Batting side may have a strategic plan attached (anchors / swings /
  // concedes filling a winning-majority target). When present, surface
  // it in the helper text. `planProp` short-circuits recomputation when
  // the parent has already produced the plan (it's also consumed by the
  // swap analyzer upstream — single source of truth, no double work).
  const battingPlan = useMemo<BattingFocusPlan | null>(() => {
    if (side !== 'batting' || sideEntries.length === 0) return null;
    return planProp ?? assignFocusForBattingSide(sideEntries);
  }, [side, sideEntries, planProp]);

  // Always-jump grouping — section comes from `focusMap[statId]`,
  // identical to the rule used by `GamePlanPanel`. The forecast-driven
  // suggestion still seeds `focusMap` (via `useSuggestedFocus`), so by
  // default rows land in the engine-suggested section; user toggles
  // move them instantly.
  const grouped = useMemo(() => {
    const chase: ForecastEntry[] = [];
    const hold: ForecastEntry[] = [];
    const punt: ForecastEntry[] = [];
    for (const entry of sideEntries) {
      const section = deriveFocusSection(focusMap, entry.statId);
      if (section === 'chase') chase.push(entry);
      else if (section === 'punt') punt.push(entry);
      else hold.push(entry);
    }
    // Sort within sections: chase by closest-target-first; hold by best
    // z descending; punt by extremity (locked first, then out-of-reach).
    chase.sort((a, b) => a.me.rank - b.me.rank);
    hold.sort((a, b) => b.zCompetitive - a.zCompetitive);
    punt.sort((a, b) => Math.abs(b.zCompetitive) - Math.abs(a.zCompetitive));
    return { chase, hold, punt };
  }, [sideEntries, focusMap]);

  const sideLabel = side === 'pitching' ? 'Pitching' : 'Batting';
  const title = `${sideLabel} Roster Focus`;

  const action = (
    <div className="flex items-center gap-2 text-xs flex-wrap justify-end">
      {forecast && (
        <span className="text-muted-foreground">
          Across {forecast.teamCount} teams
        </span>
      )}
      {onReset && <FocusResetButton onReset={onReset} hasOverrides={hasOverrides} />}
    </div>
  );

  // Helper text — for batting, surface the plan's strategic summary
  // (anchors / swings / target). For pitching, fall back to the generic
  // forward-looking framing until the pitcher portfolio model lands.
  const helper = battingPlan
    ? buildBattingHelper(battingPlan)
    : 'ROS: where your roster ranks against the league on talent in a neutral matchup, with outlier teams excluded so closeable gaps still surface.';

  if (isLoading && sideEntries.length === 0) {
    return (
      <Panel title={title} action={action}>
        <p className="text-xs text-muted-foreground">Computing league forecast…</p>
      </Panel>
    );
  }

  if (sideEntries.length === 0) {
    return (
      <Panel title={title} action={action}>
        <p className="text-xs text-muted-foreground">
          No {side === 'pitching' ? 'pitcher-cat' : 'batter-cat'} signal yet.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title={title} action={action} helper={helper}>
      <div className="space-y-3">
        <FocusSectionTrio
          groups={grouped}
          emptyStates={{
            chase: 'No reachable targets — every cat is either locked or out of reach.',
            hold: 'Nothing comfortably ahead — every contested cat is in chase or punt.',
            punt: 'No locked extremes — every cat is still in play.',
          }}
          renderTile={entry => (
            <CategoryTile
              key={entry.statId}
              entry={entry}
              focus={focusMap[entry.statId] ?? 'neutral'}
              onSet={onSetFocus}
              isOverride={isFocusOverride(focusMap, suggestedFocusMap, entry.statId)}
            />
          )}
        />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Helper-text builder — surfaces the strategic picture in the panel header
// ---------------------------------------------------------------------------

/**
 * Plain-language summary of the v2 batting plan. Three shapes:
 *  - **Already at majority:** "Anchored in 4/5 — defend, don't dilute."
 *  - **Filling deficit:** "Anchored in 3, swinging on HR and SB to reach 5."
 *  - **Below majority:** "Roster is below 5 wins; only 1 swing is closeable.
 *     A roster shape change is likely needed."
 */
function buildBattingHelper(plan: BattingFocusPlan): string {
  const { anchors, swings, majority, belowMajority } = plan;
  const anchorCount = anchors.length;
  const totalCats = plan.anchors.length + plan.swings.length + plan.concedes.length;
  const committed = anchorCount + swings.length;

  if (belowMajority) {
    return swings.length === 0
      ? `Below the ${majority}/${totalCats} majority floor and no cats are closeable through pickups — a roster shape change is the lever.`
      : `Below the ${majority}/${totalCats} majority floor; only ${swings.length} cat${swings.length === 1 ? '' : 's'} ${swings.length === 1 ? 'is' : 'are'} closeable. The rest need a roster shape change.`;
  }

  if (swings.length === 0) {
    return anchorCount === totalCats
      ? `Anchored in all ${anchorCount} cats — coast and defend.`
      : `Anchored in ${anchorCount}/${totalCats}. ${totalCats - anchorCount} cat${totalCats - anchorCount === 1 ? '' : 's'} out of reach — focus elsewhere.`;
  }

  const swingNames = swings.map(s => s.displayName).join(', ');
  return `Anchored in ${anchorCount}/${totalCats}; chasing ${swingNames} → ${committed}/${totalCats} winnable.`;
}

// ---------------------------------------------------------------------------
// CategoryTile — label + segmented control + rank + z-score + target/outlier flags
// ---------------------------------------------------------------------------

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatZ(z: number): string {
  if (!Number.isFinite(z) || z === 0) return '0σ';
  const sign = z > 0 ? '+' : '−';
  return `${sign}${Math.abs(z).toFixed(1)}σ`;
}

function CategoryTile({
  entry,
  focus,
  onSet,
  isOverride,
}: {
  entry: ForecastEntry;
  focus: Focus;
  onSet: (statId: number, focus: Focus) => void;
  isOverride: boolean;
}) {
  // Tertile-based border tone — stable on small leagues where z-scores
  // are jittery. Top third = success, bottom third = error, else neutral.
  const teamCount = entry.ranking.length;
  const third = Math.max(1, Math.ceil(teamCount / 3));
  const borderTone =
    entry.me.rank <= third ? 'border-success/30 bg-success/5'
    : entry.me.rank > teamCount - third ? 'border-error/30 bg-error/5'
    : 'border-border bg-background';

  const rankColor =
    entry.me.rank <= third ? 'text-success'
    : entry.me.rank > teamCount - third ? 'text-error'
    : 'text-foreground';

  const zColor =
    entry.zCompetitive >= 0.5 ? 'text-success'
    : entry.zCompetitive <= -0.5 ? 'text-error'
    : 'text-muted-foreground';

  // Outlier above me — surface only when there's at least one outlier
  // ranked above the user (locked-good for that team).
  const outlierAbove = entry.outliers
    .filter(o => o.rank < entry.me.rank)
    .sort((a, b) => a.rank - b.rank)[0];

  const targetChip = entry.targetRank !== undefined && entry.targetRank < entry.me.rank
    ? `→ ${ordinal(entry.targetRank)}`
    : null;

  return (
    <div
      className={`flex flex-col px-3 py-2 rounded-lg border ${borderTone} min-w-[9rem]`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-base font-bold text-foreground tracking-wide leading-none">{entry.displayName}</span>
        <FocusSegmentedControl
          statId={entry.statId}
          focus={focus}
          onSet={onSet}
          isOverride={isOverride}
        />
      </div>
      <div className="flex items-baseline gap-2 tabular-nums leading-tight">
        <span className={`text-sm font-bold ${rankColor}`}>
          {ordinal(entry.me.rank)}
          <span className="text-muted-foreground/60 font-normal"> / {teamCount}</span>
        </span>
        <span aria-hidden="true" className="text-muted-foreground/40 select-none">|</span>
        <span className={`text-xs ${zColor}`}>{formatZ(entry.zCompetitive)}</span>
      </div>
      {(targetChip || outlierAbove) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-caption">
          {targetChip && (
            <span className="text-accent">{targetChip}</span>
          )}
          {outlierAbove && (
            <span className="flex items-center gap-1 text-muted-foreground/80" title={`${outlierAbove.teamName} locked at ${ordinal(outlierAbove.rank)}`}>
              <Icon icon={FiLock} size={10} />
              <span>{ordinal(outlierAbove.rank)} locked</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export type { SuggestedFocus };
