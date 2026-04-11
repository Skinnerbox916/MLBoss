import AppLayout from '@/components/layout/AppLayout';
import PitchingManager from '@/components/pitching/PitchingManager';

export default async function PitchingPage() {
  // Authentication handled by middleware

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <PitchingManager />
      </main>
    </AppLayout>
  );
}
