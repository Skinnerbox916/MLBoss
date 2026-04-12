'use client';

import type { BatterSplits, SplitLine } from '@/lib/mlb/types';

function fmt(value: number | null, digits: number = 3): string {
  if (value === null) return '—';
  return value.toFixed(digits).replace(/^0\./, '.');
}

function fmtInt(value: number): string {
  return value.toString();
}

// ---------------------------------------------------------------------------
// Split comparison row — shows two split lines side by side with the winner highlighted
// ---------------------------------------------------------------------------

function ComparisonCell({
  split,
  label,
  isBetter,
  isWorse,
}: {
  split: SplitLine | null;
  label: string;
  isBetter: boolean;
  isWorse: boolean;
}) {
  const bgClass = isBetter ? 'bg-success/10 border-success/30' : isWorse ? 'bg-error/10 border-error/30' : 'bg-surface-muted border-border-muted';
  return (
    <div className={`flex-1 border rounded p-2 ${bgClass}`}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p>
      {split ? (
        <div className="mt-1 space-y-0.5">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-foreground">{fmt(split.avg)}</span>
            <span className="text-xs text-muted-foreground">AVG</span>
          </div>
          <div className="text-[11px] text-muted-foreground font-mono">
            {fmt(split.obp)}/{fmt(split.slg)} ({fmt(split.ops)} OPS)
          </div>
          <div className="text-[11px] text-muted-foreground">
            {fmtInt(split.homeRuns)} HR, {fmtInt(split.rbi)} RBI in {fmtInt(split.plateAppearances)} PA
          </div>
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">No data</p>
      )}
    </div>
  );
}

function pickBetter(a: SplitLine | null, b: SplitLine | null): 'a' | 'b' | null {
  if (!a || !b || a.ops === null || b.ops === null) return null;
  if (Math.abs(a.ops - b.ops) < 0.03) return null;
  return a.ops > b.ops ? 'a' : 'b';
}

function ComparisonPair({
  label,
  leftLabel,
  leftSplit,
  rightLabel,
  rightSplit,
}: {
  label: string;
  leftLabel: string;
  leftSplit: SplitLine | null;
  rightLabel: string;
  rightSplit: SplitLine | null;
}) {
  const better = pickBetter(leftSplit, rightSplit);

  return (
    <div>
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{label}</p>
      <div className="flex gap-2">
        <ComparisonCell
          split={leftSplit}
          label={leftLabel}
          isBetter={better === 'a'}
          isWorse={better === 'b'}
        />
        <ComparisonCell
          split={rightSplit}
          label={rightLabel}
          isBetter={better === 'b'}
          isWorse={better === 'a'}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent form trend (L7 / L14 / L30)
// ---------------------------------------------------------------------------

function TrendRow({ label, split }: { label: string; split: SplitLine | null }) {
  return (
    <div className="flex items-center justify-between text-xs py-1 border-b border-border-muted last:border-b-0">
      <span className="text-muted-foreground font-medium w-8">{label}</span>
      {split ? (
        <div className="flex items-center gap-3 font-mono text-foreground">
          <span className="font-bold">{fmt(split.avg)}</span>
          <span className="text-muted-foreground">
            {fmtInt(split.homeRuns)} HR / {fmtInt(split.rbi)} RBI
          </span>
          <span className="text-muted-foreground">{fmtInt(split.plateAppearances)} PA</span>
        </div>
      ) : (
        <span className="text-muted-foreground text-[11px]">No data</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Career vs opposing pitcher
// ---------------------------------------------------------------------------

function CareerVsPitcherRow({ split, pitcherName }: { split: SplitLine | null; pitcherName: string }) {
  if (!split) {
    return (
      <div className="text-[11px] text-muted-foreground italic">
        No meaningful history vs {pitcherName} (&lt; 5 PA)
      </div>
    );
  }
  return (
    <div className="bg-surface-muted border border-border-muted rounded p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
        Career vs {pitcherName}
      </p>
      <div className="flex items-baseline gap-3 text-sm">
        <span className="font-bold text-foreground">{fmt(split.avg)}</span>
        <span className="text-muted-foreground font-mono text-xs">
          {fmtInt(split.hits)}-for-{fmtInt(split.atBats)}
        </span>
        <span className="text-muted-foreground font-mono text-xs">
          {fmtInt(split.homeRuns)} HR, {fmtInt(split.rbi)} RBI
        </span>
        <span className="text-muted-foreground font-mono text-xs">
          ({fmtInt(split.plateAppearances)} PA)
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

interface PlayerSplitsPanelProps {
  splits: BatterSplits | null;
  careerVsPitcher: SplitLine | null;
  opposingPitcherName?: string;
  isLoading: boolean;
  isError: boolean;
}

export default function PlayerSplitsPanel({
  splits,
  careerVsPitcher,
  opposingPitcherName,
  isLoading,
  isError,
}: PlayerSplitsPanelProps) {
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3 p-3">
        <div className="h-4 bg-border-muted rounded w-24" />
        <div className="flex gap-2">
          <div className="flex-1 h-16 bg-border-muted rounded" />
          <div className="flex-1 h-16 bg-border-muted rounded" />
        </div>
        <div className="h-4 bg-border-muted rounded w-24" />
        <div className="h-20 bg-border-muted rounded" />
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

  if (!splits) {
    return (
      <div className="p-3">
        <p className="text-xs text-muted-foreground">No splits data available</p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3 bg-surface-muted/30 border-t border-border-muted">
      <ComparisonPair
        label="Pitcher Handedness"
        leftLabel="vs LHP"
        leftSplit={splits.vsLeft}
        rightLabel="vs RHP"
        rightSplit={splits.vsRight}
      />
      <ComparisonPair
        label="Day / Night"
        leftLabel="Day"
        leftSplit={splits.day}
        rightLabel="Night"
        rightSplit={splits.night}
      />

      {/* Recent form */}
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
          Recent Form
        </p>
        <div className="bg-surface-muted border border-border-muted rounded px-3">
          <TrendRow label="L7" split={splits.last7} />
          <TrendRow label="L14" split={splits.last14} />
          <TrendRow label="L30" split={splits.last30} />
        </div>
      </div>

      {/* Career vs today's pitcher */}
      {opposingPitcherName && (
        <div>
          <CareerVsPitcherRow split={careerVsPitcher} pitcherName={opposingPitcherName} />
        </div>
      )}
    </div>
  );
}
