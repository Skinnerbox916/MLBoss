'use client';

import { FiShield, FiTarget, FiSlash, FiCalendar } from 'react-icons/fi';
import Icon from '@/components/Icon';
import Panel from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import type { MatchupAnalysis, AnalyzedMatchupRow } from '@/lib/matchup/analysis';
import type { DailyBaseline } from '@/lib/projection/slotAware';

/**
 * "Going into the week, here's what the math says" overlay for the batter
 * streaming tab. Reads the corrected MatchupAnalysis (YTD + projection
 * blended) and bins each batter cat into one of three buckets:
 *
 *   - Defend  — projected wins (margin ≥ +0.4): protect them, don't waste FA cycles here
 *   - Chase   — toss-ups (|margin| < 0.4): highest leverage — your pickups should target these
 *   - Concede — projected losses (margin ≤ -0.4): swimming upstream; don't burn moves
 *
 * "Locked" cats (|margin| ≥ 0.7) get an explicit lock indicator inside their
 * bucket. The user makes the final call; this is informational, not
 * prescriptive — the focus bar still gives them per-cat overrides.
 */
export default function StrategySummary({
  analysis,
  isCorrected,
  isLoading,
  dailyBaselines = [],
}: {
  analysis: MatchupAnalysis;
  isCorrected: boolean;
  isLoading: boolean;
  /** Optional per-day baselines from the slot-aware engine. When supplied,
   *  surfaces the "light days" callout that tells the user where streaming
   *  is most needed. */
  dailyBaselines?: DailyBaseline[];
}) {
  if (isLoading && analysis.rows.length === 0) {
    return (
      <Panel title="Strategy">
        <p className="text-xs text-muted-foreground">Computing weekly projection…</p>
      </Panel>
    );
  }

  const batterRows = analysis.rows.filter(r => r.isBatterStat && r.hasData);
  if (batterRows.length === 0) {
    return (
      <Panel title="Strategy">
        <p className="text-xs text-muted-foreground">No batter-cat signal yet for this matchup week.</p>
      </Panel>
    );
  }

  const defend = batterRows.filter(r => r.margin >= 0.4).sort((a, b) => b.margin - a.margin);
  const chase = batterRows.filter(r => Math.abs(r.margin) < 0.4).sort((a, b) => Math.abs(a.margin) - Math.abs(b.margin));
  const concede = batterRows.filter(r => r.margin <= -0.4).sort((a, b) => a.margin - b.margin);

  const projWins = batterRows.filter(r => r.margin > 0).length;
  const projLosses = batterRows.filter(r => r.margin < 0).length;
  const tossUps = chase.length;

  return (
    <Panel
      title="Strategy"
      action={
        <span className="text-caption text-muted-foreground">
          {isCorrected ? 'YTD + forward projection' : 'YTD only — projection loading…'}
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Badge color={projWins >= projLosses ? 'success' : 'error'}>
          Projected: {projWins}W · {projLosses}L
        </Badge>
        {tossUps > 0 && (
          <Badge color="accent">
            {tossUps} toss-up{tossUps === 1 ? '' : 's'}
          </Badge>
        )}
      </div>

      <SlotPressureRow dailyBaselines={dailyBaselines} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Bucket
          label="Defend"
          tone="success"
          icon={FiShield}
          rows={defend}
          empty="Nothing locked in our favor"
        />
        <Bucket
          label="Chase"
          tone="accent"
          icon={FiTarget}
          rows={chase}
          empty="No toss-ups"
        />
        <Bucket
          label="Concede"
          tone="error"
          icon={FiSlash}
          rows={concede}
          empty="No locked losses"
        />
      </div>
    </Panel>
  );
}

/**
 * Surface the days where my active roster doesn't fill all batter slots.
 * On "light" days a streamer fills an open slot at full daily score; on
 * "full" days they have to displace an incumbent or sit benched.
 *
 * Also surfaces the weakest baseline starter when one shows up — a quick
 * "where is my roster bleeding production this week" hint.
 */
function SlotPressureRow({ dailyBaselines }: { dailyBaselines: DailyBaseline[] }) {
  if (dailyBaselines.length === 0) return null;

  // Days where active batter count < total starting slots.
  const lightDays = dailyBaselines.filter(d => d.activeBatterCount < d.rosterStartersTotal);

  // Pick the single weakest starter across the week — the one who's
  // dragging the average down the most. Threshold at score < 50 to keep
  // the callout meaningful (50 is league-neutral on the rating scale).
  const weakestThisWeek = dailyBaselines
    .map(d => d.weakestStarter ? { day: d, w: d.weakestStarter } : null)
    .filter((x): x is { day: DailyBaseline; w: NonNullable<DailyBaseline['weakestStarter']> } => x !== null && x.w.score < 50)
    .sort((a, b) => a.w.score - b.w.score)[0];

  if (lightDays.length === 0 && !weakestThisWeek) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      {lightDays.length > 0 && (
        <div className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <Icon icon={FiCalendar} size={11} />
          <span>
            Light days:{' '}
            {lightDays
              .map(d => `${d.dayLabel} (${d.activeBatterCount}/${d.rosterStartersTotal})`)
              .join(', ')}{' '}
            — open slots for streamers
          </span>
        </div>
      )}
      {weakestThisWeek && (
        <div className="text-caption text-muted-foreground">
          Weakest starter:{' '}
          <span className="text-error font-medium">
            {weakestThisWeek.w.name} ({weakestThisWeek.w.position}, {Math.round(weakestThisWeek.w.score)})
          </span>
        </div>
      )}
    </div>
  );
}

interface BucketProps {
  label: string;
  tone: 'success' | 'accent' | 'error';
  icon: typeof FiShield;
  rows: AnalyzedMatchupRow[];
  empty: string;
}

function Bucket({ label, tone, icon, rows, empty }: BucketProps) {
  const toneText =
    tone === 'success' ? 'text-success'
    : tone === 'error' ? 'text-error'
    : 'text-accent';
  return (
    <div className="bg-surface-muted/40 rounded-md p-2.5">
      <div className={`flex items-center gap-1.5 mb-2 ${toneText} text-caption font-semibold uppercase tracking-wide`}>
        <Icon icon={icon} size={11} />
        {label}
      </div>
      {rows.length === 0 ? (
        <p className="text-caption text-muted-foreground/60">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {rows.map(r => (
            <li key={r.statId} className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground flex items-center gap-1.5">
                {r.label}
                {Math.abs(r.margin) >= 0.7 && (
                  <span className="text-caption text-muted-foreground/70" title="Locked — unlikely to flip">
                    locked
                  </span>
                )}
              </span>
              <span className="text-caption text-muted-foreground tabular-nums">
                {r.myVal}–{r.oppVal}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
