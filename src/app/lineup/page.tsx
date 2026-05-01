import AppLayout from '@/components/layout/AppLayout';
import TodayManager from '@/components/lineup/TodayManager';

export default async function LineupPage() {
  // Authentication handled by middleware

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <TodayManager />
      </main>
    </AppLayout>
  );
}
