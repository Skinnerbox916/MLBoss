import React from 'react';
import AppLayout from '@/components/layout/AppLayout';
import DashboardModeRouter from '@/components/dashboard/DashboardModeRouter';

// The dashboard is the reference/overview surface. `DashboardModeRouter`
// picks the experience by the active league's scoring mode: points leagues
// get the points week-outlook landing, categories leagues get the Boss Card
// marquee + reference-card grid.
export default async function DashboardPage(): Promise<React.JSX.Element> {
  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <DashboardModeRouter />
      </main>
    </AppLayout>
  );
}
