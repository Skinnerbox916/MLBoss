import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import AppLayout from '@/components/layout/AppLayout';
import GridLayout from '@/components/dashboard/GridLayout';
import { 
  MatchupCard,
  BattingCard,
  PitchingCard,
  LineupIssuesCard,
  WaiversCard,
  PlayerUpdatesCard,
  NextWeekCard,
  RecentActivityCard
} from '@/components/dashboard/cards';
import { DashboardCardMeta } from '@/components/dashboard/types';
// import { Quicksand } from "next/font/google";

// Quick sandbox import with limited weights for headings only
// const quicksand = Quicksand({
//   subsets: ["latin"],
//   weight: ["400", "600", "700"],
//   display: "swap",
// });

// Dashboard card configuration
const dashboardCards: DashboardCardMeta[] = [
  { id: 'matchup', component: MatchupCard, size: 'lg' },
  { id: 'batting', component: BattingCard, size: 'md' },
  { id: 'pitching', component: PitchingCard, size: 'md' },
  { id: 'lineup-issues', component: LineupIssuesCard, size: 'md' },
  { id: 'waivers', component: WaiversCard, size: 'md' },
  { id: 'player-updates', component: PlayerUpdatesCard, size: 'lg' },
  { id: 'next-week', component: NextWeekCard, size: 'md' },
  { id: 'recent-activity', component: RecentActivityCard, size: 'md' },
];

export default async function DashboardPage() {
  // Check authentication
  const session = await getSession();
  const user = session?.user;
  
  if (!user) {
    redirect('/auth/signin');
  }

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
        <div className="p-6">
          {/* Welcome Section */}
          <div className="mb-6">
            <h2 className="text-lg font-medium text-gray-900 dark:text-white">
              Welcome back, {user.name}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Here's your fantasy baseball overview
            </p>
          </div>

          {/* Dashboard Cards Grid */}
          <GridLayout>
            {dashboardCards.map(({ id, component: CardComponent }) => (
              <CardComponent key={id} />
            ))}
          </GridLayout>

          {/* Quick Actions */}
          <div className="mt-8">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              Quick Actions
            </h3>
            <div className="flex flex-wrap gap-4">
              <a
                href="/lineup"
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Set Lineup
              </a>
              <a
                href="/matchup"
                className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
              >
                View Matchup
              </a>
              <a
                href="/roster"
                className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
              >
                Manage Roster
              </a>
            </div>
          </div>
        </div>
      </main>
    </AppLayout>
  );
} 