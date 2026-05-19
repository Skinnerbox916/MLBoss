import AppLayout from '@/components/layout/AppLayout';
import LineupShell from '@/components/lineup/LineupShell';

export default async function LineupPage() {
  // Authentication handled by middleware

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <LineupShell />
      </main>
    </AppLayout>
  );
}
