import { getSession } from '@/lib/session';
import APIHealthPanel from './APIHealthPanel';
import LogoutButton from './LogoutButton';
import { getCurrentMLBGameKey, analyzeUserFantasyLeagues, isTokenValid, refreshUserTokens, type LeagueAnalysis, type LeagueAnalysisEntry, type LeagueAnalysisSummary } from '@/lib/fantasy';
import AppLayout from '@/components/layout/AppLayout';

interface MLBSeason {
  game_key: string;
  season: string;
  is_active: boolean;
}

export default async function AdminDebugPage() {
  const session = await getSession();
  const user = session.user!;

  let fantasyData: LeagueAnalysis | null = null;
  let fantasyError: string | null = null;
  let mlbLeagues: LeagueAnalysisEntry[] | null = null;
  let mlbSummary: LeagueAnalysisSummary | null = null;
  let currentMLBSeason: MLBSeason | null = null;

  try {
    const tokenValid = await isTokenValid(user.id);
    if (!tokenValid) {
      const refreshed = await refreshUserTokens(user.id);
      if (!refreshed) throw new Error('Unable to refresh authentication tokens');
    }

    currentMLBSeason = await getCurrentMLBGameKey(user.id);

    if (currentMLBSeason?.game_key) {
      const result = await analyzeUserFantasyLeagues(user.id, [currentMLBSeason.game_key]);
      if (!result.ok) throw new Error(result.error);
      fantasyData = result.data;
      mlbLeagues = fantasyData?.leagues ?? [];
      mlbSummary = fantasyData?.summary ?? null;
    } else {
      const result = await analyzeUserFantasyLeagues(user.id);
      if (!result.ok) throw new Error(result.error);
      fantasyData = result.data;
      mlbLeagues = [];
    }
  } catch (error) {
    fantasyError = error instanceof Error ? error.message : 'Unknown error';
    mlbLeagues = [];
  }

  const expirationDate = user.expiresAt ? new Date(user.expiresAt).toLocaleString() : 'Unknown';
  const isTokenExpired = user.expiresAt ? Date.now() >= user.expiresAt : false;
  const seasonLabel = currentMLBSeason?.season || '2026';

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-7xl mx-auto py-4 px-4 space-y-4">

          {/* ── API Health ─────────────────────────────────────── */}
          <APIHealthPanel />

          {/* ── Session & Leagues ──────────────────────────────── */}
          <div className="bg-surface rounded-lg border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-foreground">
                Session &amp; Leagues
              </h2>
              <LogoutButton />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {/* Session info */}
              <table className="text-sm">
                <tbody>
                  <tr>
                    <td className="font-medium text-muted-foreground pr-3 py-1 whitespace-nowrap">User</td>
                    <td className="text-foreground">{user.name}</td>
                  </tr>
                  <tr>
                    <td className="font-medium text-muted-foreground pr-3 py-1 whitespace-nowrap">User ID</td>
                    <td className="text-foreground font-mono text-xs">{user.id}</td>
                  </tr>
                  <tr>
                    <td className="font-medium text-muted-foreground pr-3 py-1 whitespace-nowrap">Token</td>
                    <td className="text-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`inline-block w-2 h-2 rounded-full ${isTokenExpired ? 'bg-error' : 'bg-success'}`} />
                        <span className={`text-sm font-medium ${isTokenExpired ? 'text-error' : 'text-success'}`}>
                          {isTokenExpired ? 'Expired' : 'Active'}
                        </span>
                        <span className="text-xs text-muted-foreground">— expires {expirationDate}</span>
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="font-medium text-muted-foreground pr-3 py-1 whitespace-nowrap">Season</td>
                    <td className="text-foreground text-sm">
                      {currentMLBSeason
                        ? `${seasonLabel} (game key ${currentMLBSeason.game_key})`
                        : 'Not detected'}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* League table */}
              <div>
                {fantasyError ? (
                  <ErrorBanner title="Fantasy Data Error" message={fantasyError} />
                ) : !mlbLeagues || mlbLeagues.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No {seasonLabel} MLB leagues found.</p>
                ) : (
                  <table className="w-full text-sm border border-border rounded">
                    <thead className="bg-surface-muted">
                      <tr>
                        <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">League</th>
                        <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">Your Team</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {mlbLeagues.map((league, i) => (
                        <tr key={league.league_key || i}>
                          <td className="px-3 py-1.5">
                            <div className="font-medium text-foreground">{league.league_name}</div>
                            <div className="text-[11px] text-muted-foreground font-mono">{league.league_key}</div>
                          </td>
                          <td className="px-3 py-1.5">
                            {league.error ? (
                              <span className="text-error text-xs">Error: {league.error}</span>
                            ) : league.user_team ? (
                              <span className="text-foreground">{league.user_team.team_name}</span>
                            ) : (
                              <span className="text-muted-foreground text-xs">No team found</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>


        </div>
      </main>
    </AppLayout>
  );
}

function ErrorBanner({ title, message }: { title: string; message: string }) {
  return (
    <div className="bg-error/10 border border-error/30 rounded p-3">
      <p className="text-sm font-medium text-error">{title}</p>
      <p className="text-sm text-error/80">{message}</p>
    </div>
  );
}
