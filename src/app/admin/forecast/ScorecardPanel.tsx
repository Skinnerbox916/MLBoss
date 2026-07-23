'use client';

import { useCallback, useEffect, useState } from 'react';
import { Heading, Text } from '@/components/typography';
import type { EngineScorecard, StatGrade, CalibrationBucket, Finding } from '@/lib/ledger';

interface ScorecardResponse {
  engines: EngineScorecard[];
  findings: Finding[];
}

const ENGINE_LABEL: Record<string, string> = {
  'pitcher-start': 'Pitcher starts (L2 game forecast, league-free)',
  'batter-day': 'Batter days (L2 forecast × lineup PA, league-free)',
  'batter-week': 'Batter weeks (roster-page substrate: talent × playing time)',
  'points-pitcher-start': 'Points — pitcher starts',
  'points-batter-day': 'Points — batter days',
};

/** Where each engine's snapshots come from — shown for engines with no
 *  data yet so an empty card explains itself. */
const ENGINE_SOURCE: Record<string, string> = {
  'pitcher-start': 'game-day slate traffic (lineup/streaming pages) or Capture button — every probable starter',
  'batter-day': 'game-day slate traffic or Capture button — every batter in a posted MLB lineup',
  'batter-week': 'opening the roster page (league forecast) — rostered + FA pool vs the next Mon–Sun window',
  'points-pitcher-start': 'opening the points /streaming page — priced FA + rostered starts with board rank',
  'points-batter-day': 'opening the points /streaming page — per-batter day values',
};

/** One-sentence "what is this engine" for the card-header help. */
const ENGINE_HELP: Record<string, string> = {
  'pitcher-start':
    'Freezes the game forecast (expected IP/K/ER/etc., QS and win odds) for every probable starter before first pitch, then grades it against his actual line.',
  'batter-day':
    'Freezes each posted-lineup batter’s projected day — expected PA plus a full stat line — and grades it against his actual box score.',
  'batter-week':
    'Freezes the roster page’s value substrate (talent × playing time) as a weekly stat line, graded against the player’s actual Mon–Sun totals. This is the engine that checks the playing-time model.',
  'points-pitcher-start':
    'Freezes each priced pitcher start’s expected fantasy points (board rank included), graded against the points his actual line earned under this league’s scoring.',
  'points-batter-day':
    'Freezes each batter’s expected fantasy points per day, graded against the points his actual line earned under this league’s scoring.',
};

const COUNTS_HELP =
  'The pipeline, left to right: snapshots = predictions frozen so far · future = game hasn’t been played yet · pending = game over, awaiting “Score pending actuals” · graded = scored against real results · DNP = predicted appearance that never happened (scratch / bench / zero-game week) · Nd/Md = days with a capture vs days since the first one.';

const FINDINGS_HELP =
  'Automatic checks over everything below. Only misses that clear a strict statistical bar surface here — FLAG means real and worth acting on, WATCH means suggestive but needs more data. Silence means the engines look healthy at the current sample size.';

/** Tiny hover/focus tooltip on a "?" glyph. Admin-page local — the
 *  product surfaces communicate structurally, but a diagnostic page
 *  earns its orientation text. */
function Help({ text, align = 'left' }: { text: string; align?: 'left' | 'right' }) {
  return (
    <span className="relative inline-flex group align-middle">
      <span
        tabIndex={0}
        aria-label={text}
        className="flex items-center justify-center w-4 h-4 rounded-full border border-border text-[10px] leading-none text-muted-foreground cursor-help select-none"
      >
        ?
      </span>
      <span
        className={`pointer-events-none absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full z-20 mt-1.5 hidden w-80 max-w-[80vw] rounded-lg border border-border bg-surface p-2.5 text-xs font-sans font-normal normal-case tracking-normal text-left text-foreground shadow-lg group-hover:block group-focus-within:block`}
      >
        {text}
      </span>
    </span>
  );
}

export default function ScorecardPanel() {
  const [data, setData] = useState<ScorecardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/forecast/scorecard');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scorecard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runAction = async (path: string, label: string) => {
    setBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch(path, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setActionMsg(`${label}: ${JSON.stringify(body)}`);
      await load();
    } catch (err) {
      setActionMsg(`${label} failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <ActionButton
          disabled={busy}
          onClick={() => runAction('/api/admin/forecast/capture', 'Capture')}
          label="Capture today's slate"
        />
        <ActionButton
          disabled={busy}
          onClick={() => runAction('/api/admin/forecast/score', 'Score')}
          label="Score pending actuals"
        />
        {actionMsg && <Text variant="caption" className="font-mono">{actionMsg}</Text>}
      </div>

      {loading && <Text variant="caption">Loading…</Text>}
      {error && <Text variant="caption" className="text-error-600">{error}</Text>}

      {data && <FindingsPanel findings={data.findings} anyGraded={data.engines.some(e => e.graded > 0)} />}

      {data?.engines.map(card => <EngineCard key={card.engine} card={card} />)}

      {data && Object.keys(ENGINE_LABEL)
        .filter(engine => !data.engines.some(c => c.engine === engine))
        .map(engine => (
          <div key={engine} className="bg-surface rounded-lg border border-border border-dashed p-5">
            <Heading as="h3">{ENGINE_LABEL[engine]}</Heading>
            <Text variant="caption">No snapshots yet · captures from {ENGINE_SOURCE[engine]}</Text>
          </div>
        ))}
    </div>
  );
}

function FindingsPanel({ findings, anyGraded }: { findings: Finding[]; anyGraded: boolean }) {
  return (
    <div className="bg-surface rounded-lg border border-border p-5 space-y-2">
      <span className="inline-flex items-center gap-2">
        <Heading as="h3">Findings</Heading>
        <Help text={FINDINGS_HELP} />
      </span>
      {findings.length === 0 && (
        <Text variant="caption">
          {anyGraded
            ? 'No statistically significant misses. Every bias is inside its noise floor at the current sample size.'
            : 'Nothing graded yet — findings appear once actuals are scored.'}
        </Text>
      )}
      {findings.map((f, i) => (
        <div key={i} className="flex items-start gap-2">
          <span
            className={`mt-0.5 shrink-0 px-1.5 py-0.5 rounded text-xs font-mono uppercase ${
              f.severity === 'flag' ? 'bg-error-100 text-error-700' : 'bg-accent-100 text-accent-800'
            }`}
          >
            {f.severity}
          </span>
          <div>
            <Text className="font-medium">{f.title}</Text>
            <Text variant="caption" className="font-mono">{f.detail}</Text>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActionButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1.5 rounded-lg border border-border bg-surface text-sm hover:border-primary/40 disabled:opacity-50 transition-colors"
    >
      {label}
    </button>
  );
}

function EngineCard({ card }: { card: EngineScorecard }) {
  return (
    <div className="bg-surface rounded-lg border border-border p-5 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="inline-flex items-center gap-2">
          <Heading as="h3">{ENGINE_LABEL[card.engine] ?? card.engine}</Heading>
          {ENGINE_HELP[card.engine] && (
            <Help text={`${ENGINE_HELP[card.engine]} Captures from ${ENGINE_SOURCE[card.engine]}.`} />
          )}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Text variant="caption" className="font-mono">
            {card.snapshots} snapshots · {card.future} future · {card.pendingActuals} pending ·{' '}
            {card.graded} graded · {card.didNotPlay} DNP ·{' '}
            {card.coverage.capturedDays}/{card.coverage.spanDays}d captured
          </Text>
          <Help text={COUNTS_HELP} align="right" />
        </span>
      </div>

      {card.graded === 0 ? (
        <Text variant="caption">
          Nothing graded yet — grades appear after the game dates pass and &ldquo;Score pending actuals&rdquo; runs.
        </Text>
      ) : (
      <>
      <StatTable title="Bias / MAE" stats={card.stats} showPool={card.byModelVersion.length > 1} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {card.qsCalibration && card.qsCalibration.length > 0 && (
          <CalibrationTable title="QS probability calibration" buckets={card.qsCalibration} />
        )}
        {card.wCalibration && card.wCalibration.length > 0 && (
          <CalibrationTable title="Win probability calibration" buckets={card.wCalibration} />
        )}
      </div>

      {card.scoreBuckets && card.scoreBuckets.length > 1 && (
        <Section
          title="Score buckets → realized outcomes"
          help="Does the 0–100 score actually rank players? Rows group players by the score we gave them BEFORE their games; the columns show what each group really produced afterward (simple production yardsticks — TB and R+RBI for bats, K/ER/QS rate for arms). Read top to bottom: higher-scored rows should out-produce lower ones. If 70+ doesn't beat <45, the score isn't ranking anything — and a finding will say so."
        >
          <table className="w-full text-sm font-mono">
            <thead>
              <tr className="text-left border-b border-border">
                <th className="py-1 pr-4 font-normal">Predicted score</th>
                <th className="py-1 pr-4 font-normal">n</th>
                {Object.keys(card.scoreBuckets[0].outcomes).map(k => (
                  <th key={k} className="py-1 pr-4 font-normal uppercase">{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {card.scoreBuckets.map(b => (
                <tr key={b.bucket} className="border-b border-border/40">
                  <td className="py-1 pr-4">{b.bucket}</td>
                  <td className="py-1 pr-4">{b.n}</td>
                  {Object.values(b.outcomes).map((v, i) => (
                    <td key={i} className="py-1 pr-4">{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {card.rankBuckets && card.rankBuckets.length > 0 && (
        <Section
          title="FA board rank → realized points"
          help="Grades the advice, not just the numbers: pickups the streaming board ranked 1–3 should realize more points than ones it ranked 11+. Predicted vs Actual per bucket shows whether the board's ordering held up in reality."
        >
          <table className="w-full text-sm font-mono">
            <thead>
              <tr className="text-left border-b border-border">
                <th className="py-1 pr-4 font-normal">Rank</th>
                <th className="py-1 pr-4 font-normal">n</th>
                <th className="py-1 pr-4 font-normal">Predicted</th>
                <th className="py-1 pr-4 font-normal">Actual</th>
              </tr>
            </thead>
            <tbody>
              {card.rankBuckets.map(b => (
                <tr key={b.bucket} className="border-b border-border/40">
                  <td className="py-1 pr-4">{b.bucket}</td>
                  <td className="py-1 pr-4">{b.n}</td>
                  <td className="py-1 pr-4">{b.predictedMean}</td>
                  <td className="py-1 pr-4">{b.actualMean}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {card.byLeadDays.length > 1 && (
        <Section
          title="By lead days"
          help="The same bias grades, split by how many days before the game the forecast was frozen (D−0 = day-of). Closer to game time should be more accurate — probables confirmed, park and weather known. If it isn't, something upstream is stale."
        >
          <SegmentTable
            rows={card.byLeadDays.map(s => ({ label: `D−${s.leadDays}`, graded: s.graded, stats: s.stats }))}
          />
        </Section>
      )}

      {card.byModelVersion.length > 1 && (
        <Section
          title="By model version"
          help="Grades segmented by the engine version stamped on each snapshot. The version bumps whenever calibration constants or engine math change, so a tuning change's before/after can be compared instead of blurring into one average."
        >
          <SegmentTable
            rows={card.byModelVersion.map(s => ({ label: s.modelVersion, graded: s.graded, stats: s.stats }))}
          />
        </Section>
      )}

      {card.worstMisses && card.worstMisses.length > 0 && (
        <Section
          title="Largest per-player misses"
          help="Players the engine keeps missing on in the same direction — candidates for a talent-layer look (role change, rookie priors, coming back from injury). Positive bias = we keep over-forecasting him. Red = that player's miss is statistically real; unmarked rows are small-sample and just candidates."
        >
          <table className="w-full text-sm font-mono">
            <thead>
              <tr className="text-left border-b border-border">
                <th className="py-1 pr-4 font-normal">Player</th>
                <th className="py-1 pr-4 font-normal">n</th>
                {card.worstMisses[0].biases.map(b => (
                  <th key={b.stat} className="py-1 pr-4 font-normal uppercase">{b.stat} bias</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {card.worstMisses.map(m => (
                <tr key={m.mlbId} className="border-b border-border/40">
                  <td className="py-1 pr-4">{m.playerName}</td>
                  <td className="py-1 pr-4">{m.n}</td>
                  {m.biases.map(b => (
                    <td key={b.stat} className={`py-1 pr-4 ${b.significant ? 'text-error-600' : ''}`}>
                      {fmtSigned(b.bias)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
      </>
      )}
    </div>
  );
}

function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="inline-flex items-center gap-1.5">
        <Text variant="caption" className="uppercase tracking-wide">{title}</Text>
        {help && <Help text={help} />}
      </span>
      <div className="mt-1 overflow-x-auto">{children}</div>
    </div>
  );
}

const fmtSigned = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function CalibrationTable({ title, buckets }: { title: string; buckets: CalibrationBucket[] }) {
  return (
    <Section
      title={title}
      help="Probability forecasts graded against reality. Each row groups starts by the odds we quoted; Realized is how often it actually happened. A calibrated engine matches its own confidence — starts quoted at 40–60% should land around 50%. Red = the gap is outside the noise band for that row's sample."
    >
      <table className="w-full text-sm font-mono">
        <thead>
          <tr className="text-left border-b border-border">
            <th className="py-1 pr-4 font-normal">Predicted</th>
            <th className="py-1 pr-4 font-normal">n</th>
            <th className="py-1 pr-4 font-normal">Mean forecast</th>
            <th className="py-1 pr-4 font-normal">Realized</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map(b => (
            <tr key={b.bucket} className="border-b border-border/40">
              <td className="py-1 pr-4">{b.bucket}</td>
              <td className="py-1 pr-4">{b.n}</td>
              <td className="py-1 pr-4">{Math.round(b.predictedMean * 100)}%</td>
              <td className={`py-1 pr-4 ${b.significant ? 'text-error-600' : ''}`}>
                {Math.round(b.actualRate * 100)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function StatTable({ title, stats, showPool }: { title: string; stats: StatGrade[]; showPool?: boolean }) {
  return (
    <Section
      title={title}
      help="Per stat: what we predicted per game vs what actually happened, averaged over the LIVE model cohort — every version that's model-equivalent to the current build for that stat. A stat an update didn't touch keeps pooling its whole history; a stat the update changed resets to post-change data only (full split in “By model version” below). Bias is the systematic lean (positive = over-forecast); MAE is the typical single-game miss. Red = lean bigger than its noise floor. Hover column headers for definitions."
    >
      <table className="w-full text-sm font-mono">
        <thead>
          <tr className="text-left border-b border-border">
            <th className="py-1 pr-4 font-normal">Stat</th>
            <th className="py-1 pr-4 font-normal cursor-help" title="Graded rows behind this line — appearances that actually happened.">n</th>
            {showPool && <th className="py-1 pr-4 font-normal cursor-help" title="Model versions pooled into this line. >1 = the stat accumulated unbroken across a version bump that didn't change it; 1 = an update reset it, so only post-change data counts here.">pool</th>}
            <th className="py-1 pr-4 font-normal cursor-help" title="Mean forecast per game across the graded rows.">Predicted</th>
            <th className="py-1 pr-4 font-normal cursor-help" title="Mean of what actually happened, same rows.">Actual</th>
            <th className="py-1 pr-4 font-normal cursor-help" title="Predicted − actual, averaged. Positive = the engine over-forecasts this stat.">Bias</th>
            <th className="py-1 pr-4 font-normal cursor-help" title="95% confidence range on the bias. A bias smaller than this is indistinguishable from noise — wait for more data.">±95%</th>
            <th className="py-1 pr-4 font-normal cursor-help" title="Bias as a share of actual production — makes stats of different sizes comparable.">Bias %</th>
            <th className="py-1 pr-4 font-normal cursor-help" title="Mean absolute error: the typical size of a single-game miss, noise included. The floor bias is measured against.">MAE</th>
            <th className="py-1 pr-4 font-normal cursor-help" title="Calibration slope: actual regressed on predicted. 1.00 = the spread of predictions is honest. Below 1 = over-spread (predictions more extreme than reality rewards — the model over-trusts its own signal); above 1 = too timid. Independent of bias. Red = significantly off 1.">Slope</th>
          </tr>
        </thead>
        <tbody>
          {stats.map(s => {
            // Same significance test the findings run: bias vs its noise floor.
            const significant = s.se > 0 && Math.abs(s.bias / s.se) >= 3 && s.biasPct !== null && Math.abs(s.biasPct) >= 0.05;
            const slopeOff = s.slope !== null && s.slopeSe !== null && s.slopeSe > 0
              && Math.abs((s.slope - 1) / s.slopeSe) >= 3 && Math.abs(s.slope - 1) >= 0.25;
            return (
            <tr key={s.stat} className="border-b border-border/40">
              <td className="py-1 pr-4 uppercase">{s.stat}</td>
              <td className="py-1 pr-4">{s.n}</td>
              {showPool && <td className="py-1 pr-4">{s.versions ?? 1}v</td>}
              <td className="py-1 pr-4">{s.predictedMean}</td>
              <td className="py-1 pr-4">{s.actualMean}</td>
              <td className={`py-1 pr-4 ${significant ? 'text-error-600' : ''}`}>
                {fmtSigned(s.bias)}
              </td>
              <td className="py-1 pr-4">{s.se > 0 ? `±${(1.96 * s.se).toFixed(2)}` : '—'}</td>
              <td className={`py-1 pr-4 ${significant ? 'text-error-600' : ''}`}>
                {s.biasPct === null ? '—' : `${fmtSigned(Math.round(s.biasPct * 100))}%`}
              </td>
              <td className="py-1 pr-4">{s.mae}</td>
              <td className={`py-1 pr-4 ${slopeOff ? 'text-error-600' : ''}`}>
                {s.slope === null ? '—' : s.slope.toFixed(2)}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}

function SegmentTable({ rows }: { rows: { label: string; graded: number; stats: StatGrade[] }[] }) {
  const statNames = rows[0]?.stats.map(s => s.stat) ?? [];
  return (
    <table className="w-full text-sm font-mono">
      <thead>
        <tr className="text-left border-b border-border">
          <th className="py-1 pr-4 font-normal">Segment</th>
          <th className="py-1 pr-4 font-normal">Graded</th>
          {statNames.map(s => (
            <th key={s} className="py-1 pr-4 font-normal uppercase">{s} bias</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.label} className="border-b border-border/40">
            <td className="py-1 pr-4">{r.label}</td>
            <td className="py-1 pr-4">{r.graded}</td>
            {r.stats.map(s => (
              <td key={s.stat} className="py-1 pr-4">{fmtSigned(s.bias)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
