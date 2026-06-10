'use client';

import { useMemo } from 'react';
import Panel from '@/components/ui/Panel';
import { Text } from '@/components/typography';
import Badge from '@/components/ui/Badge';
import CapPill from '@/components/shared/CapPill';
import type { LeagueLimits } from '@/lib/fantasy/limits';
import type { PitcherTeamProjectionResponse } from '@/lib/hooks/usePitcherTeamProjection';
import type { WeekTarget } from '@/lib/dashboard/weekRange';

const STAT_ID_K = 42;
const STAT_ID_W = 28;
const STAT_ID_QS = 83;
const STAT_ID_IP = 50;
const STAT_ID_GS = 25;

interface CatSpec {
  label: 'IP' | 'K' | 'W' | 'QS';
  statId: number;
  /** Display decimal places. IP keeps 1 decimal; small-magnitude cats
   *  (W, QS) keep 1 to expose the fractional projection; K rounds. */
  decimals: 0 | 1;
}

const COUNTING_CATS: CatSpec[] = [
  { label: 'IP', statId: STAT_ID_IP, decimals: 1 },
  { label: 'K',  statId: STAT_ID_K,  decimals: 0 },
  { label: 'W',  statId: STAT_ID_W,  decimals: 1 },
  { label: 'QS', statId: STAT_ID_QS, decimals: 1 },
];

interface CatRow {
  spec: CatSpec;
  myProj: number;
  oppProj: number;
  delta: number;
  behind: boolean;
}

function parseStatStr(v: string | undefined): number {
  if (v === undefined || v === '') return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function projectedTotal(
  myMtd: number,
  proj: PitcherTeamProjectionResponse | undefined,
  statId: number,
): number {
  const cat = proj?.byCategory[statId];
  if (!cat) return myMtd;
  return myMtd + cat.expectedCount;
}

function deltaSignificant(delta: number, statId: number): boolean {
  const threshold = statId === STAT_ID_IP || statId === STAT_ID_K ? 1.0 : 0.5;
  return delta < -threshold;
}

function fmt(n: number, decimals: 0 | 1): string {
  if (decimals === 0) return Math.round(n).toString();
  return n.toFixed(1);
}

function fmtDelta(d: number, decimals: 0 | 1): string {
  if (Math.abs(d) < (decimals === 0 ? 0.5 : 0.05)) return '0';
  const sign = d > 0 ? '+' : '';
  if (decimals === 0) return sign + Math.round(d).toString();
  return sign + d.toFixed(1);
}

interface VolumeGapProps {
  myStatsMap: Map<number, string>;
  oppStatsMap: Map<number, string>;
  myProjection?: PitcherTeamProjectionResponse;
  oppProjection?: PitcherTeamProjectionResponse;
  limits?: LeagueLimits;
  isLoading: boolean;
  /** Which week the panel describes. Default `'current'` (mid-week
   *  matchup). `'next'` adds a header chip and swaps the title /
   *  helper copy to next-week framing. */
  targetWeek?: WeekTarget;
}

/**
 * "Stream this week?" — Decision #1 panel. Volume question: given my
 * rotation's remaining starts and the opponent's, am I projected to fall
 * behind on the counting stats (IP / K / W / QS)? If yes, streaming is
 * worth doing; the Game Plan below answers WHICH streamer.
 *
 * Layout: standard box-score-style transposed table. Categories as
 * columns, sides as rows, gap as the punchline row. Color codes only
 * the gap cells (red = behind, green = ahead, muted = tied). YOU/OPP
 * rows stay neutral so the eye lands on the gap.
 *
 * Source mapping:
 *   - Matchup-to-date totals come from the scoreboard stats map (same
 *     map BossCard reads from `userTeam.stats`). Empty in pivot mode —
 *     `myProj` / `oppProj` then carry the full picture.
 *   - Remaining projections come from `useCorrectedMatchupAnalysis`'s
 *     `myPitcherProjection` / `oppPitcherProjection` — already loaded
 *     for the Game Plan below, so this panel adds no extra fetch.
 *   - Cap headroom uses `useLeagueLimits` + matchup-to-date IP/GS via the shared
 *     `CapPill` component.
 *
 * Verdict tone:
 *   - GS or IP cap reached:        error  — "Capped"
 *   - 0 counting cats behind:      success — "Optional"
 *   - 1-2 cats behind:             accent — "Selective"
 *   - 3-4 cats behind:             error  — "Aggressive"
 */
export default function VolumeGap({
  myStatsMap,
  oppStatsMap,
  myProjection,
  oppProjection,
  limits,
  isLoading,
  targetWeek = 'current',
}: VolumeGapProps) {
  const isPivot = targetWeek === 'next';
  const title = isPivot ? 'Stream next week?' : 'Stream this week?';
  const helper = isPivot
    ? 'Projected next-week totals from your scheduled SPs. No matchup-to-date yet — the matchup starts Monday.'
    : 'Projected end-of-week totals (matchup-to-date plus the rest-of-week forecast for your scheduled SPs).';
  const rows = useMemo<CatRow[]>(() => {
    return COUNTING_CATS.map(spec => {
      const myMtd = parseStatStr(myStatsMap.get(spec.statId));
      const oppMtd = parseStatStr(oppStatsMap.get(spec.statId));
      const myProj = projectedTotal(myMtd, myProjection, spec.statId);
      const oppProj = projectedTotal(oppMtd, oppProjection, spec.statId);
      const delta = myProj - oppProj;
      return {
        spec,
        myProj,
        oppProj,
        delta,
        behind: deltaSignificant(delta, spec.statId),
      };
    });
  }, [myStatsMap, oppStatsMap, myProjection, oppProjection]);

  const myUsedIp = myStatsMap.get(STAT_ID_IP);
  const myUsedGs = myStatsMap.get(STAT_ID_GS);
  const showIpCap = limits?.maxInningsPitched != null;
  const showGsCap = limits?.maxGamesStarted != null;
  const gsCapReached = showGsCap && parseStatStr(myUsedGs) >= limits!.maxGamesStarted!;
  const ipCapReached = showIpCap && parseStatStr(myUsedIp) >= limits!.maxInningsPitched!;

  const projectionAvailable = !!myProjection && !!oppProjection;
  const behindCount = rows.filter(r => r.behind).length;

  const verdict = useMemo(() => {
    if (gsCapReached || ipCapReached) {
      return {
        tone: 'error' as const,
        copy: gsCapReached
          ? 'GS cap reached — no room to stream this week.'
          : 'IP cap reached — no room to stream this week.',
      };
    }
    if (!projectionAvailable) {
      return {
        tone: 'muted' as const,
        copy: 'Projection loading — verdict pending.',
      };
    }
    if (behindCount === 0) {
      return {
        tone: 'success' as const,
        copy: 'Pace looks fine — streaming is optional.',
      };
    }
    if (behindCount >= 3) {
      return {
        tone: 'error' as const,
        copy: `Behind on ${behindCount} of 4 counting cats — stream aggressively.`,
      };
    }
    const labels = rows.filter(r => r.behind).map(r => r.spec.label).join(', ');
    return {
      tone: 'accent' as const,
      copy: `Behind on ${labels} — stream selectively.`,
    };
  }, [behindCount, gsCapReached, ipCapReached, projectionAvailable, rows]);

  const action = (isPivot || showIpCap || showGsCap) ? (
    <div className="flex flex-wrap items-center gap-2">
      {isPivot && <Badge color="accent">Next week</Badge>}
      {(showIpCap || showGsCap) && (
        <div className="flex flex-wrap gap-1">
          {showGsCap && (
            <CapPill label="GS" used={myUsedGs} cap={limits!.maxGamesStarted!} formatName="GS" />
          )}
          {showIpCap && (
            <CapPill label="IP" used={myUsedIp} cap={limits!.maxInningsPitched!} formatName="IP" />
          )}
        </div>
      )}
    </div>
  ) : null;

  if (isLoading) {
    return (
      <Panel title={title} action={action}>
        <div className="animate-pulse space-y-2">
          <div className="h-7 w-full bg-border-muted/60 rounded" />
          <div className="h-20 w-full max-w-md bg-border-muted/40 rounded mx-auto" />
        </div>
      </Panel>
    );
  }

  const verdictTone =
    verdict.tone === 'error' ? 'bg-error/10 text-error border-error/30' :
    verdict.tone === 'accent' ? 'bg-accent/10 text-accent-700 border-accent/30' :
    verdict.tone === 'success' ? 'bg-success/10 text-success border-success/30' :
    'bg-surface-muted text-muted-foreground border-border';

  return (
    <Panel
      title={title}
      action={action}
      helper={helper}
    >
      <div className={`mb-4 px-3 py-2 rounded-lg border ${verdictTone}`}>
        <Text variant="small" className="font-medium">{verdict.copy}</Text>
      </div>

      {/* Box-score-style transposed table. Categories across, sides
       *  down, gap as the punchline row. Sits naked on the Panel
       *  surface — visual structure comes from row backgrounds and
       *  borders, not a nested card (per ui-patterns.md "no new card
       *  wrappers"). YOU row uses accent tone — same "me=accent"
       *  convention BossCard uses on the dashboard. */}
      <table className="font-mono font-numeric border-collapse">
        <thead>
          <tr className="bg-surface-muted/40">
            <th scope="col" className="pl-4 pr-2 py-2 text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground text-left rounded-l">
              <span className="sr-only">Side</span>
            </th>
            {rows.map(row => (
              <th
                key={row.spec.label}
                scope="col"
                className="px-4 py-2 text-xs uppercase tracking-[0.15em] font-bold text-primary text-right min-w-[68px]"
              >
                {row.spec.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-border-muted">
            <th scope="row" className="pl-4 pr-2 py-2 text-[10px] uppercase tracking-[0.15em] font-bold text-accent-700 text-left">
              You
            </th>
            {rows.map(row => (
              <td key={row.spec.label} className="px-4 py-2 text-base font-semibold text-foreground text-right">
                {fmt(row.myProj, row.spec.decimals)}
              </td>
            ))}
          </tr>
          <tr className="border-t border-border-muted/60">
            <th scope="row" className="pl-4 pr-2 py-2 text-[10px] uppercase tracking-[0.15em] font-medium text-muted-foreground text-left">
              Opp
            </th>
            {rows.map(row => (
              <td key={row.spec.label} className="px-4 py-2 text-base text-muted-foreground text-right">
                {fmt(row.oppProj, row.spec.decimals)}
              </td>
            ))}
          </tr>
          <tr className="border-t-2 border-border bg-surface-muted/30">
            <th scope="row" className="pl-4 pr-2 py-2.5 text-[10px] uppercase tracking-[0.15em] font-bold text-foreground text-left">
              Gap
            </th>
            {rows.map(row => {
              const tone =
                row.behind ? 'text-error' :
                row.delta > 0.05 ? 'text-success' :
                'text-muted-foreground';
              return (
                <td
                  key={row.spec.label}
                  className={`px-4 py-2.5 text-xl font-bold text-right ${tone}`}
                >
                  {fmtDelta(row.delta, row.spec.decimals)}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </Panel>
  );
}
