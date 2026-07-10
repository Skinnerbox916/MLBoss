'use client';

import Link from 'next/link';
import type { IconType } from 'react-icons';
import { FiZap, FiTrendingUp, FiTrendingDown } from 'react-icons/fi';
import Panel from '@/components/ui/Panel';
import Skeleton from '@/components/ui/Skeleton';
import Icon from '@/components/Icon';
import { Heading, Text } from '@/components/typography';
import { useActiveLeague } from '@/lib/hooks/useActiveLeague';
import { usePointsTeam } from '@/lib/hooks/usePointsTeam';
import { usePointsRosterStrategy } from '@/lib/hooks/usePointsRosterStrategy';
import SuggestedMovesPanel from '@/components/points/SuggestedMovesPanel';
import type { PointsVORRow } from '@/lib/points/analyzeTeam';

/**
 * Points-league dashboard — the reference/overview surface for a points
 * league. Leads with the week outlook (projected points + the lineup gain
 * call-to-action), then the top roster moves, then a roster-value summary
 * (best holds / drop candidates). The category Boss Card + per-category cards
 * don't apply here; this is the points equivalent landing.
 */
export default function PointsDashboard() {
  const { leagueKey, teamKey, scoringType, leagueName } = useActiveLeague();
  const { data, isLoading, isError } = usePointsTeam(leagueKey, teamKey, scoringType);
  // Batter moves solve client-side over the analysis facts (default depth
  // targets here — the roster page owns the steppers). Same hook as the
  // roster page: one source of moves.
  const strategy = usePointsRosterStrategy(leagueKey, teamKey, data?.batters);

  return (
    <div className="p-6 space-y-6">
      <header>
        <Heading as="h1" className="text-primary">Dashboard</Heading>
        <Text variant="muted">{leagueName ?? 'Points league'} · week outlook</Text>
      </header>

      {isError && (
        <Panel><Text variant="small" className="text-error">Couldn&apos;t load points analysis. Try refreshing.</Text></Panel>
      )}

      {isLoading && !data && (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {data && (
        <>
          <WeekOutlook
            projected={data.weekProjectedPoints}
            remainingDays={data.week.remainingDays}
            lineupDelta={data.lineup?.deltaPoints ?? 0}
            lineupMoves={data.lineup?.moveCount ?? 0}
          />

          <div className="grid gap-6 md:grid-cols-2">
            <SuggestedMovesPanel batterMoves={strategy.moves} pitcherMoves={data.pitcherMoves} limit={5} />
            <RosterValueSummary vor={data.rosterVOR} />
          </div>
        </>
      )}
    </div>
  );
}

function WeekOutlook({
  projected, remainingDays, lineupDelta, lineupMoves,
}: {
  projected: number;
  remainingDays: number;
  lineupDelta: number;
  lineupMoves: number;
}) {
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Text variant="caption" className="text-muted-foreground uppercase tracking-wider">
            Projected this week · {remainingDays} day{remainingDays === 1 ? '' : 's'} left
          </Text>
          <div className="flex items-baseline gap-2">
            <span className="font-mono tabular-nums text-4xl font-bold text-primary">{projected}</span>
            <Text as="span" variant="muted">pts</Text>
          </div>
        </div>

        {lineupDelta > 0.5 ? (
          <Link
            href="/lineup"
            className="flex items-center gap-3 rounded-lg bg-accent/10 px-4 py-3 hover:bg-accent/15 transition-colors"
          >
            <Icon icon={FiZap} size={20} className="text-accent shrink-0" />
            <div>
              <Text as="span" className="font-medium text-accent-900">
                +{lineupDelta} pts available today
              </Text>
              <Text variant="caption" className="text-muted-foreground">
                {lineupMoves} lineup change{lineupMoves === 1 ? '' : 's'} →
              </Text>
            </div>
          </Link>
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3">
            <Icon icon={FiZap} size={18} className="text-success" />
            <Text as="span" variant="small" className="text-success-900 font-medium">Lineup is optimal today</Text>
          </div>
        )}
      </div>
    </Panel>
  );
}

function RosterValueSummary({ vor }: { vor: PointsVORRow[] }) {
  const sorted = [...vor].sort((a, b) => b.vor - a.vor);
  const top = sorted.slice(0, 3);
  const bottom = sorted.filter(v => v.vor < 0).slice(-3).reverse();

  return (
    <Panel
      title="Roster Value"
      action={<Link href="/roster" className="text-caption text-accent hover:underline">full board →</Link>}
    >
      <div className="space-y-3">
        <ValueGroup icon={FiTrendingUp} tone="text-success" label="Best holds" rows={top} />
        {bottom.length > 0 && (
          <ValueGroup icon={FiTrendingDown} tone="text-error" label="Freely replaceable" rows={bottom} />
        )}
      </div>
    </Panel>
  );
}

function ValueGroup({
  icon, tone, label, rows,
}: {
  icon: IconType;
  tone: string;
  label: string;
  rows: PointsVORRow[];
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon icon={icon} size={13} className={tone} />
        <Text as="span" variant="caption" className="text-muted-foreground uppercase tracking-wider">{label}</Text>
      </div>
      <ul className="space-y-1">
        {rows.map(r => (
          <li key={r.name} className="flex items-center justify-between text-sm">
            <span className="text-foreground truncate">{r.name}</span>
            <span className="flex items-center gap-2 shrink-0">
              <Text as="span" variant="caption" className="text-muted-foreground font-mono">{r.pos}</Text>
              <span className={`font-mono tabular-nums text-xs font-medium ${tone}`}>
                {r.vor > 0 ? `+${r.vor}` : r.vor}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
