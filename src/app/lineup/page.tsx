import AppLayout from '@/components/layout/AppLayout';
import LineupManager from '@/components/lineup/LineupManager';

export default async function LineupPage() {
  // Authentication handled by middleware

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <LineupManager />
      </main>
    </AppLayout>
  );
}
