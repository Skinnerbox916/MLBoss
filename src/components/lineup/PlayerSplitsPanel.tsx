'use client';

import type { BatterSplits, PlayerStatLine, SplitLine } from '@/lib/mlb/types';
import {
  type MatchupContext,
  getFormTrend,
  getOpposingStaffPill,
} from '@/lib/mlb/analysis';
import type {
  BatterRating,
  CategoryContribution,
  RatingMultiplier,
} from '@/lib/mlb/batterRating';

function fmt(value: number | null, digits: number = 3): string {
  if (value === null) return '—';
  return value.toFixed(digits).replace(/^0\./, '.');
}

function fmtInt(value: number): string {
  return value.toString();
}

function pctSigned(pct: number): string {
  if (Math.abs(pct) < 0.1) return '±0.0%';
  const sign = pct > 0 ? '+' : '−';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

function ptsSigned(pts: number): string {
  if (Math.abs(pts) < 0.1) return '±0.0';
  const sign = pts > 0 ? '+' : '−';
  return `${sign}${Math.abs(pts).toFixed(1)}`;
}

// ---------------------------------------------------------------------------
// Tier styling — one palette per tier, used across hero + drivers.
// ---------------------------------------------------------------------------

type TierPalette = {
  label: string;
  scoreText: string;
  scoreBg: string;
  heroBg: string;
  heroBorder: string;
};

function tierPalette(tier: BatterRating['tier']): TierPalette {
  switch (tier) {
    case 'great':
      return {
        label: 'Great',
        scoreText: 'text-success',
        scoreBg: 'bg-success/20',
        heroBg: 'bg-success/5',
        heroBorder: 'border-success/30',
      };
    case 'good':
      return {
        label: 'Good',
        scoreText: 'text-success',
        scoreBg: 'bg-success/15',
        heroBg: 'bg-success/5',
        heroBorder: 'border-success/20',
      };
    case 'neutral':
      return {
        label: 'Neutral',
        scoreText: 'text-muted-foreground',
        scoreBg: 'bg-surface-muted',
        heroBg: 'bg-surface-muted/40',
        heroBorder: 'border-border-muted',
      };
    case 'poor':
      return {
        label: 'Poor',
        scoreText: 'text-error',
        scoreBg: 'bg-error/15',
        heroBg: 'bg-error/5',
        heroBorder: 'border-error/20',
      };
    case 'bad':
      return {
        label: 'Bad',
        scoreText: 'text-error',
        scoreBg: 'bg-error/20',
        heroBg: 'bg-error/5',
        heroBorder: 'border-error/30',
      };
  }
}

// ---------------------------------------------------------------------------
// Narrative headline — summarises the biggest contribution + context tilt
// ---------------------------------------------------------------------------

function topContributions(cats: CategoryContribution[]): {
  up: CategoryContribution | null;
  down: CategoryContribution | null;
} {
  let up: CategoryContribution | null = null;
  let down: CategoryContribution | null = null;
  for (const c of cats) {
    if (c.weight === 0) continue;
    if (c.contribution > 0 && (!up || c.contribution > up.contribution)) up = c;
    if (c.contribution < 0 && (!down || c.contribution < down.contribution)) down = c;
  }
  return { up, down };
}

function driverSentence(
  rating: BatterRating,
  playerName: string,
  pitcherName: string | null,
): string {
  const firstName = playerName.split(' ')[0];
  const pitcherLast = pitcherName?.split(' ').slice(-1)[0] ?? null;
  const opp = pitcherLast ? ` vs ${pitcherLast}` : '';

  const { up, down } = topContributions(rating.categories);
  const parts: string[] = [];
  if (up) parts.push(`${up.label.toLowerCase()} leans positive`);
  if (down) parts.push(`${down.label.toLowerCase()} pulls it down`);
  if (parts.length === 0) parts.push('all scored categories near neutral');

  const tilts: string[] = [];
  if (rating.platoon.available && Math.abs(rating.platoon.deltaPct) >= 2) {
    tilts.push(`platoon ${pctSigned(rating.platoon.deltaPct)}`);
  }
  if (rating.opportunity.available && Math.abs(rating.opportunity.deltaPct) >= 2) {
    tilts.push(`order ${pctSigned(rating.opportunity.deltaPct)}`);
  }
  if (rating.weather.available && Math.abs(rating.weather.deltaPct) >= 2) {
    tilts.push(`weather ${pctSigned(rating.weather.deltaPct)}`);
  }

  const tilt = tilts.length > 0 ? ` — ${tilts.join(', ')}` : '';
  return `${firstName}${opp}: ${parts.join('; ')}${tilt}.`;
}

// ---------------------------------------------------------------------------
// Confidence — tri-state data-quality label.
// ---------------------------------------------------------------------------

function computeConfidence(
  seasonStats: PlayerStatLine | null,
  context: MatchupContext | null,
  rating: BatterRating,
): { level: 'High' | 'Medium' | 'Low'; tip: string } {
  // PlayerStatLine carries the split PA counts under `splits`; the talent
  // block exposes the effective PA driving the regressed xwOBA.
  const platoonPA = rating.platoon.available
    ? Math.max(seasonStats?.splits?.paVsL ?? 0, seasonStats?.splits?.paVsR ?? 0)
    : 0;
  const seasonPA = seasonStats?.current?.pa ?? seasonStats?.prior?.pa ?? 0;
  const effectivePA = seasonStats?.talent?.effectivePA ?? 0;

  const gates = [
    {
      pass: effectivePA >= 150 || seasonPA >= 150,
      desc: `talent sample (${seasonPA} PA)`,
    },
    {
      pass: platoonPA >= 50,
      desc: `split sample (${platoonPA} PA vs hand)`,
    },
    {
      pass: (context?.opposingPitcher?.inningsPitched ?? 0) >= 25,
      desc: `SP sample (${Math.round(context?.opposingPitcher?.inningsPitched ?? 0)} IP)`,
    },
  ];
  const hits = gates.filter(g => g.pass).length;
  const level = hits >= 3 ? 'High' : hits >= 2 ? 'Medium' : 'Low';
  const tip = gates.map(g => `${g.pass ? '✓' : '·'} ${g.desc}`).join('\n');
  return { level, tip };
}

function ConfidencePill({ level, tip }: { level: 'High' | 'Medium' | 'Low'; tip: string }) {
  const color =
    level === 'High'   ? 'text-success border-success/40 bg-success/10'
    : level === 'Medium' ? 'text-muted-foreground border-border bg-surface'
    :                     'text-error border-error/40 bg-error/10';
  return (
    <span
      title={`Prediction confidence — based on:\n${tip}`}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-micro uppercase tracking-wide font-semibold border ${color} whitespace-nowrap`}
    >
      {level} conf
    </span>
  );
}

// ---------------------------------------------------------------------------
// Hero — tier-tinted card containing score, narrative, confidence, and the
// net-vs-neutral delta as a trust footer.
// ---------------------------------------------------------------------------

function RatingHero({
  rating,
  playerName,
  context,
  seasonStats,
}: {
  rating: BatterRating;
  playerName: string;
  context: MatchupContext | null;
  seasonStats: PlayerStatLine | null;
}) {
  const palette = tierPalette(rating.tier);
  const conf = computeConfidence(seasonStats, context, rating);
  const pitcherName = context?.opposingPitcher?.name ?? null;

  const net = rating.netVsNeutral;
  const netColor =
    net > 0.5 ? 'text-success'
    : net < -0.5 ? 'text-error'
    : 'text-muted-foreground';

  return (
    <div className={`rounded-lg border ${palette.heroBorder} ${palette.heroBg} p-3`}>
      <div className="flex items-center gap-3">
        <div className={`flex flex-col items-center justify-center rounded-md px-3 py-2 ${palette.scoreBg} shrink-0`}>
          <span className={`text-3xl font-bold font-mono leading-none ${palette.scoreText}`}>
            {rating.score}
          </span>
          <span className={`text-[10px] uppercase tracking-wider font-semibold mt-1 ${palette.scoreText}`}>
            {palette.label}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Matchup rating
            </span>
            <ConfidencePill level={conf.level} tip={conf.tip} />
          </div>
          <p className="text-sm text-foreground leading-snug">
            {driverSentence(rating, playerName, pitcherName)}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border-muted/50">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          Net vs neutral (50)
        </span>
        <span className={`text-xs font-mono font-bold ${netColor}`}>
          {ptsSigned(net)} pts
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categories section — per-stat waterfall. Each row shows the category's
// focus (chase/punt/neutral), the matchup-adjusted expected rate + hint,
// and its signed contribution to the pre-multiplier composite score.
//
// "Contribution pts" is expressed on a 0-100 scale (weighted normalized
// around 0.5) so the numbers map cleanly to the score shown above:
// contribution = weight · (normalized - 0.5) · 100.
// ---------------------------------------------------------------------------

/** Max absolute contribution for the bar scale: a single chased category
 *  can hit ~±50 pts. Bar scales relative to this cap. */
const MAX_CAT_CONTRIB = 50;

function focusLabel(focus: CategoryContribution['focus'], weight: number): string {
  if (weight === 0) return 'punted';
  if (focus === 'chase') return 'chase 2×';
  return '';
}

function CategoryWaterfallRow({ cat }: { cat: CategoryContribution }) {
  const contribPts = cat.contribution * 100;
  const isPositive = contribPts > 0;
  const isPunted = cat.weight === 0;

  const barColor = isPositive ? 'bg-success' : 'bg-error';
  const pillColor = isPositive
    ? 'text-success bg-success/10'
    : contribPts < 0
      ? 'text-error bg-error/10'
      : 'text-muted-foreground bg-surface-muted';

  const widthPct = Math.min(50, (Math.abs(contribPts) / MAX_CAT_CONTRIB) * 50);
  const rowTint = isPunted ? '' : isPositive ? 'bg-success/[0.04]' : contribPts < 0 ? 'bg-error/[0.04]' : '';

  const label = cat.label;
  const focusSuffix = focusLabel(cat.focus, cat.weight);

  return (
    <div className={`grid grid-cols-[minmax(8rem,11rem)_1fr_3.25rem] gap-3 items-center px-2 py-1.5 rounded ${rowTint}`}>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground truncate">
          {label}
          {focusSuffix && (
            <span className={`ml-1.5 text-[10px] font-normal ${cat.weight === 0 ? 'text-muted-foreground/50 line-through' : 'text-success'}`}>
              ({focusSuffix})
            </span>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground truncate font-mono" title={cat.modifierHint || 'no matchup modifier'}>
          {cat.display}
        </p>
      </div>

      <div className="min-w-0">
        <div className="h-2 rounded-full bg-border-muted/40 relative overflow-hidden">
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border z-10" />
          {!isPunted && (
            <div
              className={`absolute top-0 bottom-0 ${barColor} transition-all`}
              style={{
                left: isPositive ? '50%' : `${50 - widthPct}%`,
                width: `${widthPct}%`,
              }}
            />
          )}
        </div>
        <p className="text-micro text-muted-foreground truncate mt-1">
          {isPunted
            ? 'skipped'
            : cat.modifierHint
              ? cat.modifierHint
              : `baseline ${cat.label.toLowerCase()} rate`}
        </p>
      </div>

      <div className="text-right">
        <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold ${pillColor}`}>
          {isPunted ? '—' : ptsSigned(contribPts)}
        </span>
      </div>
    </div>
  );
}

function CategoriesSection({ rating }: { rating: BatterRating }) {
  if (rating.categories.length === 0) {
    return (
      <div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
          Categories
        </p>
        <p className="text-xs text-muted-foreground italic px-2 py-1.5">
          No scored categories available yet.
        </p>
      </div>
    );
  }

  // Sort active categories by absolute contribution; punted rows last.
  const active = rating.categories.filter(c => c.weight > 0);
  const punted = rating.categories.filter(c => c.weight === 0);
  const sortedActive = [...active].sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
  );

  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
        Categories
      </p>
      <div className="space-y-1">
        {sortedActive.map(c => <CategoryWaterfallRow key={c.statId} cat={c} />)}
        {punted.length > 0 && (
          <div className="pt-1">
            <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-1 px-2">
              Punted
            </p>
            {punted.map(c => <CategoryWaterfallRow key={c.statId} cat={c} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multipliers section — platoon / PA opportunity / weather, each expressed
// as a percentage adjustment on the composite. These factors are kept
// OUTSIDE the category sum because they scale every category the same way
// (including them per-row would double-count — see the plan's Model
// diagram).
// ---------------------------------------------------------------------------

function MultiplierRow({
  label,
  mult,
}: {
  label: string;
  mult: RatingMultiplier;
}) {
  const color =
    !mult.available ? 'text-muted-foreground'
    : mult.deltaPct > 0.5 ? 'text-success'
    : mult.deltaPct < -0.5 ? 'text-error'
    : 'text-muted-foreground';
  return (
    <div className="grid grid-cols-[minmax(8rem,11rem)_1fr_3.25rem] gap-3 items-center px-2 py-1.5 rounded">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground truncate">{label}</p>
        <p className="text-[11px] text-muted-foreground truncate font-mono">{mult.display}</p>
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground truncate">{mult.summary}</p>
      </div>
      <div className="text-right">
        <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold ${color} bg-surface-muted`}>
          {mult.available ? pctSigned(mult.deltaPct) : '—'}
        </span>
      </div>
    </div>
  );
}

function MultipliersSection({ rating }: { rating: BatterRating }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
        Context <span className="normal-case text-muted-foreground/70">(multipliers)</span>
      </p>
      <div className="space-y-1">
        <MultiplierRow label="Platoon" mult={rating.platoon} />
        <MultiplierRow label="PA opportunity" mult={rating.opportunity} />
        <MultiplierRow label="Weather" mult={rating.weather} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context (not in rating) — supplementary eyeball checks kept below the
// score + waterfall so the user always has recent-form + career-BvP visible
// without letting them contaminate the rating.
// ---------------------------------------------------------------------------

function ContextCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border-muted bg-surface-muted/40 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
        {label}
      </p>
      <div className="text-xs text-foreground leading-snug">{children}</div>
    </div>
  );
}

function CareerVsPitcherBody({ split }: { split: SplitLine | null }) {
  if (!split || split.plateAppearances === 0) {
    return <span className="text-muted-foreground italic">No history</span>;
  }
  return (
    <span className="font-mono">
      {fmt(split.avg)}
      <span className="text-muted-foreground">
        {' '}· {fmtInt(split.hits)}-for-{fmtInt(split.atBats)}, {fmtInt(split.homeRuns)} HR in {fmtInt(split.plateAppearances)} PA
      </span>
    </span>
  );
}

function ContextSection({
  splits,
  context,
  careerVsPitcher,
  opposingPitcherName,
}: {
  splits: BatterSplits | null;
  context: MatchupContext | null;
  careerVsPitcher: SplitLine | null;
  opposingPitcherName: string | null;
}) {
  const form = getFormTrend(splits);
  const staff = getOpposingStaffPill(context);
  const spLast = opposingPitcherName?.split(' ').slice(-1)[0] ?? null;

  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
        Context <span className="normal-case text-muted-foreground/70">(not in rating)</span>
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <ContextCard label="Recent form">
          {form.label ? (
            <>
              <span className="font-semibold">{form.label}</span>
              {form.detail && (
                <span className="block text-[11px] text-muted-foreground font-mono mt-0.5">
                  {form.detail}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground italic">No recent sample</span>
          )}
        </ContextCard>
        <ContextCard label="Opposing staff">
          {staff
            ? <span className="font-semibold">{staff.label}</span>
            : <span className="text-muted-foreground italic">Average bullpen / defense</span>}
        </ContextCard>
        <ContextCard label={spLast ? `vs ${spLast}` : 'Vs SP'}>
          <CareerVsPitcherBody split={careerVsPitcher} />
        </ContextCard>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

interface PlayerSplitsPanelProps {
  playerName: string;
  rating: BatterRating;
  seasonStats: PlayerStatLine | null;
  splits: BatterSplits | null;
  context: MatchupContext | null;
  careerVsPitcher: SplitLine | null;
  opposingPitcherName?: string;
  isLoading: boolean;
  isError: boolean;
}

export default function PlayerSplitsPanel({
  playerName,
  rating,
  seasonStats,
  splits,
  context,
  careerVsPitcher,
  opposingPitcherName,
  isLoading,
  isError,
}: PlayerSplitsPanelProps) {
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3 p-3">
        <div className="h-20 bg-border-muted rounded-lg" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-16 bg-border-muted rounded" />
          <div className="h-16 bg-border-muted rounded" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-6 bg-border-muted rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-3">
        <p className="text-xs text-error">Failed to load splits</p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3 bg-surface-muted/30 border-t border-border-muted">
      <RatingHero
        rating={rating}
        playerName={playerName}
        context={context}
        seasonStats={seasonStats}
      />

      <CategoriesSection rating={rating} />

      <MultipliersSection rating={rating} />

      <ContextSection
        splits={splits}
        context={context}
        careerVsPitcher={careerVsPitcher}
        opposingPitcherName={opposingPitcherName ?? null}
      />
    </div>
  );
}
