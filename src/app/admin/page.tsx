import AppLayout from '@/components/layout/AppLayout';
import Link from 'next/link';

export default async function AdminPage() {
  // Authentication handled by middleware
  // TODO: Add proper admin role check
  // For now, all authenticated users can access admin

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="p-6">
          <div className="mb-6">
            <h2 className="text-lg font-medium text-foreground">
              Administration Tools
            </h2>
            <p className="text-sm text-muted-foreground">
              Manage system settings and monitor application health
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Debug Dashboard */}
            <Link href="/admin/debug" className="block">
              <div className="bg-surface rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-foreground">
                    Debug Dashboard
                  </h3>
                  <span className="text-2xl">🔧</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  View system diagnostics and API data
                </p>
              </div>
            </Link>

            {/* User Management */}
            <div className="bg-surface rounded-lg shadow p-6 opacity-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-foreground">
                  User Management
                </h3>
                <span className="text-2xl">👤</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Coming soon: Manage users and permissions
              </p>
            </div>

            {/* Cache Control */}
            <Link href="/admin/cache" className="block">
              <div className="bg-surface rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-foreground">
                    Cache Control
                  </h3>
                  <span className="text-2xl">💾</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Manage Redis cache and view statistics
                </p>
              </div>
            </Link>

            {/* System Logs */}
            <div className="bg-surface rounded-lg shadow p-6 opacity-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-foreground">
                  System Logs
                </h3>
                <span className="text-2xl">📝</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Coming soon: View application logs
              </p>
            </div>

            {/* API Health */}
            <div className="bg-surface rounded-lg shadow p-6 opacity-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-foreground">
                  API Health
                </h3>
                <span className="text-2xl">🏥</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Coming soon: Monitor API status
              </p>
            </div>

            {/* Settings */}
            <div className="bg-surface rounded-lg shadow p-6 opacity-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-foreground">
                  Settings
                </h3>
                <span className="text-2xl">⚙️</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Coming soon: Configure system settings
              </p>
            </div>
          </div>
        </div>
      </main>
    </AppLayout>
  );
} 