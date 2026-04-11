import { getSession } from '@/lib/session';
import CopyButton from './CopyButton';
import MLBDebugPanel from './MLBDebugPanel';
import { getCurrentMLBGameKey, analyzeUserFantasyLeagues, isTokenValid, refreshUserTokens, getEnrichedLeagueStatCategories, type LeagueAnalysis, type LeagueAnalysisEntry, type LeagueAnalysisSummary } from '@/lib/fantasy';
import type { EnrichedLeagueStatCategory } from '@/lib/fantasy/stats';
import AppLayout from '@/components/layout/AppLayout';

// ---------------------------------------------------------------------------
// Local types specific to this debug page (lightweight, not exported elsewhere)
// ---------------------------------------------------------------------------
// interface CacheStats {
//   totalKeys: number;
//   staticKeys: number;
//   // … add more fields here as needed when cache details are displayed
// }

interface MLBSeason {
  game_key: string;
  season: string;
  is_active: boolean;
}

type FantasyData = LeagueAnalysis;

export default async function AdminDebugPage() {
  // Authentication handled by middleware - get user from session
  const session = await getSession();
  const user = session.user!; // Non-null assertion safe due to middleware

  // Fetch current MLB season data efficiently
  let fantasyData: FantasyData | null = null;
  let fantasyError: string | null = null;
  let mlbLeagues: LeagueAnalysisEntry[] | null = null;
  let mlbSummary: LeagueAnalysisSummary | null = null;
  let currentMLBSeason: MLBSeason | null = null;
  
  try {
    // Check if user has valid tokens
    const tokenValid = await isTokenValid(user.id);
    if (!tokenValid) {
      const refreshed = await refreshUserTokens(user.id);
      if (!refreshed) {
        throw new Error('Unable to refresh authentication tokens');
      }
    }

    // Get current MLB season first (cached, fast call)
    currentMLBSeason = await getCurrentMLBGameKey(user.id);
    
    if (currentMLBSeason?.game_key) {
      // 🚀 EFFICIENCY: Only load leagues for current MLB season instead of all leagues
      console.log(`🎯 Loading only ${currentMLBSeason.season} MLB leagues (game key: ${currentMLBSeason.game_key})`);
      const result = await analyzeUserFantasyLeagues(user.id, [currentMLBSeason.game_key]);
      if (!result.ok) throw new Error(result.error);
      fantasyData = result.data;

      if (fantasyData?.leagues) {
        mlbLeagues = fantasyData.leagues;
        mlbSummary = fantasyData.summary ?? null;
        console.log(`✅ Loaded ${mlbLeagues?.length || 0} current season leagues`);
      }
    } else {
      console.log('⚠️ Could not determine current MLB season, falling back to all leagues');
      const result = await analyzeUserFantasyLeagues(user.id);
      if (!result.ok) throw new Error(result.error);
      fantasyData = result.data;
      mlbLeagues = [];
    }
  } catch (error) {
    console.error('Failed to fetch fantasy data:', error);
    fantasyError = error instanceof Error ? error.message : 'Unknown error fetching fantasy data';
    mlbLeagues = [];
  }

  // Fetch enriched league categories for the first league (for debugging)
  let leagueCategories: EnrichedLeagueStatCategory[] = [];
  let leagueCategoriesError: string | null = null;
  const firstLeagueKey = mlbLeagues?.[0]?.league_key;
  if (firstLeagueKey) {
    try {
      leagueCategories = await getEnrichedLeagueStatCategories(user.id, firstLeagueKey);
    } catch (error) {
      leagueCategoriesError = error instanceof Error ? error.message : 'Unknown error';
    }
  }

  // Format the token expiration date
  const expirationDate = user.expiresAt ? new Date(user.expiresAt).toLocaleString() : 'Unknown';
  const isTokenExpired = user.expiresAt ? Date.now() >= user.expiresAt : false;

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-7xl mx-auto py-4 px-4">
          <div className="space-y-4">

            {/* MLB Stats API debug probe — surfaces raw pipeline output */}
            <MLBDebugPanel />

            {/* Account Information - Compact Table */}
            <div className="bg-surface rounded-lg border border-border p-4">
              <h2 className="text-lg font-semibold text-foreground mb-3">
                Account Information
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <table className="text-sm">
                  <tbody>
                    <tr>
                      <td className="font-medium text-muted-foreground pr-3 py-1">Name</td>
                      <td className="text-foreground">{user.name}</td>
                    </tr>
                    <tr>
                      <td className="font-medium text-muted-foreground pr-3 py-1">Email</td>
                      <td className="text-foreground">{user.email || 'Not provided'}</td>
                    </tr>
                    <tr>
                      <td className="font-medium text-muted-foreground pr-3 py-1">User ID</td>
                      <td className="text-foreground font-mono text-xs">{user.id}</td>
                    </tr>
                  </tbody>
                </table>
                
                <table className="text-sm">
                  <tbody>
                    <tr>
                      <td className="font-medium text-muted-foreground pr-3 py-1">Session Status</td>
                      <td className="text-foreground">
                        <div className="flex items-center">
                          <div className={`h-2 w-2 rounded-full mr-2 ${
                            isTokenExpired ? 'bg-red-500' : 'bg-green-500'
                          }`}></div>
                          <span className={`text-sm font-medium ${
                            isTokenExpired 
                              ? 'text-red-600 dark:text-red-400' 
                              : 'text-green-600 dark:text-green-400'
                          }`}>
                            {isTokenExpired ? 'Expired' : 'Active'}
                          </span>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td className="font-medium text-muted-foreground pr-3 py-1">Token Expires</td>
                      <td className="text-foreground">{expirationDate}</td>
                    </tr>
                    <tr>
                      <td className="font-medium text-muted-foreground pr-3 py-1">Authentication Provider</td>
                      <td className="text-foreground">Yahoo OAuth 2.0</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Token Expiration Warning - Compact */}
              {isTokenExpired && (
                <div className="mt-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3">
                  <div className="flex items-start">
                    <svg className="h-4 w-4 text-red-400 mt-0.5 mr-2 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Session Expired</h3>
                      <p className="text-sm text-red-700 dark:text-red-300">Your authentication token has expired. Please sign in again.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* MLB Fantasy Baseball Data Section - Compact */}
            <div className="bg-surface rounded-lg border border-border p-4">
              <h2 className="text-lg font-semibold text-foreground mb-3">
                MLB Fantasy Baseball Data
              </h2>
              
              {fantasyError ? (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3">
                  <div className="flex items-start">
                    <svg className="h-4 w-4 text-red-400 mt-0.5 mr-2 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Fantasy Data Error</h3>
                      <p className="text-sm text-red-700 dark:text-red-300">{fantasyError}</p>
                    </div>
                  </div>
                </div>
              ) : fantasyData ? (
                <div className="space-y-4">
                  {/* MLB-Specific Summary - No Leagues Warning */}
                  {mlbSummary ? null : (
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-3">
                      <div className="flex items-start">
                        <svg className="h-4 w-4 text-yellow-400 mt-0.5 mr-2 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <div>
                          <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                            No {currentMLBSeason?.season || '2025'} MLB Leagues Found
                          </h3>
                          <p className="text-sm text-yellow-700 dark:text-yellow-300">
                            We checked for {currentMLBSeason?.season || '2025'} MLB fantasy leagues but found none. Make sure you have {currentMLBSeason?.season || '2025'} MLB fantasy teams in Yahoo Fantasy Sports.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* MLB Leagues and Teams - Compact Table */}
                  {mlbLeagues && mlbLeagues.length > 0 && (
                    <div>
                      <h3 className="text-base font-semibold text-foreground mb-2">
                        Your {currentMLBSeason?.season || '2025'} MLB Fantasy Teams
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border border-border rounded-lg">
                          <thead className="bg-primary-50 dark:bg-primary-700">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-foreground">League</th>
                              <th className="px-3 py-2 text-left font-medium text-foreground">Your Team</th>
                              <th className="px-3 py-2 text-left font-medium text-foreground">League Info</th>
                              <th className="px-3 py-2 text-left font-medium text-foreground">Team Info</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {mlbLeagues.map((league, index) => (
                              <tr key={league.league_key || index} className="hover:bg-primary-50 dark:hover:bg-primary-800">
                                <td className="px-3 py-2">
                                  <div>
                                    <div className="font-medium text-foreground">
                                      ⚾ {league.league_name}
                                    </div>
                                    <div className="text-xs text-muted-foreground font-mono">
                                      {league.league_key}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  {league.error ? (
                                    <div className="text-red-600 dark:text-red-400 text-xs">
                                      Error: {league.error}
                                    </div>
                                  ) : league.user_team ? (
                                    <div>
                                      <div className="font-medium text-green-800 dark:text-green-200">
                                        {league.user_team.team_name}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="text-muted-foreground text-xs">
                                      No team found
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  <div className="text-xs text-muted-foreground space-y-0.5">
                                    {/* League info can be added here */}
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  {/* Team info can be added here */}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Data Preview for Development - Compact */}
                  <div className="border-t border-border pt-4">
                    <details className="group">
                      <summary className="cursor-pointer text-base font-semibold text-foreground hover:text-primary dark:hover:text-primary-400">
                        🔧 MLB Data Preview (Development)
                      </summary>
                      <div className="mt-3 space-y-3">
                        {/* Status Table */}
                        <table className="text-sm w-full">
                          <tbody>
                            <tr>
                              <td className="font-medium text-muted-foreground pr-3 py-1">Data Status</td>
                              <td className="text-foreground">Successfully connected to Yahoo Fantasy API</td>
                            </tr>
                            <tr>
                              <td className="font-medium text-muted-foreground pr-3 py-1">Current Season MLB Leagues</td>
                              <td className="text-foreground">{mlbSummary?.total_leagues || 0}</td>
                            </tr>
                            <tr>
                              <td className="font-medium text-muted-foreground pr-3 py-1">MLB Leagues Identified</td>
                              <td className="text-foreground">{mlbLeagues?.length || 0}</td>
                            </tr>
                            <tr>
                              <td className="font-medium text-muted-foreground pr-3 py-1">Current MLB Season</td>
                              <td className="text-foreground">
                                {currentMLBSeason?.game_key || '458'} ({currentMLBSeason?.season || '2025'} season, {currentMLBSeason?.is_active ? 'Active' : 'Inactive'})
                              </td>
                            </tr>
                          </tbody>
                        </table>
                        
                        {/* API Features */}
                        <div className="text-sm text-muted-foreground">
                          <p><strong>API Features Available:</strong></p>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-1 text-xs mt-1">
                            <div>• League info & settings</div>
                            <div>• Team rosters & lineups</div>
                            <div>• Player stats & projections</div>
                            <div>• Waiver wire & transactions</div>
                            <div>• Matchup data & scores</div>
                            <div>• Real-time updates</div>
                          </div>
                        </div>
                        
                        {/* Enhanced Team Data Debug - Compact */}
                        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded">
                          <p className="text-sm font-medium text-blue-800 dark:text-blue-200">🔧 Team Data Retrieval Issue - Testing Fix</p>
                          <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                            Using <code className="bg-surface px-1 rounded">/teams;out=managers</code> to get manager data needed for team identification.
                          </p>
                        </div>
                        
                        {/* Raw Data */}
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Raw API data for debugging</span>
                          <CopyButton data={fantasyData} />
                        </div>
                        <div className="bg-surface-muted rounded p-3 overflow-auto max-h-64 text-xs">
                          <pre className="text-foreground whitespace-pre-wrap">
                            {JSON.stringify(fantasyData, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </details>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="mt-2 text-sm text-muted-foreground">Loading MLB fantasy data...</p>
                </div>
              )}
            </div>

            {/* Stat Categories Section - Compact */}
            <div className="bg-surface rounded-lg border border-border p-4">
              <h2 className="text-lg font-semibold text-foreground mb-3">
                MLB Stat Categories (Data Layer Test)
              </h2>
              
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Testing stat_id mapping for disambiguating statistics like pitcher vs batter strikeouts.
                </p>
                
                <div className="flex flex-wrap gap-2">
                  <a 
                    href="/api/test-stats" 
                    target="_blank"
                    className="inline-flex items-center px-3 py-1 bg-primary text-white text-sm rounded hover:bg-primary-600"
                  >
                    Test Stat Categories API
                  </a>
                  <a 
                    href={`/api/test-stats?game=${currentMLBSeason?.game_key || '458'}`}
                    target="_blank"
                    className="inline-flex items-center px-3 py-1 bg-green-500 text-white text-sm rounded hover:bg-green-600"
                  >
                    Test MLB {currentMLBSeason?.season || '2025'} Stats
                  </a>
                </div>
                
                <div className="bg-surface-muted rounded p-3">
                  <h3 className="text-sm font-semibold text-foreground mb-2">Key MLB Stat IDs:</h3>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs font-mono">
                    <div><span className="text-muted-foreground">21:</span> Batter K</div>
                    <div><span className="text-muted-foreground">42:</span> Pitcher K</div>
                    <div><span className="text-muted-foreground">12:</span> HR</div>
                    <div><span className="text-muted-foreground">13:</span> RBI</div>
                    <div><span className="text-muted-foreground">7:</span> Runs</div>
                    <div><span className="text-muted-foreground">26:</span> ERA</div>
                  </div>
                </div>
                
                <div className="text-sm text-muted-foreground">
                  <p><strong>Implementation Status:</strong></p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-xs mt-1">
                    <div>✅ Added getStatCategories() to YahooFantasyAPI</div>
                    <div>✅ Implemented 48-hour static caching</div>
                    <div>✅ Created stat_id to metadata mapping utility</div>
                    <div>✅ Added test endpoint at /api/test-stats</div>
                    <div>⏳ Next: Enrich player/team stats with category metadata</div>
                  </div>
                </div>

                {/* League Categories Debug */}
                {firstLeagueKey && (
                  <div className="border-t border-border pt-3 mt-3">
                    <h3 className="text-sm font-semibold text-foreground mb-2">
                      Enriched League Categories ({firstLeagueKey})
                    </h3>
                    {leagueCategoriesError ? (
                      <p className="text-sm text-red-500">Error: {leagueCategoriesError}</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs font-mono border border-border rounded">
                          <thead className="bg-primary-50 dark:bg-primary-700">
                            <tr>
                              <th className="px-2 py-1 text-left">stat_id</th>
                              <th className="px-2 py-1 text-left">display</th>
                              <th className="px-2 py-1 text-left">name</th>
                              <th className="px-2 py-1 text-left">position_types</th>
                              <th className="px-2 py-1 text-left">is_batter</th>
                              <th className="px-2 py-1 text-left">is_pitcher</th>
                              <th className="px-2 py-1 text-left">betterIs</th>
                              <th className="px-2 py-1 text-left">sort_order</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {leagueCategories.map(cat => (
                              <tr key={cat.stat_id} className={
                                cat.is_pitcher_stat ? 'bg-blue-50 dark:bg-blue-900/20' :
                                cat.is_batter_stat ? 'bg-green-50 dark:bg-green-900/20' :
                                'bg-red-50 dark:bg-red-900/20'
                              }>
                                <td className="px-2 py-1 font-bold">{cat.stat_id}</td>
                                <td className="px-2 py-1">{cat.display_name}</td>
                                <td className="px-2 py-1">{cat.name}</td>
                                <td className="px-2 py-1">{JSON.stringify(cat.position_types)}</td>
                                <td className="px-2 py-1">{cat.is_batter_stat ? '✅' : '❌'}</td>
                                <td className="px-2 py-1">{cat.is_pitcher_stat ? '✅' : '❌'}</td>
                                <td className="px-2 py-1">{cat.betterIs}</td>
                                <td className="px-2 py-1">{cat.sort_order}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="text-xs text-muted-foreground mt-1">
                          Green = batter, Blue = pitcher, Red = unclassified (missing position_types)
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </AppLayout>
  );
} 