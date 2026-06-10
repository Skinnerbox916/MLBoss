import AppLayout from '@/components/layout/AppLayout';
import RosterModeRouter from '@/components/roster/RosterModeRouter';

export default async function RosterPage() {
  // Authentication handled by middleware

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <RosterModeRouter />
      </main>
    </AppLayout>
  );
}
