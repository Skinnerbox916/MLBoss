'use client';

import { useMemo } from 'react';
import Panel from '@/components/ui/Panel';
import { useScoreboard } from '@/lib/hooks/useScoreboard';
import { useLeagueCategories } from '@/lib/hooks/useLeagueCategories';
import { formatStatValue } from '@/lib/formatStat';
import { buildMatchupRows, tallyMatchupRows, type MatchupRow } from '@/components/shared/matchupRows';

export type MatchupPulseSide = 'batting' | 'pitching' | 'both';

interface MatchupPulseProps {
  leagueKey: string | undefined;
  teamKey: string | undefined;
  /** Which category group to display. `both` splits the display into two header rows. */
  side: MatchupPulseSide;
  /** Override the default title (e.g. "Live Matchup"). */
  title?: string;
}

function PulseTiles({ rows }: { rows: MatchupRow[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {rows.map(row => (
        <div
          key={row.label}
          className={`flex flex-col items-center px-3 py-2 rounded-lg border ${
            !row.hasData ? 'border-border bg-background opacity-60' :
            row.winning === true ? 'border-success/30 bg-success/5' :
            row.winning === false ? 'border-error/30 bg-error/5' :
            'border-border bg-background'
          }`}
        >
          <span className="text-xs font-medium text-muted-foreground">{row.label}</span>
          <span className="text-sm font-bold text-foreground">
            {row.hasData ? formatStatValue(row.myVal, row.name) : '—'}
          </span>
          <span className="text-xs text-muted-foreground">
            {row.hasData ? formatStatValue(row.oppVal, row.name) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

function tallyBadge(rows: MatchupRow[]) {
  const { wins, losses, ties } = tallyMatchupRows(rows);
  const cls =
    wins > losses ? 'bg-success/15 text-success' :
    losses > wins ? 'bg-error/15 text-error' :
    'bg-primary/15 text-muted-foreground';
  return (
    <span className={`px-2 py-0.5 rounded-full font-medium ${cls}`}>
      {wins}W–{losses}L–{ties}T
    </span>
  );
}

/**
 * Compact, always-visible head-to-head scoreboard for the current week.
 *
 * Drops in above daily-decision surfaces (Today, Streaming) so the user can
 * see at a glance which categories they're winning, losing, or tied in
 * before choosing who to start or pick up.
 */
export default function MatchupPulse({
  leagueKey,
  teamKey,
  side,
  title,
}: MatchupPulseProps) {
  const { matchups, week, isLoading: scoreLoading } = useScoreboard(leagueKey);
  const { categories, isLoading: catsLoading } = useLeagueCategories(leagueKey);

  const isLoading = scoreLoading || catsLoading;

  const userMatchup = teamKey
    ? matchups.find(m => m.teams.some(t => t.team_key === teamKey))
    : undefined;
  const userTeam = userMatchup?.teams.find(t => t.team_key === teamKey);
  const opponent = userMatchup?.teams.find(t => t.team_key !== teamKey);

  const { battingRows, pitchingRows } = useMemo(() => {
    if (!userTeam?.stats || !opponent?.stats) return { battingRows: [], pitchingRows: [] };
    const myMap = new Map(userTeam.stats.map(s => [s.stat_id, s.value]));
    const oppMap = new Map(opponent.stats.map(s => [s.stat_id, s.value]));
    return {
      battingRows: buildMatchupRows(categories.filter(c => c.is_batter_stat), myMap, oppMap),
      pitchingRows: buildMatchupRows(categories.filter(c => c.is_pitcher_stat), myMap, oppMap),
    };
  }, [userTeam, opponent, categories]);

  if (isLoading) {
    return (
      <Panel className="animate-pulse">
        <div className="h-4 bg-border-muted rounded w-48 mb-3" />
        <div className="flex gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 w-20 bg-border-muted rounded" />
          ))}
        </div>
      </Panel>
    );
  }

  if (!userMatchup) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">No active matchup this week</p>
      </Panel>
    );
  }

  const weekSuffix = week ? ` — Week ${week}` : '';
  const sideLabel =
    side === 'batting' ? 'Batting Categories' :
    side === 'pitching' ? 'Pitching Categories' :
    'Matchup Categories';
  const heading = title ?? `${sideLabel}${weekSuffix}`;

  if (side === 'both') {
    const allRows = [...battingRows, ...pitchingRows];
    return (
      <Panel
        title={heading}
        action={
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">vs {opponent?.name ?? 'Opp'}</span>
            {tallyBadge(allRows)}
          </div>
        }
      >
        <div className="space-y-3">
          <div>
            <span className="text-caption text-muted-foreground uppercase tracking-wider">Batting</span>
            <div className="mt-1">
              <PulseTiles rows={battingRows} />
            </div>
          </div>
          <div>
            <span className="text-caption text-muted-foreground uppercase tracking-wider">Pitching</span>
            <div className="mt-1">
              <PulseTiles rows={pitchingRows} />
            </div>
          </div>
        </div>
      </Panel>
    );
  }

  const rows = side === 'batting' ? battingRows : pitchingRows;
  return (
    <Panel
      title={heading}
      action={
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">vs {opponent?.name ?? 'Opp'}</span>
          {tallyBadge(rows)}
        </div>
      }
    >
      <PulseTiles rows={rows} />
    </Panel>
  );
}
