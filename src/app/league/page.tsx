import AppLayout from '@/components/layout/AppLayout';

export default async function LeaguePage() {
  // Authentication handled by middleware

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="p-6">
          <div className="bg-surface rounded-lg shadow p-8">
            <div className="text-center">
              <span className="text-6xl mb-4 block">🏆</span>
              <h2 className="text-2xl font-semibold text-foreground mb-2">
                League Overview
              </h2>
              <p className="text-muted-foreground">
                View league standings, statistics, and matchups
              </p>
            </div>
          </div>
        </div>
      </main>
    </AppLayout>
  );
} 