import AppLayout from '@/components/layout/AppLayout';

export default async function RosterPage() {
  // Authentication handled by middleware

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="p-6">
          <div className="bg-surface rounded-lg shadow p-8">
            <div className="text-center">
              <span className="text-6xl mb-4 block">👥</span>
              <h2 className="text-2xl font-semibold text-foreground mb-2">
                Roster Management
              </h2>
              <p className="text-muted-foreground">
                Manage your roster, waiver wire, and trades
              </p>
            </div>
          </div>
        </div>
      </main>
    </AppLayout>
  );
} 