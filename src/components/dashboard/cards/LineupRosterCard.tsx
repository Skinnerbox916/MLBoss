'use client';

import { FiAlertTriangle } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';
import { useFantasy } from '../FantasyProvider';
import { useRoster } from '@/lib/hooks/useRoster';
import { useGameDay } from '@/lib/hooks/useGameDay';
import { isPitcher } from '@/components/lineup/types';
import type { RosterEntry } from '@/lib/yahoo-fantasy-api';

/**
 * Today's roster status in one card: what to FIX (lineup issues) over what to
 * WATCH (health inventory).
 *
 * Replaces the split `LineupIssuesCard` + `PlayerUpdatesCard`, which read the
 * same `useRoster` fetch and put the same player on the dashboard twice — a
 * DTD arm in the active lineup appeared as an issue in one card and a flag in
 * the other, side by side. Ordering carries the meaning: the actionable block
 * is first, the inventory second (see docs/history.md).
 */

interface LineupIssue {
  type: 'injured_active' | 'il_eligible_on_bench' | 'open_slot' | 'no_game_active';
  label: string;
  detail: string;
  severity: 'error' | 'warning';
}

const IL_STATUSES = new Set(['IL', 'IL10', 'IL15', 'IL60', 'DL', 'DL10', 'DL60', 'NA', 'SUSP']);
const IL_SLOTS = new Set(['IL', 'IL+', 'NA']);
const BENCH_OR_INACTIVE = new Set(['BN', 'IL', 'IL+', 'NA']);

type StatusTier = 'dtd' | 'il' | 'na';

function getStatusTier(player: RosterEntry): StatusTier | null {
  const s = player.status;
  if (!s) return null;
  if (s === 'DTD') return 'dtd';
  if (s === 'NA' || s === 'SUSP') return 'na';
  return 'il'; // IL, IL10, IL15, IL60, DL, etc.
}

const tierConfig: Record<StatusTier, { label: string; bg: string; text: string; border: string; order: number }> = {
  dtd:  { label: 'DTD',  bg: 'bg-accent/10',   text: 'text-accent-900',   border: 'border-accent',          order: 0 },
  il:   { label: 'IL',   bg: 'bg-error/10',    text: 'text-error-900',    border: 'border-error',           order: 1 },
  na:   { label: 'OUT',  bg: 'bg-primary/10',  text: 'text-primary-900',  border: 'border-muted-foreground', order: 2 },
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function LineupRosterCard() {
  const { teamKey } = useFantasy();
  const { roster, isLoading: rosterLoading } = useRoster(teamKey);
  const { games, isLoading: gamesLoading } = useGameDay(todayStr());

  const isLoading = rosterLoading || gamesLoading;

  // Build set of team abbreviations with a game today
  const teamsPlaying = new Set<string>();
  for (const game of games) {
    teamsPlaying.add(game.homeTeam.abbreviation.toUpperCase());
    teamsPlaying.add(game.awayTeam.abbreviation.toUpperCase());
  }

  const issues: LineupIssue[] = [];

  // Bench batters with a game today (potential upgrades)
  const benchWithGame = roster.filter(p =>
    p.selected_position === 'BN' &&
    !isPitcher(p) &&
    !p.status &&
    teamsPlaying.has(p.editorial_team_abbr.toUpperCase()),
  );

  for (const player of roster) {
    const pos = player.selected_position;

    // Injured player starting in an active (non-bench, non-IL) slot
    if (player.status && !BENCH_OR_INACTIVE.has(pos)) {
      issues.push({
        type: 'injured_active',
        label: 'Injured Player Starting',
        detail: `${player.name} (${player.status}) is in your active lineup`,
        severity: 'error',
      });
      continue;
    }

    // IL-eligible player sitting on bench instead of an IL slot
    // Only flag if they actually have an IL slot they can move to
    if (
      IL_STATUSES.has(player.status ?? '') &&
      pos === 'BN' &&
      player.eligible_positions.some(p => IL_SLOTS.has(p))
    ) {
      issues.push({
        type: 'il_eligible_on_bench',
        label: 'Move to IL Slot',
        detail: `${player.name} (${player.status}) is on bench — free up a roster spot`,
        severity: 'warning',
      });
      continue;
    }

    // Batter in an active slot with no game today while a bench player with a
    // game is eligible for the same slot
    if (
      !isPitcher(player) &&
      !BENCH_OR_INACTIVE.has(pos) &&
      games.length > 0 &&
      !teamsPlaying.has(player.editorial_team_abbr.toUpperCase())
    ) {
      const isUtil = pos.toUpperCase() === 'UTIL';
      const upgrade = benchWithGame.find(bp =>
        isUtil
          ? bp.eligible_positions.includes('Util') || bp.eligible_positions.includes('UTIL')
          : bp.eligible_positions.includes(pos),
      );
      if (upgrade) {
        issues.push({
          type: 'no_game_active',
          label: 'Dead Slot',
          detail: `${player.name} has no game in your ${pos} spot — ${upgrade.name} (${upgrade.editorial_team_abbr}) is on the bench with a game`,
          severity: 'warning',
        });
      }
    }
  }

  const playersWithStatus = roster
    .filter(p => getStatusTier(p) !== null)
    .sort((a, b) => (tierConfig[getStatusTier(a)!]?.order ?? 99) - (tierConfig[getStatusTier(b)!]?.order ?? 99));

  const healthy = roster.length - playersWithStatus.length;

  return (
    <DashboardCard
      title="Lineup & Roster"
      icon={FiAlertTriangle}
      size="md"
      isLoading={isLoading}
    >
      <div className="space-y-3">
        {roster.length > 0 && (
          <div className="flex items-center gap-2">
            {issues.length > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-error-100 text-error-900">
                {issues.length} {issues.length === 1 ? 'Issue' : 'Issues'}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {healthy} of {roster.length} healthy
            </span>
          </div>
        )}

        {issues.length > 0 ? (
          <div className="space-y-1.5">
            {issues.map((issue, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 p-2 rounded ${issue.severity === 'error' ? 'bg-error/10' : 'bg-accent/10'}`}
              >
                <span className={`text-sm mt-0.5 shrink-0 ${issue.severity === 'error' ? 'text-error' : 'text-accent'}`}>
                  {issue.severity === 'error' ? '✕' : '!'}
                </span>
                <div className="text-xs min-w-0">
                  <p className="font-semibold">{issue.label}</p>
                  <p className="text-muted-foreground mt-0.5">{issue.detail}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-success">✓</span>
            <span className="text-muted-foreground">
              {roster.length > 0 ? 'No lineup issues' : 'No roster data available'}
            </span>
          </div>
        )}

        {playersWithStatus.length > 0 && (
          <div className="border-t border-border pt-2.5 space-y-1.5">
            {playersWithStatus.map(player => {
              const cfg = tierConfig[getStatusTier(player)!];
              return (
                <div key={player.player_key} className={`border-l-2 ${cfg.border} pl-2.5 py-1`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">{player.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-caption text-muted-foreground">{player.editorial_team_abbr}</span>
                      <span className={`text-caption px-1.5 py-0.5 rounded font-semibold ${cfg.bg} ${cfg.text}`}>
                        {player.status}
                      </span>
                    </div>
                  </div>
                  {player.status_full && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{player.status_full}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
