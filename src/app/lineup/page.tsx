import AppLayout from '@/components/layout/AppLayout';
import LineupShell from '@/components/lineup/LineupShell';

export default async function LineupPage() {
  // Authentication handled by middleware. LineupShell is mode-aware (one
  // lineup page for both categories and points leagues).

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <LineupShell />
      </main>
    </AppLayout>
  );
}
