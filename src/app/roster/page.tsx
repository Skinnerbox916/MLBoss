import AppLayout from '@/components/layout/AppLayout';
import RosterManager from '@/components/roster/RosterManager';

export default async function RosterPage() {
  // Authentication handled by middleware

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <RosterManager />
      </main>
    </AppLayout>
  );
}
