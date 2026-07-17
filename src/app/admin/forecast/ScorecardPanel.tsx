'use client';

import { useCallback, useEffect, useState } from 'react';
import { Heading, Text } from '@/components/typography';
import type { EngineScorecard, StatGrade, CalibrationBucket } from '@/lib/ledger';

interface ScorecardResponse {
  engines: EngineScorecard[];
}

const ENGINE_LABEL: Record<string, string> = {
  'pitcher-start': 'Pitcher starts (L2 game forecast, league-free)',
  'points-pitcher-start': 'Points — pitcher starts',
  'points-batter-day': 'Points — batter days',
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
      {data && data.engines.length === 0 && (
        <Text variant="caption">No snapshots yet — capture a slate or browse the streaming pages.</Text>
      )}

      {data?.engines.map(card => <EngineCard key={card.engine} card={card} />)}
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
          {card.graded} graded · {card.didNotPlay} DNP
        </Text>
      </div>

      <StatTable title="Bias / MAE" stats={card.stats} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {card.qsCalibration && card.qsCalibration.length > 0 && (
          <CalibrationTable title="QS probability calibration" buckets={card.qsCalibration} />
        )}
        {card.wCalibration && card.wCalibration.length > 0 && (
          <CalibrationTable title="Win probability calibration" buckets={card.wCalibration} />
        )}
      </div>

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
        <Section title="Largest per-player misses (≥3 starts)">
          <table className="w-full text-sm font-mono">
            <thead>
              <tr className="text-left border-b border-border">
                <th className="py-1 pr-4 font-normal">Player</th>
                <th className="py-1 pr-4 font-normal">Starts</th>
                <th className="py-1 pr-4 font-normal">K bias</th>
                <th className="py-1 pr-4 font-normal">ER bias</th>
              </tr>
            </thead>
            <tbody>
              {card.worstMisses.map(m => (
                <tr key={m.mlbId} className="border-b border-border/40">
                  <td className="py-1 pr-4">{m.playerName}</td>
                  <td className="py-1 pr-4">{m.starts}</td>
                  <td className="py-1 pr-4">{fmtSigned(m.kBias)}</td>
                  <td className="py-1 pr-4">{fmtSigned(m.erBias)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
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
            <th className="py-1 pr-4 font-normal">MAE</th>
          </tr>
        </thead>
        <tbody>
          {stats.map(s => (
            <tr key={s.stat} className="border-b border-border/40">
              <td className="py-1 pr-4 uppercase">{s.stat}</td>
              <td className="py-1 pr-4">{s.n}</td>
              <td className="py-1 pr-4">{s.predictedMean}</td>
              <td className="py-1 pr-4">{s.actualMean}</td>
              <td className={`py-1 pr-4 ${Math.abs(s.bias) > s.mae * 0.5 && s.n >= 20 ? 'text-error-600' : ''}`}>
                {fmtSigned(s.bias)}
              </td>
              <td className="py-1 pr-4">{s.mae}</td>
            </tr>
          ))}
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
