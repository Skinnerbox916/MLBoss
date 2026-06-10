import AppLayout from '@/components/layout/AppLayout';
import LeagueModeRouter from '@/components/league/LeagueModeRouter';

export default async function LeaguePage() {
  // Authentication handled by middleware

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <LeagueModeRouter />
      </main>
    </AppLayout>
  );
}
