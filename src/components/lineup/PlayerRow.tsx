'use client';

import { useState } from 'react';
import { FiChevronDown, FiTrendingUp, FiTrendingDown } from 'react-icons/fi';
import { GiRunningShoe } from 'react-icons/gi';
import Icon from '@/components/Icon';
import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import type { BatterSeasonStats } from '@/lib/mlb/types';
import type { MatchupContext } from '@/lib/mlb/analysis';
import {
  getHandednessVerdict,
  getFormTrend,
  getWeatherFlag,
  getPitcherQualityPill,
  getParkVerdict,
  getStealPill,
  getCareerVsPitcherPill,
  getOpposingStaffPill,
  getPitcherKRatePill,
  getBatterMatchupScore,
  type BatterMatchupScore,
} from '@/lib/mlb/analysis';
import { usePlayerSplits } from '@/lib/hooks/usePlayerSplits';
import PlayerSplitsPanel from './PlayerSplitsPanel';

import { getRowStatus } from './types';

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const isIL = status.includes('IL') || status === 'DL' || status === 'NA';
  const color = isIL ? 'bg-error/15 text-error' : 'bg-accent/15 text-accent';
  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${color}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Verdict pills
// ---------------------------------------------------------------------------

function VerdictPill({
  verdict,
  label,
}: {
  verdict: 'strong' | 'neutral' | 'weak' | 'unknown';
  label: string;
}) {
  if (!label) return null;
  const bgClass =
    verdict === 'strong' ? 'bg-success/15 text-success' :
    verdict === 'weak' ? 'bg-error/15 text-error' :
    'bg-surface-muted text-muted-foreground';
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${bgClass}`}>
      {label}
    </span>
  );
}

function FormPill({
  trend,
  label,
}: {
  trend: 'hot' | 'cold' | 'neutral' | 'unknown';
  label: string;
}) {
  if (!label) return null;
  if (trend === 'hot') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-success/15 text-success">
        <Icon icon={FiTrendingUp} size={10} />
        {label}
      </span>
    );
  }
  if (trend === 'cold') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-error/15 text-error">
        <Icon icon={FiTrendingDown} size={10} />
        {label}
      </span>
    );
  }
  return null;
}

function StealPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent/15 text-accent">
      <Icon icon={GiRunningShoe} size={10} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Baseline OPS / xwOBA display — the most important numbers on the row
// ---------------------------------------------------------------------------

/**
 * Shows season OPS with colour coding for talent level.
 * When xwOBA is available and diverges significantly from actual wOBA,
 * shows a small luck indicator:
 *   ↑ player is getting unlucky (xwOBA >> wOBA) — likely to improve
 *   ↓ player is getting lucky  (xwOBA << wOBA) — likely to regress
 */
function OPSBadge({ stats }: { stats: BatterSeasonStats | null }) {
  if (!stats || stats.ops === null) return null;

  const ops = stats.ops;
  const display = ops.toFixed(3).replace(/^0\./, '.');

  let color = 'text-muted-foreground';
  if (ops >= 0.900) color = 'text-success font-bold';
  else if (ops >= 0.800) color = 'text-success';
  else if (ops >= 0.720) color = 'text-foreground';
  else if (ops < 0.650) color = 'text-error';

  // Luck indicator: wOBA delta ≥ 0.030 is meaningful (roughly 10 OPS points)
  let luckIndicator: React.ReactNode = null;
  if (stats.xwoba !== null && stats.woba !== null) {
    const delta = stats.xwoba - stats.woba;
    if (delta >= 0.030) {
      luckIndicator = (
        <span className="text-success text-[10px]" title={`xwOBA ${stats.xwoba.toFixed(3)} vs wOBA ${stats.woba.toFixed(3)} — getting unlucky`}>
          ↑
        </span>
      );
    } else if (delta <= -0.030) {
      luckIndicator = (
        <span className="text-error text-[10px]" title={`xwOBA ${stats.xwoba.toFixed(3)} vs wOBA ${stats.woba.toFixed(3)} — getting lucky`}>
          ↓
        </span>
      );
    }
  }

  return (
    <span className="inline-flex items-center gap-0.5" title="Season OPS">
      <span className={`text-xs font-mono ${color}`}>{display}</span>
      {luckIndicator}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Matchup score indicator — left-edge accent + tier label
// ---------------------------------------------------------------------------

function matchupTierStyle(tier: BatterMatchupScore['tier']): {
  border: string;
  bg: string;
  label: string;
  labelColor: string;
} {
  switch (tier) {
    case 'great':
      return { border: 'border-l-success', bg: 'bg-success/5', label: 'Great', labelColor: 'text-success' };
    case 'good':
      return { border: 'border-l-success/50', bg: 'bg-success/[0.02]', label: 'Good', labelColor: 'text-success' };
    case 'neutral':
      return { border: 'border-l-border', bg: '', label: '', labelColor: '' };
    case 'poor':
      return { border: 'border-l-error/50', bg: 'bg-error/[0.02]', label: 'Poor', labelColor: 'text-error' };
    case 'bad':
      return { border: 'border-l-error', bg: 'bg-error/5', label: 'Bad', labelColor: 'text-error' };
  }
}

// ---------------------------------------------------------------------------
// Matchup context line — appears below player info
// ---------------------------------------------------------------------------

function MatchupLine({ context }: { context: MatchupContext | null }) {
  if (!context) {
    return (
      <span className="text-[11px] text-muted-foreground italic">No game today</span>
    );
  }

  const { game, isHome, opposingPitcher, park } = context;
  const opponentTeam = isHome ? game.awayTeam.abbreviation : game.homeTeam.abbreviation;
  const locationPrefix = isHome ? 'vs' : '@';
  const weather = getWeatherFlag(game, park);

  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px]">
      <span className="text-muted-foreground">
        {locationPrefix} <span className="font-semibold text-foreground">{opponentTeam}</span>
      </span>

      {opposingPitcher ? (
        <>
          <span className="text-border">|</span>
          <span className="text-muted-foreground">
            {opposingPitcher.name}
            <span
              className={`ml-1 font-bold ${
                opposingPitcher.throws === 'L' ? 'text-accent' : 'text-primary'
              }`}
            >
              ({opposingPitcher.throws}HP)
            </span>
            {opposingPitcher.era !== null && (
              <span className="text-muted-foreground ml-1">{opposingPitcher.era.toFixed(2)} ERA</span>
            )}
          </span>
        </>
      ) : (
        <>
          <span className="text-border">|</span>
          <span className="text-muted-foreground italic">TBD SP</span>
        </>
      )}

      {weather.kind !== 'none' && weather.kind !== 'neutral' && (
        <>
          <span className="text-border">|</span>
          <span
            className={
              weather.kind === 'boost' ? 'text-success' : 'text-error'
            }
          >
            {weather.label}
          </span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player row (main)
// ---------------------------------------------------------------------------

interface PlayerRowProps {
  player: RosterEntry;
  context: MatchupContext | null;
  seasonStats: BatterSeasonStats | null;
}

export default function PlayerRow({ player, context, seasonStats }: PlayerRowProps) {
  const [expanded, setExpanded] = useState(false);
  const status = getRowStatus(player);

  const shouldFetchSplits = status !== 'injured' && !!context?.game;

  const { identity, splits, careerVsPitcher, isLoading: splitsLoading, isError: splitsError } = usePlayerSplits(
    shouldFetchSplits ? player.name : undefined,
    shouldFetchSplits ? player.editorial_team_abbr : undefined,
    {
      pitcherId: context?.opposingPitcher?.mlbId,
    },
  );

  // Individual verdict pills
  const handednessVerdict = getHandednessVerdict(splits, context?.opposingPitcher?.throws);
  const formTrend = getFormTrend(splits);
  const pitcherPill = getPitcherQualityPill(context?.opposingPitcher);
  const parkPill = getParkVerdict(context?.park, identity?.bats);
  const stealPill = getStealPill(splits);
  const cvpPill = getCareerVsPitcherPill(careerVsPitcher, context?.opposingPitcher?.name);
  const staffPill = getOpposingStaffPill(context);
  const kRatePill = getPitcherKRatePill(context?.opposingPitcher);

  // OPS fallback for talent baseline (used when xwOBA is unavailable)
  const talentOPS = seasonStats?.ops ?? null;

  // Composite score — blends talent baseline with matchup context
  // Pass full seasonStats so the score function can use xwOBA directly
  // and compute the luck regression (xwOBA − wOBA delta).
  const matchupScore = getBatterMatchupScore(splits, careerVsPitcher, context, identity?.bats, talentOPS, seasonStats, player.batting_order);
  const tierStyle = matchupTierStyle(matchupScore.tier);

  const hasAnyPill =
    handednessVerdict.label ||
    parkPill ||
    pitcherPill ||
    kRatePill ||
    staffPill ||
    stealPill ||
    cvpPill ||
    formTrend.label;

  const initial = player.name.charAt(0).toUpperCase();

  return (
    <div className={`rounded-lg overflow-hidden border-l-[3px] ${tierStyle.border} ${tierStyle.bg} hover:bg-surface-muted/40 transition-colors`}>
      {/* Compact row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-3 px-3 py-2 text-left"
      >
        {/* Avatar */}
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
          {initial}
        </div>

        {/* Player info + matchup context */}
        <div className="flex-1 min-w-0 space-y-0.5">
          {/* Line 1: Name + OPS + status + team + position eligibility + matchup tier */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate">{player.name}</span>
            {player.batting_order && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-primary/15 text-primary" title="Batting order">
                #{player.batting_order}
              </span>
            )}
            {player.starting_status === 'NS' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-error/15 text-error">
                SITTING
              </span>
            )}
            <OPSBadge stats={seasonStats} />
            {player.status && <StatusBadge status={player.status} />}
            {tierStyle.label && (
              <span className={`text-[10px] font-bold ${tierStyle.labelColor}`}>
                {tierStyle.label}
              </span>
            )}
            <span className="text-[11px] text-muted-foreground">
              {player.editorial_team_abbr} · {player.eligible_positions.join(', ')}
            </span>
          </div>

          {/* Line 2: Matchup context */}
          <MatchupLine context={context} />

          {/* Line 3: Verdict pills */}
          {shouldFetchSplits && hasAnyPill && (
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              {cvpPill && (
                <VerdictPill verdict={cvpPill.verdict} label={cvpPill.label} />
              )}
              {pitcherPill && (
                <VerdictPill verdict={pitcherPill.verdict} label={pitcherPill.label} />
              )}
              {kRatePill && (
                <VerdictPill verdict={kRatePill.verdict} label={kRatePill.label} />
              )}
              {handednessVerdict.label && (
                <VerdictPill verdict={handednessVerdict.verdict} label={handednessVerdict.label} />
              )}
              {staffPill && (
                <VerdictPill verdict={staffPill.verdict} label={staffPill.label} />
              )}
              {parkPill && (
                <VerdictPill verdict={parkPill.verdict} label={parkPill.label} />
              )}
              {stealPill && <StealPill label={stealPill.label} />}
              {formTrend.label && <FormPill trend={formTrend.trend} label={formTrend.label} />}
            </div>
          )}
        </div>

        {/* Right side: current slot + chevron */}
        <div className="shrink-0 flex items-center gap-2 mt-0.5">
          <span
            className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
              status === 'starter' ? 'bg-success/15 text-success' :
              status === 'injured' ? 'bg-error/15 text-error' :
              'bg-surface-muted text-muted-foreground'
            }`}
          >
            {player.selected_position}
          </span>
          <Icon
            icon={FiChevronDown}
            size={16}
            className={`text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Expanded splits panel */}
      {expanded && (
        shouldFetchSplits ? (
          <PlayerSplitsPanel
            matchupScore={matchupScore}
            careerVsPitcher={careerVsPitcher}
            opposingPitcherName={context?.opposingPitcher?.name}
            isLoading={splitsLoading}
            isError={splitsError}
          />
        ) : (
          <div className="p-3 bg-surface-muted/30 border-t border-border-muted">
            <p className="text-xs text-muted-foreground">
              {status === 'injured'
                ? 'Player is on IL — splits not shown'
                : 'No game scheduled today — splits unavailable'}
            </p>
          </div>
        )
      )}
    </div>
  );
}
