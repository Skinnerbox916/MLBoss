import AppLayout from '@/components/layout/AppLayout';
import StreamingManager from '@/components/streaming/StreamingManager';

export default async function StreamingPage() {
  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <StreamingManager />
      </main>
    </AppLayout>
  );
}
