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
  'points-pitcher-start': 'Points — pitcher starts',
  'points-batter-day': 'Points — batter days',
};

/** Where each engine's snapshots come from — shown for engines with no
 *  data yet so an empty card explains itself. */
const ENGINE_SOURCE: Record<string, string> = {
  'pitcher-start': 'game-day slate traffic (lineup/streaming pages) or Capture button — every probable starter',
  'batter-day': 'game-day slate traffic or Capture button — every batter in a posted MLB lineup',
  'points-pitcher-start': 'opening the points /streaming page — priced FA + rostered starts with board rank',
  'points-batter-day': 'opening the points /streaming page — per-batter day values',
};

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
      <Heading as="h3">Findings</Heading>
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
        <Heading as="h3">{ENGINE_LABEL[card.engine] ?? card.engine}</Heading>
        <Text variant="caption" className="font-mono">
          {card.snapshots} snapshots · {card.future} future · {card.pendingActuals} pending ·{' '}
          {card.graded} graded · {card.didNotPlay} DNP ·{' '}
          {card.coverage.capturedDays}/{card.coverage.spanDays}d captured
        </Text>
      </div>

      {card.graded === 0 ? (
        <Text variant="caption">
          Nothing graded yet — grades appear after the game dates pass and &ldquo;Score pending actuals&rdquo; runs.
        </Text>
      ) : (
      <>
      <StatTable title="Bias / MAE" stats={card.stats} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {card.qsCalibration && card.qsCalibration.length > 0 && (
          <CalibrationTable title="QS probability calibration" buckets={card.qsCalibration} />
        )}
        {card.wCalibration && card.wCalibration.length > 0 && (
          <CalibrationTable title="Win probability calibration" buckets={card.wCalibration} />
        )}
      </div>

      {card.scoreBuckets && card.scoreBuckets.length > 1 && (
        <Section title="Score buckets → realized outcomes">
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
        <Section title="FA board rank → realized points">
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
        <Section title="By lead days">
          <SegmentTable
            rows={card.byLeadDays.map(s => ({ label: `D−${s.leadDays}`, graded: s.graded, stats: s.stats }))}
          />
        </Section>
      )}

      {card.byModelVersion.length > 1 && (
        <Section title="By model version">
          <SegmentTable
            rows={card.byModelVersion.map(s => ({ label: s.modelVersion, graded: s.graded, stats: s.stats }))}
          />
        </Section>
      )}

      {card.worstMisses && card.worstMisses.length > 0 && (
        <Section title="Largest per-player misses">
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
                    <td key={b.stat} className="py-1 pr-4">{fmtSigned(b.bias)}</td>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <Text variant="caption" className="uppercase tracking-wide">{title}</Text>
      <div className="mt-1 overflow-x-auto">{children}</div>
    </div>
  );
}

const fmtSigned = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function CalibrationTable({ title, buckets }: { title: string; buckets: CalibrationBucket[] }) {
  return (
    <Section title={title}>
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
              <td className="py-1 pr-4">{Math.round(b.actualRate * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function StatTable({ title, stats }: { title: string; stats: StatGrade[] }) {
  return (
    <Section title={title}>
      <table className="w-full text-sm font-mono">
        <thead>
          <tr className="text-left border-b border-border">
            <th className="py-1 pr-4 font-normal">Stat</th>
            <th className="py-1 pr-4 font-normal">n</th>
            <th className="py-1 pr-4 font-normal">Predicted</th>
            <th className="py-1 pr-4 font-normal">Actual</th>
            <th className="py-1 pr-4 font-normal">Bias</th>
            <th className="py-1 pr-4 font-normal">Bias %</th>
            <th className="py-1 pr-4 font-normal">MAE</th>
          </tr>
        </thead>
        <tbody>
          {stats.map(s => {
            // Same significance test the findings run: bias vs its noise floor.
            const significant = s.se > 0 && Math.abs(s.bias / s.se) >= 3 && s.biasPct !== null && Math.abs(s.biasPct) >= 0.05;
            return (
            <tr key={s.stat} className="border-b border-border/40">
              <td className="py-1 pr-4 uppercase">{s.stat}</td>
              <td className="py-1 pr-4">{s.n}</td>
              <td className="py-1 pr-4">{s.predictedMean}</td>
              <td className="py-1 pr-4">{s.actualMean}</td>
              <td className={`py-1 pr-4 ${significant ? 'text-error-600' : ''}`}>
                {fmtSigned(s.bias)}
              </td>
              <td className={`py-1 pr-4 ${significant ? 'text-error-600' : ''}`}>
                {s.biasPct === null ? '—' : `${fmtSigned(Math.round(s.biasPct * 100))}%`}
              </td>
              <td className="py-1 pr-4">{s.mae}</td>
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
