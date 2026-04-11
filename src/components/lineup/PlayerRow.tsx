'use client';

import { useState } from 'react';
import { FiChevronDown, FiTrendingUp, FiTrendingDown } from 'react-icons/fi';
import Icon from '@/components/Icon';
import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import type { MatchupContext } from '@/lib/mlb/analysis';
import { getHandednessVerdict, getVenueVerdict, getDayNightVerdict, getFormTrend, getWeatherFlag, getPitcherQualityPill } from '@/lib/mlb/analysis';
import { usePlayerSplits } from '@/lib/hooks/usePlayerSplits';
import PlayerSplitsPanel from './PlayerSplitsPanel';

// ---------------------------------------------------------------------------
// Row status helpers
// ---------------------------------------------------------------------------

type RowStatus = 'starter' | 'bench' | 'injured';

function getRowStatus(player: RosterEntry): RowStatus {
  if (player.on_disabled_list || player.status === 'IL' || player.status === 'IL10' || player.status === 'IL60' || player.status === 'DL' || player.status === 'NA') {
    return 'injured';
  }
  if (player.selected_position === 'BN') return 'bench';
  if (player.selected_position === 'IL' || player.selected_position === 'IL+' || player.selected_position === 'NA') return 'injured';
  return 'starter';
}

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
      {/* Opponent + pitcher */}
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

      {/* Weather */}
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
}

export default function PlayerRow({ player, context }: PlayerRowProps) {
  const [expanded, setExpanded] = useState(false);
  const status = getRowStatus(player);

  // Fetch splits for any healthy player with a game today (starters and bench).
  // Injured players are excluded — splits won't inform a realistic lineup move.
  const shouldFetchSplits = status !== 'injured' && !!context?.game;

  const { splits, careerVsPitcher, isLoading: splitsLoading, isError: splitsError } = usePlayerSplits(
    shouldFetchSplits ? player.name : undefined,
    shouldFetchSplits ? player.editorial_team_abbr : undefined,
    {
      pitcherId: context?.opposingPitcher?.mlbId,
    },
  );

  // Compute inline verdicts + form trend (only meaningful when splits are available)
  const handednessVerdict = getHandednessVerdict(splits, context?.opposingPitcher?.throws);
  const venueVerdict = context ? getVenueVerdict(splits, context.isHome) : { verdict: 'unknown' as const, label: '' };
  const dayNightVerdict = context?.game
    ? getDayNightVerdict(splits, context.game.gameDate)
    : { verdict: 'unknown' as const, label: '' };
  const formTrend = getFormTrend(splits);

  // Pitcher quality pill — independent of splits data (lives on the probable pitcher)
  const pitcherPill = getPitcherQualityPill(context?.opposingPitcher);

  // Park pill: only surface non-neutral parks. Extreme parks get a stronger label.
  const parkPill = ((): { verdict: 'strong' | 'weak'; label: string } | null => {
    const tendency = context?.park?.tendency;
    if (!tendency || tendency === 'neutral') return null;
    if (tendency === 'extreme-hitter') return { verdict: 'strong', label: 'Extreme hitter park' };
    if (tendency === 'hitter') return { verdict: 'strong', label: 'Hitter park' };
    if (tendency === 'extreme-pitcher') return { verdict: 'weak', label: 'Extreme pitcher park' };
    return { verdict: 'weak', label: 'Pitcher park' };
  })();

  const hasAnyPill =
    handednessVerdict.label ||
    venueVerdict.label ||
    dayNightVerdict.label ||
    parkPill ||
    pitcherPill ||
    formTrend.label;

  const bgClass =
    status === 'starter' ? 'bg-success/5' :
    status === 'injured' ? 'bg-error/5' :
    '';
  const initial = player.name.charAt(0).toUpperCase();

  return (
    <div className={`rounded-lg overflow-hidden ${bgClass} hover:bg-surface-muted/40 transition-colors`}>
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
          {/* Line 1: Name + status + team + position eligibility */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate">{player.name}</span>
            {player.status && <StatusBadge status={player.status} />}
            <span className="text-[11px] text-muted-foreground">
              {player.editorial_team_abbr} · {player.eligible_positions.join(', ')}
            </span>
          </div>

          {/* Line 2: Matchup context */}
          <MatchupLine context={context} />

          {/* Line 3: Verdict pills (only when we have splits data and meaningful signals) */}
          {shouldFetchSplits && hasAnyPill && (
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              {pitcherPill && (
                <VerdictPill verdict={pitcherPill.verdict} label={pitcherPill.label} />
              )}
              {handednessVerdict.label && (
                <VerdictPill verdict={handednessVerdict.verdict} label={handednessVerdict.label} />
              )}
              {venueVerdict.label && (
                <VerdictPill verdict={venueVerdict.verdict} label={venueVerdict.label} />
              )}
              {dayNightVerdict.label && (
                <VerdictPill verdict={dayNightVerdict.verdict} label={dayNightVerdict.label} />
              )}
              {parkPill && (
                <VerdictPill verdict={parkPill.verdict} label={parkPill.label} />
              )}
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
            splits={splits}
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
