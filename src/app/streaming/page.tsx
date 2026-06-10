import AppLayout from '@/components/layout/AppLayout';
import StreamingModeRouter from '@/components/streaming/StreamingModeRouter';

export default async function StreamingPage() {
  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <StreamingModeRouter />
      </main>
    </AppLayout>
  );
}
