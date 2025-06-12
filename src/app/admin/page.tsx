import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import AppLayout from '@/components/layout/AppLayout';
import AppHeader from '@/components/layout/AppHeader';
import Link from 'next/link';

export default async function AdminPage() {
  const session = await getSession();
  const user = session?.user;
  
  if (!user) {
    redirect('/auth/signin');
  }

  // TODO: Add proper admin role check
  // For now, all authenticated users can access admin

  return (
    <AppLayout>
      <AppHeader title="Admin Panel" userName={user.name} />
      
      <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
        <div className="p-6">
          <div className="mb-6">
            <h2 className="text-lg font-medium text-gray-900 dark:text-white">
              Administration Tools
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Manage system settings and monitor application health
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Debug Dashboard */}
            <Link href="/admin/debug" className="block">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                    Debug Dashboard
                  </h3>
                  <span className="text-2xl">🔧</span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  View system diagnostics and API data
                </p>
              </div>
            </Link>

            {/* User Management */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 opacity-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  User Management
                </h3>
                <span className="text-2xl">👤</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Coming soon: Manage users and permissions
              </p>
            </div>

            {/* Cache Control */}
            <Link href="/admin/cache" className="block">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                    Cache Control
                  </h3>
                  <span className="text-2xl">💾</span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Manage Redis cache and view statistics
                </p>
              </div>
            </Link>

            {/* System Logs */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 opacity-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  System Logs
                </h3>
                <span className="text-2xl">📝</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Coming soon: View application logs
              </p>
            </div>

            {/* API Health */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 opacity-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  API Health
                </h3>
                <span className="text-2xl">🏥</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Coming soon: Monitor API status
              </p>
            </div>

            {/* Settings */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 opacity-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  Settings
                </h3>
                <span className="text-2xl">⚙️</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Coming soon: Configure system settings
              </p>
            </div>
          </div>
        </div>
      </main>
    </AppLayout>
  );
} 