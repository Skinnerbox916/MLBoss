import { getIdentityResolutionMetrics } from '@/lib/mlb/identity';

const REASON_LABELS: Record<string, string> = {
  hit: 'Hits',
  'no-search-results': 'No search results',
  'no-active-candidates': 'No active candidates',
  'hydrate-empty': 'Hydrate returned empty',
  'team-mismatch-fallback': 'Team mismatch (fallback used)',
  'fetch-error': 'Fetch errored',
};

function timeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function IdentityMetricsPanel() {
  const metrics = getIdentityResolutionMetrics();
  const hitRate = metrics.total > 0 ? (metrics.hits / metrics.total) * 100 : 0;

  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-foreground">
          Identity Resolution
        </h2>
        <span className="text-xs text-muted-foreground">
          process-local · resets on restart
        </span>
      </div>

      {metrics.total === 0 ? (
        <p className="text-sm text-muted-foreground">
          No Yahoo to MLB resolutions performed yet this process. Browse to a
          page that fetches roster stats (e.g. <code className="font-mono text-xs">/roster</code>)
          and reload this page to populate the panel.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <Stat label="Total" value={metrics.total.toLocaleString()} />
            <Stat label="Hits" value={`${metrics.hits.toLocaleString()} (${hitRate.toFixed(1)}%)`} ok />
            <Stat label="Misses" value={metrics.misses.toLocaleString()} bad={metrics.misses > 0} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Outcomes by reason
              </h3>
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(metrics.byReason).map(([reason, count]) => (
                    <tr key={reason} className="border-t border-border first:border-t-0">
                      <td className="py-1.5 text-foreground">
                        {REASON_LABELS[reason] ?? reason}
                      </td>
                      <td className="py-1.5 text-right font-mono text-xs text-foreground">
                        {count.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Recent misses
              </h3>
              {metrics.recentMisses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent misses recorded.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="text-xs font-medium text-muted-foreground py-1">Player</th>
                      <th className="text-xs font-medium text-muted-foreground py-1">Reason</th>
                      <th className="text-xs font-medium text-muted-foreground py-1 text-right">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.recentMisses.slice(0, 10).map((miss, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="py-1.5 text-foreground">
                          <span className="font-medium">{miss.name || '(blank)'}</span>
                          {miss.team && (
                            <span className="text-muted-foreground"> · {miss.team}</span>
                          )}
                        </td>
                        <td className="py-1.5 text-foreground">
                          <span className="font-mono text-xs">
                            {REASON_LABELS[miss.reason] ?? miss.reason}
                          </span>
                          {miss.candidateCount > 0 && (
                            <span className="text-muted-foreground text-xs"> ({miss.candidateCount} candidates)</span>
                          )}
                        </td>
                        <td className="py-1.5 text-right text-xs text-muted-foreground">
                          {timeAgo(miss.at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  ok,
  bad,
}: {
  label: string;
  value: string;
  ok?: boolean;
  bad?: boolean;
}) {
  const valueClass = ok
    ? 'text-success'
    : bad
      ? 'text-error'
      : 'text-foreground';
  return (
    <div className="rounded border border-border p-3">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div className={`text-2xl font-semibold ${valueClass}`}>{value}</div>
    </div>
  );
}
