import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import AppLayout from '@/components/layout/AppLayout';
import AppHeader from '@/components/layout/AppHeader';

export default async function LineupPage() {
  const session = await getSession();
  const user = session?.user;
  
  if (!user) {
    redirect('/auth/signin');
  }

  return (
    <AppLayout>
      <AppHeader title="Lineup Management" userName={user.name} />
      
      <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
        <div className="p-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8">
            <div className="text-center">
              <span className="text-6xl mb-4 block">📋</span>
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
                Lineup Management
              </h2>
              <p className="text-gray-600 dark:text-gray-400">
                Set your daily lineups and manage player positions
              </p>
            </div>
          </div>
        </div>
      </main>
    </AppLayout>
  );
} 