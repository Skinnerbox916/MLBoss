import AppLayout from '@/components/layout/AppLayout';
import GridLayout from '@/components/dashboard/GridLayout';
import { CurrentScoreCard, SeasonComparisonCard } from '@/components/matchup/cards';
import { getSession } from '@/lib/session';
import { getCurrentMLBGameKey, analyzeUserFantasyLeagues } from '@/lib/fantasy';

export default async function MatchupPage() {
  // Authentication handled by middleware

  // Determine user's primary MLB league to display matchup for
  const session = await getSession();
  const user = session.user as NonNullable<import('@/lib/session').SessionData['user']>;

  // Get current MLB game key (e.g., 458 for 2025)
  const currentMLB = await getCurrentMLBGameKey(user.id);

  // Fallbacks to ensure we don't break UI
  let leagueKey: string | undefined = undefined;

  if (currentMLB?.game_key) {
    const result = await analyzeUserFantasyLeagues(user.id, [currentMLB.game_key]);
    if (result.ok && result.data.leagues && result.data.leagues.length > 0) {
      leagueKey = result.data.leagues[0].league_key;
    }
  }

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="p-6">
          <GridLayout>
            <CurrentScoreCard leagueKey={leagueKey} />
            <SeasonComparisonCard leagueKey={leagueKey} />
          </GridLayout>
        </div>
      </main>
    </AppLayout>
  );
} 