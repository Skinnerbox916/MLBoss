'use client';

import type { SplitLine } from '@/lib/mlb/types';
import type { BatterMatchupScore, BatterMatchupFactor } from '@/lib/mlb/analysis';

function fmt(value: number | null, digits: number = 3): string {
  if (value === null) return '—';
  return value.toFixed(digits).replace(/^0\./, '.');
}

function fmtInt(value: number): string {
  return value.toString();
}

// ---------------------------------------------------------------------------
// Overall score header
// ---------------------------------------------------------------------------

function tierStyle(tier: BatterMatchupScore['tier']): { label: string; text: string; bg: string } {
  switch (tier) {
    case 'great':   return { label: 'Great',   text: 'text-success',           bg: 'bg-success/15' };
    case 'good':    return { label: 'Good',    text: 'text-success',           bg: 'bg-success/10' };
    case 'neutral': return { label: 'Neutral', text: 'text-muted-foreground',  bg: 'bg-surface-muted' };
    case 'poor':    return { label: 'Poor',    text: 'text-error',             bg: 'bg-error/10' };
    case 'bad':     return { label: 'Bad',     text: 'text-error',             bg: 'bg-error/15' };
  }
}

function driverSentence(factors: BatterMatchupFactor[]): string {
  // Pick the factor with the largest |normalized − 0.5| × weight on each side.
  let topUp: { f: BatterMatchupFactor; contrib: number } | null = null;
  let topDown: { f: BatterMatchupFactor; contrib: number } | null = null;
  for (const f of factors) {
    if (!f.available) continue;
    const contrib = (f.normalized - 0.5) * f.weight;
    if (contrib > 0 && (!topUp || contrib > topUp.contrib)) topUp = { f, contrib };
    if (contrib < 0 && (!topDown || contrib < topDown.contrib)) topDown = { f, contrib };
  }
  const parts: string[] = [];
  if (topUp) parts.push(`${topUp.f.summary.toLowerCase()} drives this up`);
  if (topDown) parts.push(`${topDown.f.summary.toLowerCase()} pulls it down`);
  if (parts.length === 0) return 'All factors close to neutral.';
  return parts.join('; ') + '.';
}

function RatingHeader({ score }: { score: BatterMatchupScore }) {
  const style = tierStyle(score.tier);
  return (
    <div className="flex items-start gap-3 pb-2 border-b border-border-muted">
      <div className={`flex flex-col items-center justify-center rounded-lg px-3 py-1.5 ${style.bg}`}>
        <span className={`text-lg font-bold font-mono ${style.text}`}>
          {(score.score * 100).toFixed(0)}
        </span>
        <span className={`text-[10px] uppercase tracking-wide font-semibold ${style.text}`}>
          {style.label}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
          Matchup rating
        </p>
        <p className="text-xs text-foreground/80 mt-0.5 leading-snug">
          {driverSentence(score.factors)}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Factor row — one per contributor to the composite score
// ---------------------------------------------------------------------------

function favorabilityColor(normalized: number, available: boolean): { fill: string; track: string; text: string } {
  if (!available) {
    return { fill: 'bg-border', track: 'bg-border-muted/30', text: 'text-muted-foreground' };
  }
  if (normalized >= 0.70) return { fill: 'bg-success',     track: 'bg-success/10',      text: 'text-success' };
  if (normalized >= 0.55) return { fill: 'bg-success/70',  track: 'bg-success/10',      text: 'text-success' };
  if (normalized <= 0.30) return { fill: 'bg-error',       track: 'bg-error/10',        text: 'text-error' };
  if (normalized <= 0.45) return { fill: 'bg-error/70',    track: 'bg-error/10',        text: 'text-error' };
  return { fill: 'bg-muted-foreground/60', track: 'bg-surface-muted', text: 'text-muted-foreground' };
}

function FactorRow({ factor }: { factor: BatterMatchupFactor }) {
  const c = favorabilityColor(factor.normalized, factor.available);
  const pct = Math.max(2, factor.normalized * 100);
  const weightPct = Math.round(factor.weight * 100);
  return (
    <div className="grid grid-cols-[7rem_1fr_2.5rem] gap-2 items-center py-1">
      {/* Label */}
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-foreground truncate">{factor.label}</p>
        <p className={`text-[10px] ${c.text} truncate`} title={factor.summary}>
          {factor.summary}
        </p>
      </div>

      {/* Bar + value */}
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <span className="text-[11px] font-mono text-foreground truncate">
            {factor.display}
          </span>
          {/* Neutral baseline tick */}
          <span className="text-[9px] text-muted-foreground/60 font-mono">
            {Math.round(factor.normalized * 100)}
          </span>
        </div>
        <div className={`h-1.5 rounded-full relative overflow-hidden ${c.track}`}>
          <div
            className={`h-full ${c.fill} rounded-full transition-all`}
            style={{ width: `${pct}%` }}
          />
          {/* 50% baseline indicator */}
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border" />
        </div>
      </div>

      {/* Weight badge */}
      <div className="text-right">
        <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-surface-muted text-muted-foreground">
          {weightPct}%
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Career vs opposing pitcher — kept from old panel since it IS predictive
// ---------------------------------------------------------------------------

function CareerVsPitcherBlock({ split, pitcherName }: { split: SplitLine | null; pitcherName: string }) {
  if (!split || split.plateAppearances === 0) {
    return (
      <div className="text-[11px] text-muted-foreground italic">
        No history vs {pitcherName}
      </div>
    );
  }
  return (
    <div className="bg-surface-muted border border-border-muted rounded p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
        Career vs {pitcherName}
      </p>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-bold text-foreground">{fmt(split.avg)}</span>
        <span className="text-muted-foreground font-mono text-xs">
          {fmt(split.obp)}/{fmt(split.slg)}
        </span>
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
  matchupScore: BatterMatchupScore | null;
  careerVsPitcher: SplitLine | null;
  opposingPitcherName?: string;
  isLoading: boolean;
  isError: boolean;
}

export default function PlayerSplitsPanel({
  matchupScore,
  careerVsPitcher,
  opposingPitcherName,
  isLoading,
  isError,
}: PlayerSplitsPanelProps) {
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3 p-3">
        <div className="h-10 bg-border-muted rounded" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
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

  if (!matchupScore || matchupScore.factors.length === 0) {
    return (
      <div className="p-3">
        <p className="text-xs text-muted-foreground">No matchup data available</p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3 bg-surface-muted/30 border-t border-border-muted">
      <RatingHeader score={matchupScore} />

      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
          Rating breakdown
        </p>
        <div className="divide-y divide-border-muted/60">
          {matchupScore.factors.map(f => (
            <FactorRow key={f.key} factor={f} />
          ))}
        </div>
      </div>

      {opposingPitcherName && (
        <div>
          <CareerVsPitcherBlock split={careerVsPitcher} pitcherName={opposingPitcherName} />
        </div>
      )}
    </div>
  );
}
