import AppLayout from '@/components/layout/AppLayout';
import LeagueManager from '@/components/league/LeagueManager';

export default async function LeaguePage() {
  // Authentication handled by middleware

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <LeagueManager />
      </main>
    </AppLayout>
  );
}
