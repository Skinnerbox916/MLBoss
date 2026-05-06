'use client';

import { useState } from 'react';
import { FiChevronDown } from 'react-icons/fi';
import Icon from '@/components/Icon';
import Badge from '@/components/ui/Badge';
import type { RosterEntry } from '@/lib/yahoo-fantasy-api';
import type { PlayerStatLine } from '@/lib/mlb/types';
import type { MatchupContext } from '@/lib/mlb/analysis';
import { getWeatherFlag } from '@/lib/mlb/analysis';
import { getBatterRating, type BatterRating, type Focus } from '@/lib/mlb/batterRating';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import { usePlayerSplits } from '@/lib/hooks/usePlayerSplits';
import PlayerSplitsPanel from './PlayerSplitsPanel';
import { Text } from '@/components/typography';

import { getRowStatus } from './types';

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const isIL = status.includes('IL') || status === 'DL' || status === 'NA';
  return <Badge color={isIL ? 'error' : 'accent'}>{status}</Badge>;
}

// ---------------------------------------------------------------------------
// Baseline OPS / xwOBA display — the most important numbers on the row
// ---------------------------------------------------------------------------

/**
 * Shows season OPS with colour coding for talent level.
 * When the talent xwOBA diverges significantly from actual wOBA, shows a
 * small luck indicator:
 *   ↑ player is getting unlucky (xwOBA >> wOBA) — likely to improve
 *   ↓ player is getting lucky  (xwOBA << wOBA) — likely to regress
 */
function OPSBadge({ stats }: { stats: PlayerStatLine | null }) {
  // Prefer current-season counting; fall back to prior so IL'd players
  // and pre-debut promotions still get a rating instead of an empty slot.
  const counting = stats?.current ?? stats?.prior ?? null;
  if (!counting || counting.ops === null) return null;

  const ops = counting.ops;
  const display = ops.toFixed(3).replace(/^0\./, '.');

  let color = 'text-muted-foreground';
  if (ops >= 0.900) color = 'text-success font-bold';
  else if (ops >= 0.800) color = 'text-success';
  else if (ops >= 0.720) color = 'text-foreground';
  else if (ops < 0.650) color = 'text-error';

  // Luck arrow uses regressed talent xwOBA vs blended actual wOBA — the
  // "talent vs production" gap, not raw current-year only.
  let luckIndicator: React.ReactNode = null;
  const talentXwoba = stats?.talent?.xwoba ?? null;
  const actualWoba = stats?.talent?.woba ?? null;
  if (talentXwoba !== null && actualWoba !== null) {
    const delta = talentXwoba - actualWoba;
    if (delta >= 0.030) {
      luckIndicator = (
        <span className="text-success text-caption" title={`xwOBA ${talentXwoba.toFixed(3)} vs wOBA ${actualWoba.toFixed(3)} — getting unlucky`}>
          ↑
        </span>
      );
    } else if (delta <= -0.030) {
      luckIndicator = (
        <span className="text-error text-caption" title={`xwOBA ${talentXwoba.toFixed(3)} vs wOBA ${actualWoba.toFixed(3)} — getting lucky`}>
          ↓
        </span>
      );
    }
  }

  return (
    <span className="inline-flex items-baseline gap-0.5" title="Season OPS">
      <span className={`text-xs font-mono ${color}`}>{display}</span>
      <span className="text-[9px] text-muted-foreground uppercase tracking-wide font-semibold">OPS</span>
      {luckIndicator}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Matchup score indicator — left-edge accent + row tint only. The tier
// text label ("Great" / "Good" / etc.) is omitted here to avoid triple-
// counting with the border color and the row background tint; the
// precise number surfaces inside the expanded card.
// ---------------------------------------------------------------------------

function matchupTierStyle(tier: BatterRating['tier']): {
  border: string;
  bg: string;
} {
  switch (tier) {
    case 'great':   return { border: 'border-l-success',      bg: 'bg-success/5' };
    case 'good':    return { border: 'border-l-success/50',   bg: 'bg-success/5' };
    case 'neutral': return { border: 'border-l-border',       bg: '' };
    case 'poor':    return { border: 'border-l-error/50',     bg: 'bg-error/5' };
    case 'bad':     return { border: 'border-l-error',        bg: 'bg-error/5' };
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

  const { game, isHome, opposingPitcher } = context;
  const park = game.park;
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
  seasonStats: PlayerStatLine | null;
  /** Batter-side scored categories (drives which rows appear in the waterfall). */
  scoredBatterCategories: EnrichedLeagueStatCategory[];
  /** Per-category chase/punt focus for this page (independent from roster page). */
  focusMap: Record<number, Focus>;
}

export default function PlayerRow({
  player,
  context,
  seasonStats,
  scoredBatterCategories,
  focusMap,
}: PlayerRowProps) {
  const [expanded, setExpanded] = useState(false);
  const status = getRowStatus(player);

  const shouldFetchSplits = status !== 'injured' && !!context?.game;

  const { splits, careerVsPitcher, isLoading: splitsLoading, isError: splitsError } = usePlayerSplits(
    shouldFetchSplits ? player.name : undefined,
    shouldFetchSplits ? player.editorial_team_abbr : undefined,
    {
      pitcherId: context?.opposingPitcher?.mlbId,
    },
  );

  // Category-weighted rating — driven by the scored categories in the
  // user's league and their chase/punt focus choices. Per-category
  // contributions and matchup multipliers feed the expanded card.
  const rating = getBatterRating({
    context,
    stats: seasonStats,
    scoredCategories: scoredBatterCategories,
    focusMap,
    battingOrder: player.batting_order,
  });
  const tierStyle = matchupTierStyle(rating.tier);

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
          {/* Line 1: Name + OPS + status + team + position eligibility */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate">{player.name}</span>
            {player.batting_order && (
              <Badge color="primary" className="font-bold" title="Batting order">
                #{player.batting_order}
              </Badge>
            )}
            {player.starting_status === 'NS' && (
              <Badge color="error" className="font-bold">SITTING</Badge>
            )}
            <OPSBadge stats={seasonStats} />
            {player.status && <StatusBadge status={player.status} />}
            <span className="text-[11px] text-muted-foreground">
              {player.editorial_team_abbr} · {player.eligible_positions.join(', ')}
            </span>
          </div>

          {/* Line 2: Matchup context */}
          <MatchupLine context={context} />
        </div>

        {/* Right side: current slot + chevron */}
        <div className="shrink-0 flex items-center gap-2 mt-0.5">
          <Badge
            color={status === 'starter' ? 'success' : status === 'injured' ? 'error' : 'muted'}
            className="px-2 text-xs"
          >
            {player.selected_position}
          </Badge>
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
            playerName={player.name}
            rating={rating}
            seasonStats={seasonStats}
            splits={splits}
            context={context}
            careerVsPitcher={careerVsPitcher}
            opposingPitcherName={context?.opposingPitcher?.name}
            isLoading={splitsLoading}
            isError={splitsError}
          />
        ) : (
          <div className="p-3 bg-surface-muted/30 border-t border-border-muted">
            <Text variant="caption">
              {status === 'injured'
                ? 'Player is on IL — splits not shown'
                : 'No game scheduled today — splits unavailable'}
            </Text>
          </div>
        )
      )}
    </div>
  );
}
