'use client';

import { useState } from 'react';

interface CheckResult {
  ok: boolean;
  latencyMs: number;
  detail: string;
  error?: string;
}

interface HealthResponse {
  timestamp: string;
  checks: Record<string, CheckResult>;
}

const CHECK_META: Record<string, { label: string; description: string }> = {
  redis:             { label: 'Redis',                     description: 'Cache & session store' },
  yahoo_fantasy:     { label: 'Yahoo Fantasy API',         description: 'OAuth token & API access' },
  mlb_schedule:      { label: 'MLB Stats API — Schedule',  description: 'Game schedule + pitcher enrichment pipeline' },
  mlb_player_search: { label: 'MLB Stats API — Players',   description: 'Player search endpoint (statsapi.mlb.com)' },
  savant_pitchers:   { label: 'Baseball Savant — Pitchers', description: 'xERA leaderboard (baseballsavant.mlb.com)' },
  savant_batters:    { label: 'Baseball Savant — Batters',  description: 'xwOBA leaderboard (baseballsavant.mlb.com)' },
};

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${ok ? 'bg-success' : 'bg-error'}`} />
  );
}

export default function APIHealthPanel() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<HealthResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function runChecks() {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/admin/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setLoading(false);
    }
  }

  const checks = data ? Object.entries(data.checks) : [];
  const allOk = checks.length > 0 && checks.every(([, c]) => c.ok);
  const hasIssues = checks.length > 0 && !allOk;

  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">API Health</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Probes all external data sources the app depends on
          </p>
        </div>

        <div className="flex items-center gap-3">
          {data && (
            <span className="inline-flex items-center gap-1.5">
              <StatusDot ok={allOk} />
              <span className={`text-xs font-medium ${allOk ? 'text-success' : 'text-error'}`}>
                {allOk ? 'All healthy' : 'Issues detected'}
              </span>
            </span>
          )}
          <button
            onClick={runChecks}
            disabled={loading}
            className="inline-flex items-center px-3 py-1.5 bg-primary text-white text-sm rounded hover:bg-primary/90 disabled:opacity-50 whitespace-nowrap"
          >
            {loading ? 'Checking…' : 'Run health checks'}
          </button>
        </div>
      </div>

      {fetchError && (
        <div className="bg-error/10 border border-error/30 rounded p-3 text-sm text-error mb-3">
          {fetchError}
        </div>
      )}

      {data && (
        <>
          <table className="w-full">
            <tbody>
              {checks.map(([key, result]) => {
                const meta = CHECK_META[key] ?? { label: key, description: '' };
                return (
                  <tr key={key} className="border-b border-border-muted last:border-b-0">
                    <td className="py-2 pr-3 w-6">
                      <StatusDot ok={result.ok} />
                    </td>
                    <td className="py-2 pr-4">
                      <span className="text-sm font-medium text-foreground">{meta.label}</span>
                      <p className="text-[11px] text-muted-foreground">{meta.description}</p>
                    </td>
                    <td className="py-2 pr-4 text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {result.latencyMs}ms
                    </td>
                    <td className="py-2 text-xs">
                      {result.ok ? (
                        <span className="text-success">{result.detail}</span>
                      ) : (
                        <span className="text-error">{result.error ?? 'failed'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground mt-2">
            Checked at {new Date(data.timestamp).toLocaleTimeString()}
            {hasIssues ? ' — Savant and MLB schedule checks may hit the Redis cache when warm.' : ''}
          </p>
        </>
      )}

      {!data && !loading && !fetchError && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Click &ldquo;Run health checks&rdquo; to probe all data sources.
        </p>
      )}
    </div>
  );
}
