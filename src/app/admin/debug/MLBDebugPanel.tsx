'use client';

import { useState } from 'react';

interface DebugResponse {
  request?: unknown;
  stage1_identity?: unknown;
  stage2_splits?: unknown;
  stage3_careerVsPitcher?: unknown;
  stage4_gameDay?: unknown;
  error?: string;
  stack?: string;
}

export default function MLBDebugPanel() {
  const [name, setName] = useState('Aaron Judge');
  const [team, setTeam] = useState('NYY');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [pitcherId, setPitcherId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DebugResponse | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const params = new URLSearchParams({ name, date });
      if (team) params.set('team', team);
      if (pitcherId) params.set('pitcherId', pitcherId);
      const res = await fetch(`/api/mlb/debug?${params.toString()}`);
      const data = (await res.json()) as DebugResponse;
      setResult(data);
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : 'request failed' });
    } finally {
      setLoading(false);
    }
  }

  async function copyResult() {
    if (!result) return;
    await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
  }

  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <h2 className="text-lg font-semibold text-foreground mb-3">
        MLB Stats API Debug Probe
      </h2>
      <p className="text-sm text-muted-foreground mb-3">
        Runs the full player-splits pipeline end-to-end and returns raw output from each stage. Use this to verify name resolution, splits fetching, career-vs-pitcher lookups, and game-day schedule enrichment.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
        <label className="text-xs text-muted-foreground">
          Player name
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="mt-1 w-full border border-border rounded px-2 py-1 text-sm bg-background text-foreground"
            placeholder="Aaron Judge"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Team abbr
          <input
            value={team}
            onChange={e => setTeam(e.target.value)}
            className="mt-1 w-full border border-border rounded px-2 py-1 text-sm bg-background text-foreground"
            placeholder="NYY"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Date
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="mt-1 w-full border border-border rounded px-2 py-1 text-sm bg-background text-foreground"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Opposing pitcher MLB ID (optional)
          <input
            value={pitcherId}
            onChange={e => setPitcherId(e.target.value)}
            className="mt-1 w-full border border-border rounded px-2 py-1 text-sm bg-background text-foreground"
            placeholder="543037"
          />
        </label>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={run}
          disabled={loading || !name}
          className="inline-flex items-center px-3 py-1.5 bg-primary text-white text-sm rounded hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Running…' : 'Run probe'}
        </button>
        {result && (
          <button
            onClick={copyResult}
            className="inline-flex items-center px-3 py-1.5 bg-surface-muted text-foreground text-sm rounded hover:bg-surface-muted/80"
          >
            Copy JSON
          </button>
        )}
      </div>

      {result && (
        <div className="space-y-3 text-xs">
          {result.error ? (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3">
              <p className="font-semibold text-red-800 dark:text-red-200">Error</p>
              <p className="text-red-700 dark:text-red-300">{result.error}</p>
              {result.stack && (
                <pre className="mt-2 text-caption whitespace-pre-wrap text-red-600 dark:text-red-400">
                  {result.stack}
                </pre>
              )}
            </div>
          ) : (
            <>
              <Section title="Stage 1 — Identity (resolveMLBId)" data={result.stage1_identity} />
              <Section title="Stage 2 — Splits (getBatterSplits)" data={result.stage2_splits} />
              <Section title="Stage 3 — Career vs pitcher" data={result.stage3_careerVsPitcher} />
              <Section title="Stage 4 — Game day schedule" data={result.stage4_gameDay} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, data }: { title: string; data: unknown }) {
  return (
    <details className="bg-surface-muted border border-border rounded" open>
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-foreground">
        {title}
      </summary>
      <div className="px-3 pb-3">
        <pre className="overflow-auto max-h-96 text-[11px] text-foreground whitespace-pre-wrap font-mono">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </details>
  );
}
